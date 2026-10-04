using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Matches;
using Codex.Api.Contracts.Phases;
using Codex.Api.Data;
using Codex.Api.Documents;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.Redis;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// O ciclo de vida da partida: comecar (secao 7), ler a fase corrente (secao 7) e os controles do
/// lider (secao 10).
///
/// <b>A fase corrente e um indice, nao uma referencia.</b> <c>Match.CurrentPhaseIndex</c> casa com o
/// <c>OrderIndex</c> da fila, que fica congelada durante a partida — toda mutacao da secao 6 responde
/// <c>MATCH_ALREADY_STARTED</c> fora do lobby. E esta classe que faz aquela guarda, escrita na leva
/// anterior, disparar pela primeira vez.
///
/// <b>A fase fecha preguicosamente.</b> Nao ha job nem timer: <see cref="CloseExpiredPhaseAsync"/> e
/// chamado por quem passar por aqui depois do fim do cronometro (uma leitura, um envio, o
/// <c>advance</c>), e a coluna <c>CurrentPhaseEndedAt</c> garante que so o primeiro publique
/// <c>phase.ended</c>. A garantia que de fato importa — recusar envio atrasado — nao depende de
/// nenhum dos dois: ela sai da comparacao com <c>CurrentPhaseEndsAt</c> no proprio envio. Um
/// <c>BackgroundService</c> futuro nao muda nada disto, vira so mais um chamador (decisao 1 de
/// match-implementation-model.md).
/// </summary>
public class MatchService(
    RoomAccessService roomAccess,
    MatchAccessService matchAccess,
    MatchStatsService stats,
    MatchEventPublisher events,
    MatchDocumentWriter documents,
    IRoomRepository repo,
    IMatchRepository matchRepo)
{
    /// <summary>
    /// Quanto tempo a sala sobrevive ao fim da partida. "Configure TTL em <c>rooms.expiresAt</c>
    /// (sugestao: 24 h apos <c>finishedAt</c>)" — secao 13.
    ///
    /// <see cref="FinishAsync"/> e o primeiro lugar do sistema que escreve <c>ExpiresAt</c>: o campo
    /// existe desde a base inicial e nada o preenchia, o que fazia cada sala segurar um codigo de 6
    /// digitos para sempre. Isto nao fecha o problema inteiro — sala abandonada no lobby continua sem
    /// TTL —, mas tira o caminho feliz da lista.
    ///
    /// <b>E so um TTL, nao um encerramento.</b> Comecar outra partida e voltar ao lobby o apagam: a
    /// data so sobrevive na sala em que ninguem mais tocou depois do podio.
    /// </summary>
    private static readonly TimeSpan RoomLifetimeAfterMatch = TimeSpan.FromHours(24);

    /* ---------------------------------------------------------------------- */
    /* Secao 7 — comecar e ler                                                 */
    /* ---------------------------------------------------------------------- */

    /// <summary>
    /// <c>POST /rooms/{code}/match</c>. Rota de lider, e o unico lugar que tira a sala do lobby.
    ///
    /// A ordem das recusas nao e acidental: fila vazia e falta de jogador vem antes da conferencia
    /// de fase incompleta porque sao o que o lider consegue enxergar sozinho na tela; a fase
    /// incompleta exige abrir o desafio para entender.
    /// </summary>
    public async Task<MatchDto> StartAsync(string code, StartMatchRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var roomData = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);

        if (roomData.Status != RoomRedisData.ToRedis(RoomStatus.Lobby))
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.MatchAlreadyStarted, "Esta sala ja tem uma partida em andamento.");
        }

        var roomId = Guid.Parse(roomData.Id);
        var mode = ParseMode(request.Mode);
        var phases = await PhasesAsync(roomId, ct);

        if (phases.Count is 0)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.EmptyQueue, "Adicione ao menos uma fase a fila antes de comecar.");
        }

        if (await stats.CountPlayersAsync(roomId, ct) is 0)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.NoPlayers, "Aprove ao menos um participante antes de comecar.");
        }

        // O portao que a secao 5 deixou marcado: "rascunho incompleto salva; quem deveria cobrar
        // fase completa e o inicio da partida". Todas as fases, e nao so a primeira — descobrir na
        // fase 6 que ela nao tem gabarito seria descobrir no meio da aula.
        foreach (var phase in phases)
        {
            PhaseGrading.EnsureComplete(phase);
        }

        var now = DateTimeOffset.UtcNow;
        var match = new Match
        {
            RoomId = roomId,
            Mode = mode,
            Status = MatchStatus.Running,
            CurrentPhaseIndex = 0,
            StartedAt = now,
        };
        StartPhaseClock(match, phases[0], now);
        await matchRepo.SetMatchAsync(match, ct);

        roomData = roomData with {
            Status = RoomRedisData.ToRedis(RoomStatus.Running),
            MatchMode = RoomRedisData.ToRedis(mode),
            ExpiresAtMs = null,
            QueueRevision = roomData.QueueRevision + 1,
            CurrentMatchId = match.Id.ToString()
        };
        await repo.SaveRoomAsync(roomData.Id, roomData, ct);

        var room = roomData.ToEntity();

        await events.MatchStartedAsync(room, match, ct);
        await events.PhaseStartedAsync(room, match, await BuildPhaseStateAsync(match, phases[0], null, phases.Count, ct), ct);

        return ToDto(match, phases.Count);
    }

    /// <summary>
    /// <c>GET /rooms/{code}/match</c> — a partida mais recente da sala.
    ///
    /// <b>Sala sem partida responde <c>404 MATCH_NOT_FOUND</c></b>, e isso quebra o render de quem
    /// abrir <c>/sala/{code}/partida</c> direto pela URL, porque a pagina busca esta rota sem
    /// <c>try/catch</c>. E conserto de front (redirecionar para o lobby), registrado e nao feito
    /// aqui — mesma natureza do bug do <c>SetPicker</c> em api-queue-log.md §7. Inventar um corpo
    /// vazio de partida para evitar o 404 seria mentir para todas as outras rotas.
    /// </summary>
    public async Task<MatchDto> GetByRoomAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var roomData = await roomAccess.GetRoomAsMemberAsync(code, principal, ct);
        var roomId = Guid.Parse(roomData.Id);

        if (roomData.CurrentMatchId is null)
        {
            throw MatchAccessService.MatchNotFound();
        }

        var match = await matchRepo.GetMatchAsync(roomData.CurrentMatchId, ct)
                    ?? throw MatchAccessService.MatchNotFound();

        return ToDto(match, await CountPhasesAsync(roomId, ct));
    }

    /// <summary>
    /// <c>GET /matches/{matchId}/current-phase</c> — "a rota mais importante da tela de Desafios".
    ///
    /// E uma leitura que <b>pode gravar</b>: se o cronometro venceu, ela e quem fecha a fase. E o
    /// preco do fechamento preguicoso, e o efeito e limitado a uma coluna de data e a um evento.
    /// </summary>
    public async Task<PhaseStateDto> GetCurrentPhaseAsync(string matchId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room) = await matchAccess.GetMatchAsMemberAsync(matchId, principal, ct);
        var phases = await PhasesAsync(match.RoomId, ct);
        var phase = PhaseAt(match, phases);

        await CloseExpiredPhaseAsync(match, room, phase, ct);

        return await BuildPhaseStateAsync(match, phase, principal.GetParticipantId(), phases.Count, ct);
    }

    /* ---------------------------------------------------------------------- */
    /* Secao 10 — controles do lider                                           */
    /* ---------------------------------------------------------------------- */

    /// <summary>
    /// <c>POST /matches/{id}/advance</c>. Fecha a fase corrente independentemente do cronometro (o
    /// lider decidiu que acabou) e abre a proxima.
    ///
    /// <c>previous</c> "so e aceito no modo self-paced" — e <c>self-paced</c> nao existe ainda,
    /// entao ele e sempre <c>409 INVALID_DIRECTION</c>. Avancar depois da ultima fase cai no mesmo
    /// code: o caminho para terminar e <c>finish</c>, que e o que o botao da tela faz.
    /// </summary>
    public async Task AdvanceAsync(string matchId, AdvanceMatchRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room) = await GetActiveMatchAsLeaderAsync(matchId, principal, ct);
        var phases = await PhasesAsync(match.RoomId, ct);

        var direction = request.Direction;
        if (string.Equals(direction, AdvanceMatchRequest.Previous, StringComparison.Ordinal))
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.InvalidDirection, "Voltar de fase so e possivel no modo em que cada um joga no proprio ritmo.");
        }

        if (!string.Equals(direction, AdvanceMatchRequest.Next, StringComparison.Ordinal))
        {
            throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "direction deve ser \"next\" ou \"previous\".");
        }

        if (match.CurrentPhaseIndex + 1 >= phases.Count)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.InvalidDirection, "Esta e a ultima fase da fila; encerre a partida para ver o podio.");
        }

        var now = DateTimeOffset.UtcNow;
        var closing = PhaseAt(match, phases);
        var wasOpen = match.CurrentPhaseEndedAt is null;

        match.CurrentPhaseIndex++;
        var next = phases[match.CurrentPhaseIndex];
        StartPhaseClock(match, next, now);
        match.Status = MatchStatus.Running;

        await matchRepo.SetMatchAsync(match, ct);

        // phase.ended antes de phase.started: quem estava esperando sai da tela de espera e ja e
        // levado para a fase nova pelo evento seguinte. A ordem inversa perderia a transicao.
        if (wasOpen)
        {
            await events.PhaseEndedAsync(room, closing.Id, ct);
        }

        await events.PhaseStartedAsync(room, match, await BuildPhaseStateAsync(match, next, null, phases.Count, ct), ct);
        await events.ProgressAsync(room, match, next, ct);
    }

    /// <summary>
    /// <c>POST /matches/{id}/pause</c> — "congela o cronometro de todos".
    ///
    /// Pausar guarda quanto sobrava e manda <c>endsAt: null</c>; retomar recria o instante deslocado
    /// pela duracao da pausa. Chamar duas vezes com o mesmo valor nao faz nada: o botao e um toggle
    /// e dois cliques rapidos nao podem devolver tempo a turma.
    /// </summary>
    public async Task SetPausedAsync(string matchId, PauseMatchRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room) = await GetActiveMatchAsLeaderAsync(matchId, principal, ct);
        var phases = await PhasesAsync(match.RoomId, ct);
        var phase = PhaseAt(match, phases);

        var alreadyPaused = match.Status is MatchStatus.Paused;
        if (alreadyPaused == request.Paused)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;

        if (request.Paused)
        {
            match.PausedSecondsLeft = SecondsLeft(match, now);
            match.CurrentPhaseEndsAt = null;
            match.Status = MatchStatus.Paused;
        }
        else
        {
            match.CurrentPhaseEndsAt = now.AddSeconds(match.PausedSecondsLeft ?? phase.TimeSeconds);
            match.PausedSecondsLeft = null;
            match.Status = MatchStatus.Running;
        }

        await matchRepo.SetMatchAsync(match, ct);
        await events.PhasePausedAsync(room, match, request.Paused, ct);
    }

    /// <summary>
    /// <c>POST /matches/{id}/phases/{phaseId}/restart</c> — "zera envios e cronometro da fase".
    ///
    /// <b>So a fase corrente.</b> Reiniciar uma fase ja passada exigiria mover a partida para tras,
    /// que e exatamente o que <c>INVALID_DIRECTION</c> proibe no modo ao vivo — seria a mesma coisa
    /// por outra porta.
    ///
    /// Apagar as submissoes leva junto os <c>ReadyAt</c>, que moram nelas: quem tinha marcado
    /// "pronto" volta a nao ter respondido, que e o estado correto depois de um reinicio.
    /// </summary>
    public async Task RestartPhaseAsync(string matchId, string phaseId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room) = await GetActiveMatchAsLeaderAsync(matchId, principal, ct);
        var phases = await PhasesAsync(match.RoomId, ct);
        var phase = PhaseAt(match, phases);

        if (!Guid.TryParse(phaseId, out var id) || id != phase.Id)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.PhaseClosed, "So a fase corrente pode ser reiniciada.");
        }

        await matchRepo.RestartPhaseAsync(match.Id.ToString(), phase.Id.ToString(), ct);

        StartPhaseClock(match, phase, DateTimeOffset.UtcNow);
        match.Status = MatchStatus.Running;

        await matchRepo.SetMatchAsync(match, ct);

        await events.PhaseStartedAsync(room, match, await BuildPhaseStateAsync(match, phase, null, phases.Count, ct), ct);
        await events.ProgressAsync(room, match, phase, ct);
    }

    /// <summary>
    /// <c>POST /matches/{id}/finish</c> — "encerra e calcula o podio".
    ///
    /// Encerra a <b>partida</b> e da um valor a <c>Room.ExpiresAt</c>. A <b>sala</b> continua de pe e
    /// aparecendo em <c>GET /rooms/active</c>: e por ela que o lider volta se fechar a aba no podio,
    /// e quem a devolve ao lobby e <see cref="ReturnToLobbyAsync"/>.
    ///
    /// Idempotente: chamar de novo devolve o mesmo podio sem mexer nas datas. O botao fica na tela
    /// durante toda a partida e dois cliques nao podem mover o TTL para a frente.
    /// </summary>
    public async Task<IReadOnlyList<PodiumEntryDto>> FinishAsync(string matchId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room) = await matchAccess.GetMatchAsLeaderAsync(matchId, principal, ct);
        return await FinishCoreAsync(match, room, ct);
    }

    /// <summary>
    /// O encerramento em si, sem checagem de quem chamou — porque agora ele tem <b>dois</b>
    /// disparadores: o botao do lider e o fim da ultima fase (<see cref="FinishIfLastPhaseAsync"/>).
    ///
    /// <b>Marca todos os aprovados como "na tela de resultados".</b> Encerrar a partida deixou de
    /// arrastar a turma de volta ao lobby — cada um sai do podio quando quiser —, entao alguem
    /// precisa lembrar quem ainda nao voltou. Sem isso, uma aba esquecida no podio contaria como
    /// jogador na partida seguinte e a regra "todos enviaram" nunca fecharia uma fase.
    /// </summary>
    private async Task<IReadOnlyList<PodiumEntryDto>> FinishCoreAsync(Match match, Room room, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var alreadyFinished = match.Status is MatchStatus.Finished;

        if (!alreadyFinished)
        {
            match.Status = MatchStatus.Finished;
            match.FinishedAt = now;
            match.CurrentPhaseEndedAt ??= now;

            // Encerra a PARTIDA, nao a SALA. A sala segue `Running`: a turma continua reunida,
            // olhando para o podio, e quem a devolve ao lobby e o lider (return-to-lobby).
            //
            // Isto ja foi diferente e estava errado. `RoomStatus.Finished` e um estado terminal —
            // some de GET /rooms/active, recusa entrada nova (ROOM_LOCKED) e trava a fila
            // (MATCH_ALREADY_STARTED) — e enquanto encerrar era so um botao do lider isso passava
            // por "o professor fechou a aula". Quando o fim da fila passou a encerrar sozinho
            // (§11.1 do log), toda partida terminada matava a sala: o lider voltava ao lobby,
            // clicava em comecar outra e levava "esta sala ja tem uma partida em andamento", sem
            // caminho de volta em lugar nenhum da tela.
            var roomData = await repo.GetRoomAsync(room.Id.ToString(), ct);
            if (roomData != null)
            {
                roomData = roomData with {
                    ExpiresAtMs = RoomRedisData.ToMs(now + RoomLifetimeAfterMatch),
                    QueueRevision = roomData.QueueRevision + 1
                };
                await repo.SaveRoomAsync(roomData.Id, roomData, ct);
                room = roomData.ToEntity();
            }

            var pDatas = await repo.GetParticipantsAsync(room.Id.ToString(), ct);
            foreach (var pData in pDatas.Where(p => p.Status == "approved"))
            {
                var updated = pData with { InResultsSinceMs = RoomRedisData.ToMs(now) };
                await repo.UpdateParticipantAsync(room.Id.ToString(), updated, ct);
            }

            await matchRepo.SetMatchAsync(match, ct);

            // O snapshot da partida no banco de documentos, logo depois de o Postgres ter fechado.
            //
            // Escrita dupla proposital: enquanto o Postgres ainda guarda a partida, os dois lados
            // convivem e podem ser comparados (o que MatchDocumentWriterTests faz). No passo 5 da
            // secao 8.2 da migracao-dados a ordem inverte — o documento vira a unica copia, e e o
            // SaveChangesAsync daqui que desaparece.
            //
            // Dentro do `if`: encerrar e idempotente, e remontar o snapshot a cada clique do lider
            // numa partida ja encerrada seria trabalho sem efeito. Refazer o commit depois de uma
            // falha continua possivel porque BuildAsync e idempotente.
            await documents.CommitAsync(match, ct);
        }

        var podium = await stats.GetPodiumAsync(match, ct);

        // Publica so na transicao. Encerrar ganhou um segundo disparador (o fim da ultima fase), e
        // sem esta guarda o lider clicando "Encerrar" numa partida que ja se encerrou sozinha
        // mandaria um segundo `match.finished` para a turma inteira. A rota continua devolvendo o
        // podio nos dois casos — quem clicou quer ve-lo de qualquer forma.
        if (!alreadyFinished)
        {
            await events.MatchFinishedAsync(room, podium, ct);
        }

        return podium;
    }

    /// <summary>
    /// Encerra a partida quando a fase que acabou de fechar era a ultima da fila.
    ///
    /// No modo ao vivo (Live), a partida NAO se encerra automaticamente ao fim da ultima fase:
    /// os participantes aguardam e o lider decide quando encerrar e revelar o podio simultaneamente
    /// atraves do botao de encerrar a partida.
    /// </summary>
    private async Task FinishIfLastPhaseAsync(Match match, Room room, CancellationToken ct)
    {
        if (match.Mode == MatchMode.Live)
        {
            return;
        }

        if (match.CurrentPhaseIndex + 1 < await CountPhasesAsync(match.RoomId, ct))
        {
            return;
        }

        await FinishCoreAsync(match, room, ct);
    }

    /// <summary>
    /// <c>POST /matches/{id}/return-to-lobby</c> — "volta todo mundo para o lobby".
    ///
    /// A partida e <b>encerrada</b>, e nao suspensa: e o que a faz entrar no historico do perfil
    /// (que filtra <c>FinishedAt != null</c>) e o que destrava a fila para o lider mexer nela de
    /// novo — o unico motivo de voltar ao lobby. Comecar outra partida cria outro <c>Match</c>.
    ///
    /// <b>Limpa o TTL</b> que <see cref="FinishCoreAsync"/> tinha marcado. Sem isso, a sala que
    /// terminou uma partida e voltou ao lobby continuaria morrendo em 24 h — viva na tela, expirada
    /// no banco. O TTL volta a ser marcado no fim da proxima partida.
    ///
    /// <b>Nao mexe em <c>InResultsSince</c>.</b> Quem esta no podio decide sozinho quando sair dele
    /// (<c>POST /rooms/{code}/participants/me/return</c>); o lider voltar ao lobby nao volta por
    /// ninguem.
    /// </summary>
    public async Task ReturnToLobbyAsync(string matchId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room) = await matchAccess.GetMatchAsLeaderAsync(matchId, principal, ct);
        var now = DateTimeOffset.UtcNow;

        match.Status = MatchStatus.Finished;
        match.FinishedAt ??= now;
        match.CurrentPhaseEndedAt ??= now;
        await matchRepo.SetMatchAsync(match, ct);

        var roomData = await repo.GetRoomAsync(room.Id.ToString(), ct);
        if (roomData != null)
        {
            roomData = roomData with {
                Status = RoomRedisData.ToRedis(RoomStatus.Lobby),
                MatchMode = null,
                ExpiresAtMs = null,
                QueueRevision = roomData.QueueRevision + 1,
                CurrentMatchId = null
            };
            await repo.SaveRoomAsync(roomData.Id, roomData, ct);
            room = roomData.ToEntity();
        }

        await events.ReturnedToLobbyAsync(room, ct);
    }

    /// <summary>
    /// <c>DELETE /matches/{id}/participants/{participantId}</c> — "expulsa da partida".
    ///
    /// Apaga a linha de participante, e com ela as submissoes (a pontuacao vai junto: quem saiu nao
    /// disputa mais o podio). As submissoes sao removidas explicitamente porque o EF InMemory dos
    /// testes nao cascateia, e porque o <c>phase.progress</c> logo abaixo precisa enxergar a fila
    /// ja sem elas.
    /// </summary>
    public async Task RemovePlayerAsync(string matchId, string participantId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room) = await matchAccess.GetMatchAsLeaderAsync(matchId, principal, ct);

        if (!Guid.TryParse(participantId, out var id))
        {
            throw ParticipantNotFound();
        }

        var pData = await repo.GetParticipantAsync(room.Id.ToString(), id.ToString(), ct);
        if (pData == null) throw ParticipantNotFound();

        await repo.RemoveParticipantAsync(room.Id.ToString(), id.ToString(), pData.DisplayName.ToLowerInvariant(), ct);

        // The submissions are kept in Redis. They will be ignored during calculations because the participant is rejected.

        await events.ParticipantRemovedAsync(room, id, ct);

        var phases = await PhasesAsync(match.RoomId, ct);
        if (phases.Count > 0)
        {
            await events.ProgressAsync(room, match, PhaseAt(match, phases), ct);
        }
    }

    /* ---------------------------------------------------------------------- */
    /* Secoes 9 e 10 — leituras                                                */
    /* ---------------------------------------------------------------------- */

    /// <summary>
    /// <c>GET /matches/{id}/phases/{phaseId}/stats</c>. Rota de lider — e a unica saida da partida
    /// que traz nome, tempo e acerto de cada aluno.
    ///
    /// Aceita qualquer fase da fila desta sala, e nao so a corrente: conferir o desempenho da fase
    /// anterior enquanto a turma joga a proxima e uso legitimo do painel.
    /// </summary>
    public async Task<PhaseStatsDto> GetStatsAsync(string matchId, string phaseId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room) = await matchAccess.GetMatchAsLeaderAsync(matchId, principal, ct);
        return await stats.GetStatsAsync(match, await FindPhaseAsync(match, phaseId, ct), ct);
    }

    /// <summary><c>GET /matches/{id}/podium</c> — leitura de membro; o lider tambem ve.</summary>
    public async Task<IReadOnlyList<PodiumEntryDto>> GetPodiumAsync(string matchId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room) = await matchAccess.GetMatchAsMemberAsync(matchId, principal, ct);
        return await stats.GetPodiumAsync(match, ct);
    }

    /* ---------------------------------------------------------------------- */
    /* Compartilhado com SubmissionService                                     */
    /* ---------------------------------------------------------------------- */

    /// <summary>
    /// Fecha a fase corrente <b>uma unica vez</b>, se o cronometro ja venceu, e publica
    /// <c>phase.ended</c>.
    ///
    /// A idempotencia mora em <c>CurrentPhaseEndedAt</c>: sem ela, toda leitura feita depois do fim
    /// republicaria o evento, e uma turma de 28 pessoas recarregando a pagina viraria 28
    /// <c>phase.ended</c>. Grava o instante <i>contratual</i> (o proprio <c>EndsAt</c>), e nao
    /// "agora": o fim da fase e quando o relogio virou, nao quando alguem reparou.
    /// </summary>
    public async Task<bool> CloseExpiredPhaseAsync(Match match, Room room, RoomQueuePhase phase, CancellationToken ct)
    {
        if (match.Status is not MatchStatus.Running || match.CurrentPhaseEndedAt is not null)
        {
            return false;
        }

        if (match.CurrentPhaseEndsAt is not { } endsAt || endsAt > DateTimeOffset.UtcNow.AddMilliseconds(250))
        {
            return false;
        }

        // Grava o instante contratual (o proprio EndsAt), e nao "agora": o fim da fase e quando o
        // relogio virou, nao quando alguem reparou.
        await ClosePhaseAsync(match, room, phase, endsAt, ct);

        return true;
    }

    /// <summary>
    /// Fecha a fase corrente: grava o instante, publica <c>phase.ended</c> e — se era a ultima da
    /// fila — encerra a partida.
    ///
    /// Ponto unico de fechamento, chamado pelos tres gatilhos que existem: o cronometro
    /// (<see cref="CloseExpiredPhaseAsync"/>), o ultimo envio da turma
    /// (<c>SubmissionService</c>) e o <c>advance</c> do lider. Antes de existir, o
    /// encerramento automatico teria de ser lembrado em cada um deles — e o esquecido seria
    /// justamente o do cronometro, que e o que ninguem testa a mao.
    ///
    /// Quem chama ja garantiu que a fase ainda estava aberta.
    /// </summary>
    public async Task ClosePhaseAsync(Match match, Room room, RoomQueuePhase phase, DateTimeOffset closedAt, CancellationToken ct)
    {
        match.CurrentPhaseEndedAt = closedAt;
        await matchRepo.SetMatchAsync(match, ct);

        await events.PhaseEndedAsync(room, phase.Id, ct);
        await events.ProgressAsync(room, match, phase, ct);
        await FinishIfLastPhaseAsync(match, room, ct);
    }

    /// <summary>
    /// "A fase corrente esta fechada?" — a pergunta que decide se o gabarito pode sair e se um envio
    /// ainda e aceito. Fechada por decisao do lider (<c>CurrentPhaseEndedAt</c>), por relogio
    /// vencido, ou porque a partida acabou.
    /// </summary>
    public static bool IsCurrentPhaseClosed(Match match, DateTimeOffset now)
        => match.Status is MatchStatus.Finished
           || match.CurrentPhaseEndedAt is not null
           || (match.Status is MatchStatus.Running && match.CurrentPhaseEndsAt is { } endsAt && endsAt <= now);

    /// <summary>
    /// "<i>Aquela</i> fase esta fechada?" — a versao por fase, para o <c>comparison</c>, que aceita
    /// qualquer fase da fila e nao so a corrente.
    ///
    /// Fase ja passada esta fechada por definicao; fase futura nunca esta, e isso importa: sem a
    /// comparacao por <c>OrderIndex</c>, pedir a comparacao da fase 5 durante a fase 3 seria um jeito
    /// de ler o gabarito adiantado.
    /// </summary>
    public static bool IsPhaseClosed(Match match, RoomQueuePhase phase, DateTimeOffset now)
        => phase.OrderIndex < match.CurrentPhaseIndex
           || (phase.OrderIndex == match.CurrentPhaseIndex && IsCurrentPhaseClosed(match, now));

    /// <summary>As fases da fila da sala, na ordem em que a partida as executa.</summary>
    public async Task<List<RoomQueuePhase>> PhasesAsync(Guid roomId, CancellationToken ct)
    {
        var pDatas = await repo.GetQueuePhasesAsync(roomId.ToString(), ct);
        return pDatas.Select(p => p.ToEntity(roomId.ToString())).OrderBy(p => p.OrderIndex).ToList();
    }

    /// <summary>
    /// A fase que a partida esta executando.
    ///
    /// O indice e limitado ao tamanho da fila em vez de estourar: a fila e imutavel durante a
    /// partida, entao isto nao deveria acontecer — e se acontecer (uma sala remendada a mao no
    /// banco), a aula segue na ultima fase em vez de a tela morrer.
    /// </summary>
    public static RoomQueuePhase PhaseAt(Match match, IReadOnlyList<RoomQueuePhase> phases)
        => phases.Count is 0
            ? throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.EmptyQueue, "A fila desta sala esta vazia.")
            : phases[Math.Clamp(match.CurrentPhaseIndex, 0, phases.Count - 1)];

    /// <summary>
    /// O estado completo da fase para quem esta olhando — corpo do <c>current-phase</c> e do evento
    /// <c>phase.started</c>.
    ///
    /// <b><c>includeAnswers</c> segue a fase, nao o papel de quem pediu.</b> O gabarito sai quando a
    /// fase fecha, para todo mundo, e nao sai antes para ninguem — nem para o lider. Isso vale
    /// inclusive porque este mesmo payload viaja no <c>phase.started</c>, que vai por um canal
    /// coletivo: uma regra por papel aqui viraria vazamento la. O lider ve a resposta certa pelo
    /// modal "Ver desafio" da secao 6 e pelo <c>answerDistribution</c>, que vao por rotas dele.
    /// </summary>
    public async Task<PhaseStateDto> BuildPhaseStateAsync(
        Match match,
        RoomQueuePhase phase,
        Guid? participantId,
        int totalPhases,
        CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var closed = IsCurrentPhaseClosed(match, now);

        var mine = participantId is { } id
            ? (await matchRepo.GetSubmissionsAsync(match.Id.ToString(), phase.Id.ToString(), ct))
                .FirstOrDefault(s => s.ParticipantId == id)
            : null;

        return new PhaseStateDto(
            PhaseProjection.ToPhase(phase.ToRedisData(), includeAnswers: closed),
            match.CurrentPhaseIndex + 1,
            totalPhases,
            SecondsLeft(match, now),
            match.Status is MatchStatus.Paused,
            (await matchRepo.GetPhaseAggregatesAsync(match.Id.ToString(), phase.Id.ToString(), ct)).Submitted,
            await stats.CountPlayersAsync(match.RoomId, ct),
            mine is null ? null : SubmissionProjection.ToDto(mine),
            match.CurrentPhaseStartedAt?.ToUnixTimeMilliseconds());
    }

    public const int IntroDurationSeconds = 5;

    /// <summary>
    /// Quantos segundos faltam. Arredonda para cima para que uma fase de 45 s abra mostrando "45" e
    /// nao "44" — o instante do calculo ja e alguns milissegundos depois do inicio.
    /// </summary>
    public static int SecondsLeft(Match match, DateTimeOffset now)
    {
        if (match.Status is MatchStatus.Paused)
        {
            return match.PausedSecondsLeft ?? 0;
        }

        if (match.CurrentPhaseEndsAt is not { } endsAt)
        {
            return 0;
        }

        // Se ainda está na introdução animada, o cronômetro do desafio ainda não começou a correr
        if (match.CurrentPhaseStartedAt is { } startedAt && now < startedAt)
        {
            return (int)Math.Max(0, Math.Ceiling((endsAt - startedAt).TotalSeconds));
        }

        return (int)Math.Max(0, Math.Ceiling((endsAt - now).TotalSeconds));
    }

    public async Task<RoomQueuePhase> FindPhaseAsync(Match match, string phaseId, CancellationToken ct)
    {
        if (!Guid.TryParse(phaseId, out var id))
        {
            throw PhaseNotFound();
        }

        var pData = await repo.GetQueuePhaseAsync(match.RoomId.ToString(), phaseId, ct);
        if (pData == null) throw PhaseNotFound();
        return pData.ToEntity(match.RoomId.ToString());
    }

    public async Task<int> CountPhasesAsync(Guid roomId, CancellationToken ct)
    {
        var pDatas = await repo.GetQueuePhasesAsync(roomId.ToString(), ct);
        return pDatas.Count;
    }

    public static MatchDto ToDto(Match match, int totalPhases) => new(
        match.Id,
        match.RoomId,
        match.Mode,
        match.Status,
        match.CurrentPhaseIndex,
        totalPhases,
        match.StartedAt);

    /* ---------------------------------------------------------------------- */

    /// <summary>
    /// Zera o cronometro para a fase indicada. O <c>CurrentPhaseEndedAt</c> volta a nulo aqui, e nao
    /// em cada chamador, porque "comecar uma fase" e "ela nao esta fechada" sao a mesma afirmacao —
    /// separa-las e como o codigo esqueceria de reabrir a fase num reinicio.
    /// Inclui a janela de introducao/aquecimento sincronizada de 5 segundos.
    /// </summary>
    private static void StartPhaseClock(Match match, RoomQueuePhase phase, DateTimeOffset now)
    {
        match.CurrentPhaseStartedAt = now.AddSeconds(IntroDurationSeconds);
        match.CurrentPhaseEndsAt = match.CurrentPhaseStartedAt.Value.AddSeconds(phase.TimeSeconds);
        match.CurrentPhaseEndedAt = null;
        match.PausedSecondsLeft = null;
    }

    /// <summary>Controles do lider numa partida ja encerrada nao tem o que controlar.</summary>
    private async Task<(Match Match, Room Room)> GetActiveMatchAsLeaderAsync(string matchId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room) = await matchAccess.GetMatchAsLeaderAsync(matchId, principal, ct);

        if (match.Status is MatchStatus.Finished)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.PhaseClosed, "Esta partida ja foi encerrada.");
        }

        return (match, room);
    }

    /// <summary>
    /// <c>self-paced</c> esta no contrato e o lobby oferece o botao, mas nao ha caminho de avanco
    /// para o aluno em lugar nenhum — nem rota, nem coluna de progresso individual, e o servico de
    /// WS descartaria um <c>phase.started</c> no canal privado. Rodar como "live" prometendo o
    /// contrario e pior que recusar (decisao 2 de match-implementation-model.md).
    /// </summary>
    private static MatchMode ParseMode(string? mode) => mode switch
    {
        "live" => MatchMode.Live,
        "self-paced" => throw new ApiException(
            StatusCodes.Status409Conflict,
            ErrorCodes.ModeNotAvailable,
            "O modo em que cada um joga no proprio ritmo ainda nao esta disponivel."),
        _ => throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "mode deve ser \"live\" ou \"self-paced\"."),
    };

    private static ApiException PhaseNotFound()
        => new(StatusCodes.Status404NotFound, ErrorCodes.PhaseNotFound, "Fase nao encontrada nesta sala.");

    private static ApiException ParticipantNotFound()
        => new(StatusCodes.Status404NotFound, ErrorCodes.ParticipantNotFound, "Participante nao encontrado nesta sala.");
}
