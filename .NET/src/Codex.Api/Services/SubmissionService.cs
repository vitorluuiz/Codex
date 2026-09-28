using System.Security.Claims;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Matches;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// As rotas que so um <b>jogador</b> chama: enviar resposta e marcar pronto (secao 8), ver a propria
/// comparacao com a turma e o proprio placar (secao 9).
///
/// Estao juntas por causa da resolucao que todas compartilham — <c>MatchAccessService.GetPlayerAsync</c>,
/// "quem chamou joga esta partida?" —, que e diferente da do <see cref="MatchService"/> (membro ou
/// lider). O lider nao aparece em nenhuma delas: ele nao responde, nao se compara e nao tem placar
/// proprio.
/// </summary>
public class SubmissionService(
    AppDbContext db,
    MatchAccessService matchAccess,
    MatchService matches,
    MatchStatsService stats,
    MatchEventPublisher events)
{
    /// <summary>
    /// <c>POST /matches/{matchId}/phases/{phaseId}/submissions</c>.
    ///
    /// <b>O tempo e todo do servidor.</b> <c>elapsedSeconds</c> sai de
    /// <c>submittedAt - CurrentPhaseStartedAt</c> e o bonus sai do que faltava para
    /// <c>CurrentPhaseEndsAt</c> — o corpo da requisicao nao tem campo de tempo nenhum, e nao por
    /// esquecimento: um cliente que informasse o proprio tempo compraria bonus.
    ///
    /// <b>quiz e fill voltam corrigidos; text e code voltam pendentes.</b> Os dois ultimos dependem
    /// de IA e de sandbox, que nao existem — e "pendente" e exatamente o estado que o contrato
    /// descreve para eles, com a tela mostrando "sua resposta esta sendo avaliada". Quando o corretor
    /// existir, o que muda e quem preenche a nota depois, nao esta rota.
    /// </summary>
    public async Task<SubmissionDto> SubmitAsync(
        string matchId,
        string phaseId,
        SubmitAnswerRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var (match, room, player) = await matchAccess.GetPlayerAsync(matchId, principal, ct);
        var phases = await matches.PhasesAsync(match.RoomId, ct);
        var phase = MatchService.PhaseAt(match, phases);

        // Fecha a fase antes de decidir se aceita: sem isto, o primeiro envio depois do fim do
        // cronometro seria aceito por nao haver quem tivesse marcado o fim.
        await matches.CloseExpiredPhaseAsync(match, room, phase, ct);

        var now = DateTimeOffset.UtcNow;

        // Enviar para uma fase que nao e a corrente e o mesmo erro que enviar tarde demais: a fase
        // que a pessoa tinha na tela nao esta mais aberta. Vale para a anterior e para a proxima.
        if (!Guid.TryParse(phaseId, out var id) || id != phase.Id)
        {
            throw PhaseClosed();
        }

        // <b>Antes</b> da checagem de fase fechada, e a ordem importa. Quando o ultimo aluno responde,
        // a fase fecha na hora — entao um segundo clique dele cairia em PHASE_CLOSED, e a tela diria
        // "a fase acabou" a quem na verdade ja tinha respondido. Numa sala de um aluno so,
        // PHASE_ALREADY_SUBMITTED nunca aconteceria. Das duas verdades, "voce ja respondeu" e a que
        // descreve o que a pessoa fez.
        //
        // Isto e checagem em codigo <i>alem</i> do indice unico do banco: ela devolve o 409 do
        // contrato, enquanto a constraint devolveria um 500. O indice continua sendo a garantia de
        // verdade — ele e quem decide a corrida entre dois cliques simultaneos.
        if (await db.Submissions.AnyAsync(
                s => s.MatchId == match.Id && s.RoomQueuePhaseId == phase.Id && s.ParticipantId == player.Id, ct))
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.PhaseAlreadySubmitted, "Voce ja respondeu esta fase.");
        }

        if (MatchService.IsCurrentPhaseClosed(match, now))
        {
            throw PhaseClosed();
        }

        var answer = PhaseGrading.Validate(phase, request.Answer);

        var startedAt = match.CurrentPhaseStartedAt ?? now;
        var outcome = PhaseGrading.Grade(phase, answer, MatchService.SecondsLeft(match, now));

        var submission = new Submission
        {
            MatchId = match.Id,
            RoomQueuePhaseId = phase.Id,
            ParticipantId = player.Id,
            AnswerJson = answer.ToJson(),
            SubmittedAt = now,
            // Literal como o contrato define (submittedAt - phaseStartedAt), inclusive o tempo em
            // que a partida esteve pausada. O bonus de pontuacao desconta a pausa, este numero nao:
            // ele e o "tempo de resposta" que o painel do lider mostra.
            ElapsedSeconds = (int)Math.Max(0, Math.Round((now - startedAt).TotalSeconds)),
            Grading = outcome.Grading,
            Correct = outcome.Correct,
            Score = outcome.Score,
        };

        db.Submissions.Add(submission);
        await db.SaveChangesAsync(ct);

        await CloseIfEveryoneAnsweredAsync(match, room, phase, now, ct);
        await events.ProgressAsync(room, match, phase, ct);

        return SubmissionProjection.ToDto(submission);
    }

    /// <summary>
    /// <c>POST /matches/{matchId}/phases/{phaseId}/ready</c> — "marca o aluno como pronto para
    /// avancar. Alimenta o card 'Prontos para a proxima fase' do painel do lider."
    ///
    /// Marca na <b>propria submissao</b> (ver <c>Submission.ReadyAt</c>): no front o botao so existe
    /// na tela de comparacao, e so se chega la depois de responder. Quem chamar sem ter respondido
    /// leva <c>400 VALIDATION_ERROR</c> — corpo que a tela nao produz.
    ///
    /// Idempotente: marcar duas vezes mantem o primeiro instante. O contador do painel conta pessoas,
    /// nao cliques.
    /// </summary>
    public async Task MarkReadyAsync(string matchId, string phaseId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room, player) = await matchAccess.GetPlayerAsync(matchId, principal, ct);
        var phases = await matches.PhasesAsync(match.RoomId, ct);
        var phase = MatchService.PhaseAt(match, phases);

        if (!Guid.TryParse(phaseId, out var id) || id != phase.Id)
        {
            throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.PhaseNotFound, "Fase nao encontrada nesta partida.");
        }

        var submission = await db.Submissions.FirstOrDefaultAsync(
                             s => s.MatchId == match.Id && s.RoomQueuePhaseId == phase.Id && s.ParticipantId == player.Id, ct)
                         ?? throw new ApiException(
                             StatusCodes.Status400BadRequest,
                             ErrorCodes.ValidationError,
                             "Responda a fase antes de marcar que esta pronto.");

        if (submission.ReadyAt is null)
        {
            submission.ReadyAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
        }

        await events.ProgressAsync(room, match, phase, ct);
    }

    /// <summary>
    /// <c>GET /matches/{matchId}/phases/{phaseId}/comparison</c>.
    ///
    /// "So responde depois que a fase fechou (<c>409 PHASE_STILL_OPEN</c> antes disso) — e aqui que o
    /// gabarito finalmente sai." Fase futura tambem e "ainda aberta": pedir a comparacao da fase 5
    /// durante a fase 3 nao pode ser um jeito de ler o gabarito adiantado.
    /// </summary>
    public async Task<PhaseComparisonDto> GetComparisonAsync(
        string matchId,
        string phaseId,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var (match, room, player) = await matchAccess.GetPlayerAsync(matchId, principal, ct);
        var phase = await matches.FindPhaseAsync(match, phaseId, ct);
        var phases = await matches.PhasesAsync(match.RoomId, ct);

        await matches.CloseExpiredPhaseAsync(match, room, MatchService.PhaseAt(match, phases), ct);

        if (!MatchService.IsPhaseClosed(match, phase, DateTimeOffset.UtcNow))
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.PhaseStillOpen, "A fase ainda esta aberta.");
        }

        return await stats.GetComparisonAsync(match, phase, player, ct);
    }

    /// <summary><c>GET /matches/{matchId}/scoreboard/me</c>.</summary>
    public async Task<PlayerScoreboardDto> GetScoreboardAsync(string matchId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var (match, room, player) = await matchAccess.GetPlayerAsync(matchId, principal, ct);
        return await stats.GetScoreboardAsync(match, player, ct);
    }

    /// <summary>
    /// Fecha a fase quando o ultimo aprovado responde — o outro gatilho de <c>phase.ended</c> alem do
    /// relogio e do <c>advance</c> ("todos enviaram (ou endsAt passou) → API publica phase.ended",
    /// contrato de WS §11).
    ///
    /// A comparacao e <c>&gt;=</c>, e nao <c>==</c>: se o lider remover alguem no meio da fase, o
    /// numero de aprovados cai e a igualdade nunca aconteceria.
    /// </summary>
    private async Task CloseIfEveryoneAnsweredAsync(Match match, Room room, RoomQueuePhase phase, DateTimeOffset now, CancellationToken ct)
    {
        if (match.CurrentPhaseEndedAt is not null)
        {
            return;
        }

        var submitted = await db.Submissions.CountAsync(s => s.MatchId == match.Id && s.RoomQueuePhaseId == phase.Id, ct);
        if (submitted < await stats.CountPlayersAsync(match.RoomId, ct))
        {
            return;
        }

        // Fechamento pelo ponto unico do MatchService: e ele que decide tambem se a partida acabou
        // (esta era a ultima fase da fila). Publicar phase.ended aqui direto deixaria a turma na
        // comparacao da ultima fase, esperando um proximo passo que nao viria.
        await matches.ClosePhaseAsync(match, room, phase, now, ct);
    }

    private static ApiException PhaseClosed()
        => new(StatusCodes.Status409Conflict, ErrorCodes.PhaseClosed, "Esta fase nao esta mais aberta para respostas.");
}
