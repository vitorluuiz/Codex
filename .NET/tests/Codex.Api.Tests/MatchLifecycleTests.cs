using Codex.Api.Common.Errors;
using Codex.Api.Common.Realtime;
using Codex.Api.Contracts.Matches;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Domain;
using Codex.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Tests;

/// <summary>
/// api-rest.md secoes 7 e 10 — comecar a partida, ler a fase corrente e os controles do lider. A
/// correcao esta em <see cref="SubmissionTests"/> e os numeros em <see cref="MatchStatsTests"/>.
/// </summary>
public class MatchLifecycleTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static readonly StartMatchRequest Live = new("live");

    /// <summary>Sala com uma fila jogavel e um aluno aprovado — o minimo para <c>POST /match</c> passar.</summary>
    private static async Task<RoomTestContext> PlayableRoomAsync(int phaseCount = 2, int timeSeconds = 45)
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPlayableSet(ctx.Leader, "Frações", phaseCount, timeSeconds));
        ctx.AddParticipant("Ana Silva");
        return ctx;
    }

    /* ------------------------------------------------------ POST /rooms/{code}/match */

    [Fact]
    public async Task Starting_a_match_takes_the_room_out_of_the_lobby()
    {
        var ctx = await PlayableRoomAsync();

        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        Assert.Equal(MatchMode.Live, match.Mode);
        Assert.Equal(MatchStatus.Running, match.Status);
        Assert.Equal(0, match.CurrentPhaseIndex);
        Assert.Equal(2, match.TotalPhases);
        Assert.Equal(RoomStatus.Running, ctx.Room.Status);
        Assert.Equal(MatchMode.Live, ctx.Room.MatchMode);
    }

    /// <summary>
    /// A guarda foi escrita na leva da secao 6 e ate agora nada a fazia disparar, porque nada tirava
    /// a sala do lobby. Este e o teste que fecha aquele ciclo.
    /// </summary>
    [Fact]
    public async Task Queue_freezes_once_the_match_starts()
    {
        var ctx = await PlayableRoomAsync();
        var extra = ctx.AddPlayableSet(ctx.Leader, "Extra", phaseCount: 1);

        await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(extra.Id.ToString()), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.MatchAlreadyStarted, error.Code);
        Assert.Equal(StatusCodes.Status409Conflict, error.StatusCode);
    }

    [Fact]
    public async Task Empty_queue_is_EMPTY_QUEUE()
    {
        var ctx = new RoomTestContext();
        ctx.AddParticipant("Ana Silva");

        var error = await Assert.ThrowsAsync<ApiException>(() => ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.EmptyQueue, error.Code);
    }

    [Fact]
    public async Task No_approved_participant_is_NO_PLAYERS()
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPlayableSet(ctx.Leader, "Frações"));
        ctx.AddParticipant("Ana Silva", ParticipantStatus.Pending);

        var error = await Assert.ThrowsAsync<ApiException>(() => ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.NoPlayers, error.Code);
    }

    /// <summary>
    /// O portao que a secao 5 deixou marcado: "rascunho incompleto salva; quem deveria cobrar fase
    /// completa e o inicio da partida". O conjunto padrao de <c>AddPhaseSet</c> e exatamente um
    /// rascunho desses — quiz sem alternativa nenhuma.
    /// </summary>
    [Fact]
    public async Task Incomplete_phase_blocks_the_start_and_names_the_phase()
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPhaseSet(ctx.Leader, "Rascunho", phaseCount: 1));
        ctx.AddParticipant("Ana Silva");

        var error = await Assert.ThrowsAsync<ApiException>(() => ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.IncompletePhase, error.Code);
        Assert.Contains("Fase 1", error.Message);
    }

    /// <summary>Todas as fases, e nao so a primeira — descobrir na fase 6 seria descobrir no meio da aula.</summary>
    [Fact]
    public async Task Incomplete_phase_is_caught_even_when_it_is_not_the_first()
    {
        var ctx = await PlayableRoomAsync(phaseCount: 1);
        await ctx.EnqueueAsync(ctx.AddPhaseSet(ctx.Leader, "Rascunho", phaseCount: 1));

        var error = await Assert.ThrowsAsync<ApiException>(() => ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.IncompletePhase, error.Code);
    }

    [Fact]
    public async Task Self_paced_is_refused_while_it_has_no_advance_path()
    {
        var ctx = await PlayableRoomAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Matches.StartAsync(ctx.Room.Code, new StartMatchRequest("self-paced"), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.ModeNotAvailable, error.Code);
        Assert.Equal(RoomStatus.Lobby, ctx.Room.Status);
    }

    /// <summary>
    /// Modo desconhecido cai na validacao do app, e nao no desserializador — e por isso que
    /// <c>mode</c> trafega como string. Um enum aqui responderia 500.
    /// </summary>
    [Fact]
    public async Task Unknown_mode_is_VALIDATION_ERROR()
    {
        var ctx = await PlayableRoomAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Matches.StartAsync(ctx.Room.Code, new StartMatchRequest("blitz"), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.ValidationError, error.Code);
        Assert.Equal(StatusCodes.Status400BadRequest, error.StatusCode);
    }

    [Fact]
    public async Task Only_the_leader_starts_a_match()
    {
        var ctx = await PlayableRoomAsync();
        var stranger = ctx.AddUser("Outro", "outro@escola.br");

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Matches.StartAsync(ctx.Room.Code, Live, RoomTestContext.AsUser(stranger.Id), Ct));

        Assert.Equal(ErrorCodes.NotRoomLeader, error.Code);
    }

    [Fact]
    public async Task Starting_publishes_match_started_on_the_room_channel_and_phase_started_on_the_match_channel()
    {
        var ctx = await PlayableRoomAsync();

        await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        var started = Assert.Single(ctx.Realtime.OfType<MatchStartedEvent>());
        Assert.Equal(RealtimeChannels.Room(ctx.Room.Code), started.Channel);

        var phase = Assert.Single(ctx.Realtime.OfType<PhaseStartedEvent>());
        Assert.Equal(RealtimeChannels.Match(ctx.Room.Code), phase.Channel);
        Assert.Equal(1, phase.As<PhaseStartedEvent>().PhaseNumber);
        Assert.NotNull(phase.As<PhaseStartedEvent>().EndsAt);
    }

    /// <summary>
    /// O evento vai por um canal que a turma inteira assina. Se ele carregasse gabarito, o contrato
    /// de WS §3 ("o pior caso vaza um contador, nao uma resposta") estaria quebrado — e nem a
    /// autorizacao de canal ajudaria, porque o canal e legitimo.
    /// </summary>
    [Fact]
    public async Task Phase_started_never_carries_the_answer_key()
    {
        var ctx = await PlayableRoomAsync();

        await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        var state = Assert.Single(ctx.Realtime.OfType<PhaseStartedEvent>()).As<PhaseStartedEvent>().State;
        Assert.Null(state.Phase.CorrectOptionId);
    }

    /* --------------------------------------------------- GET /rooms/{code}/match */

    [Fact]
    public async Task Room_without_a_match_is_MATCH_NOT_FOUND()
    {
        var ctx = await PlayableRoomAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => ctx.Matches.GetByRoomAsync(ctx.Room.Code, ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.MatchNotFound, error.Code);
        Assert.Equal(StatusCodes.Status404NotFound, error.StatusCode);
    }

    [Fact]
    public async Task Match_id_that_does_not_parse_is_MATCH_NOT_FOUND()
    {
        var ctx = await PlayableRoomAsync();
        await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        var error = await Assert.ThrowsAsync<ApiException>(() => ctx.Matches.GetCurrentPhaseAsync("nao-e-guid", ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.MatchNotFound, error.Code);
    }

    /// <summary>Nao e 403: a partida nao e mais publica que a sala que a contem.</summary>
    [Fact]
    public async Task Stranger_reading_a_match_is_MATCH_NOT_FOUND()
    {
        var ctx = await PlayableRoomAsync();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var stranger = ctx.AddUser("Outro", "outro@escola.br");

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), RoomTestContext.AsUser(stranger.Id), Ct));

        Assert.Equal(ErrorCodes.MatchNotFound, error.Code);
    }

    /* ------------------------------------------- GET /matches/{id}/current-phase */

    /// <summary>
    /// A "regra de ouro" da secao 7. Vale para o lider tambem, e nao por excesso de zelo: este mesmo
    /// payload viaja no <c>phase.started</c>, que vai por canal coletivo — uma regra por papel aqui
    /// viraria vazamento la.
    /// </summary>
    [Fact]
    public async Task Open_phase_hides_the_answer_key_from_everyone()
    {
        var ctx = await PlayableRoomAsync();
        var player = ctx.Db.Participants.Single();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        var forLeader = await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        var forPlayer = await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsParticipant(player.Id), Ct);

        Assert.Null(forLeader.Phase.CorrectOptionId);
        Assert.Null(forPlayer.Phase.CorrectOptionId);
    }

    [Fact]
    public async Task Closed_phase_releases_the_answer_key()
    {
        var ctx = await PlayableRoomAsync();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        Expire(ctx, match.Id);

        var state = await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal("o1", state.Phase.CorrectOptionId);
    }

    [Fact]
    public async Task Current_phase_counts_the_class_and_the_clock()
    {
        var ctx = await PlayableRoomAsync(timeSeconds: 60);
        ctx.AddParticipant("Bruno Costa");
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        var state = await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(1, state.PhaseNumber);
        Assert.Equal(2, state.TotalPhases);
        Assert.Equal(2, state.TotalPlayers);
        Assert.Equal(0, state.SubmittedCount);
        Assert.False(state.Paused);
        Assert.InRange(state.SecondsLeft, 59, 60);
        Assert.Null(state.MySubmission);
    }

    /* ----------------------------------------------------- fechamento preguicoso */

    /// <summary>
    /// Sem a coluna <c>CurrentPhaseEndedAt</c>, cada leitura feita depois do fim republicaria o
    /// evento — uma turma de 28 pessoas recarregando a pagina viraria 28 <c>phase.ended</c>.
    /// </summary>
    [Fact]
    public async Task Expired_phase_publishes_phase_ended_exactly_once()
    {
        var ctx = await PlayableRoomAsync();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        Expire(ctx, match.Id);

        await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Single(ctx.Realtime.OfType<PhaseEndedEvent>());
    }

    /// <summary>O fim da fase e quando o relogio virou, nao quando alguem reparou.</summary>
    [Fact]
    public async Task Closing_records_the_contractual_instant_not_the_moment_someone_noticed()
    {
        var ctx = await PlayableRoomAsync();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var endsAt = Expire(ctx, match.Id);

        await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(endsAt, ctx.Db.Matches.Single().CurrentPhaseEndedAt);
    }

    /* ------------------------------------------------------------------ advance */

    [Fact]
    public async Task Advancing_moves_to_the_next_phase_and_restarts_the_clock()
    {
        var ctx = await PlayableRoomAsync(timeSeconds: 30);
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        await ctx.Matches.AdvanceAsync(match.Id.ToString(), new AdvanceMatchRequest("next"), ctx.AsLeader, Ct);

        var state = await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        Assert.Equal(2, state.PhaseNumber);
        Assert.InRange(state.SecondsLeft, 29, 30);
        Assert.Null(ctx.Db.Matches.Single().CurrentPhaseEndedAt);
    }

    /// <summary>
    /// A ordem importa: <c>phase.ended</c> tira quem estava esperando da tela de espera e
    /// <c>phase.started</c> leva todo mundo para a fase nova. Invertida, a transicao se perderia.
    /// </summary>
    [Fact]
    public async Task Advancing_closes_the_outgoing_phase_before_opening_the_next()
    {
        var ctx = await PlayableRoomAsync();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        ctx.Realtime.Published.Clear();

        await ctx.Matches.AdvanceAsync(match.Id.ToString(), new AdvanceMatchRequest("next"), ctx.AsLeader, Ct);

        var types = ctx.Realtime.Published.Select(e => e.Payload.GetType()).ToList();
        Assert.True(types.IndexOf(typeof(PhaseEndedEvent)) < types.IndexOf(typeof(PhaseStartedEvent)));
    }

    [Fact]
    public async Task Previous_is_INVALID_DIRECTION_in_live()
    {
        var ctx = await PlayableRoomAsync();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Matches.AdvanceAsync(match.Id.ToString(), new AdvanceMatchRequest("previous"), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.InvalidDirection, error.Code);
    }

    [Fact]
    public async Task Advancing_past_the_last_phase_is_INVALID_DIRECTION()
    {
        var ctx = await PlayableRoomAsync(phaseCount: 1);
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Matches.AdvanceAsync(match.Id.ToString(), new AdvanceMatchRequest("next"), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.InvalidDirection, error.Code);
    }

    /* -------------------------------------------------------------------- pause */

    [Fact]
    public async Task Pausing_stops_the_clock_and_resuming_shifts_it_forward()
    {
        var ctx = await PlayableRoomAsync(timeSeconds: 60);
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        await ctx.Matches.SetPausedAsync(match.Id.ToString(), new PauseMatchRequest(true), ctx.AsLeader, Ct);

        var paused = await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        Assert.True(paused.Paused);
        Assert.InRange(paused.SecondsLeft, 59, 60);
        Assert.Null(ctx.Db.Matches.Single().CurrentPhaseEndsAt);

        // O tempo passa enquanto a partida esta congelada, e nao pode ser cobrado da turma.
        ctx.Db.Matches.Single().PausedSecondsLeft = 42;
        await ctx.Db.SaveChangesAsync(Ct);

        await ctx.Matches.SetPausedAsync(match.Id.ToString(), new PauseMatchRequest(false), ctx.AsLeader, Ct);

        var resumed = await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        Assert.False(resumed.Paused);
        Assert.InRange(resumed.SecondsLeft, 41, 42);
    }

    /// <summary>Dois cliques rapidos no toggle nao podem devolver tempo a turma.</summary>
    [Fact]
    public async Task Pausing_twice_does_nothing_the_second_time()
    {
        var ctx = await PlayableRoomAsync(timeSeconds: 60);
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        await ctx.Matches.SetPausedAsync(match.Id.ToString(), new PauseMatchRequest(true), ctx.AsLeader, Ct);
        ctx.Db.Matches.Single().PausedSecondsLeft = 10;
        await ctx.Db.SaveChangesAsync(Ct);

        await ctx.Matches.SetPausedAsync(match.Id.ToString(), new PauseMatchRequest(true), ctx.AsLeader, Ct);

        Assert.Equal(10, ctx.Db.Matches.Single().PausedSecondsLeft);
        Assert.Single(ctx.Realtime.OfType<PhasePausedEvent>());
    }

    /* ------------------------------------------------------------------ restart */

    [Fact]
    public async Task Restarting_clears_the_submissions_and_reopens_the_phase()
    {
        var ctx = await PlayableRoomAsync();
        var player = ctx.Db.Participants.Single();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var phase = await CurrentPhaseIdAsync(ctx, match);

        await ctx.Submissions.SubmitAsync(
            match.Id.ToString(), phase.ToString(), Quiz("o1"), ctx.AsParticipant(player.Id), Ct);

        await ctx.Matches.RestartPhaseAsync(match.Id.ToString(), phase.ToString(), ctx.AsLeader, Ct);

        Assert.Empty(ctx.Db.Submissions);
        Assert.Null(ctx.Db.Matches.Single().CurrentPhaseEndedAt);
    }

    /// <summary>
    /// Reiniciar uma fase ja passada moveria a partida para tras — a mesma coisa que
    /// <c>INVALID_DIRECTION</c> proibe no modo ao vivo, por outra porta.
    /// </summary>
    [Fact]
    public async Task Restarting_a_phase_that_is_not_the_current_one_is_PHASE_CLOSED()
    {
        var ctx = await PlayableRoomAsync();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var first = await CurrentPhaseIdAsync(ctx, match);

        await ctx.Matches.AdvanceAsync(match.Id.ToString(), new AdvanceMatchRequest("next"), ctx.AsLeader, Ct);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Matches.RestartPhaseAsync(match.Id.ToString(), first.ToString(), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.PhaseClosed, error.Code);
    }

    /* ------------------------------------------------------------------- finish */

    /// <summary>
    /// <c>Room.ExpiresAt</c> existe desde a base inicial e nada o preenchia — cada sala segurava um
    /// codigo de 6 digitos para sempre. <c>finish</c> e o primeiro lugar do sistema que sabe o
    /// <c>finishedAt</c> de que o TTL da secao 13 depende.
    /// </summary>
    [Fact]
    public async Task Finishing_fills_the_TTL_and_leaves_the_room_standing()
    {
        var ctx = await PlayableRoomAsync();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        await ctx.Matches.FinishAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        var finished = ctx.Db.Matches.Single();
        Assert.Equal(MatchStatus.Finished, finished.Status);
        Assert.NotNull(finished.FinishedAt);
        Assert.Equal(finished.FinishedAt!.Value.AddHours(24), ctx.Room.ExpiresAt);

        // A PARTIDA acabou; a SALA nao. `RoomStatus.Finished` e terminal — some do
        // /rooms/active, recusa entrada nova e trava a fila — e encerrar partida deixou de
        // significar isso quando o fim da fila passou a encerrar sozinho.
        Assert.Equal(RoomStatus.Running, ctx.Room.Status);
    }

    /// <summary>
    /// A sala do podio continua no "Voltar para a sala": e por ela que o lider volta se fechar a
    /// aba antes de devolver a turma ao lobby. Sem isto ele perdia a sala inteira ao fim de cada
    /// partida — nem pelo perfil, nem digitando o codigo.
    /// </summary>
    [Fact]
    public async Task Room_stays_reachable_after_the_match_ends()
    {
        var ctx = await PlayableRoomAsync();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        await ctx.Matches.FinishAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Single(await ctx.Rooms.ListActiveAsync(ctx.AsLeader, Ct));
    }

    /// <summary>
    /// O caminho inteiro do defeito relatado: partida acaba, o aluno sai do podio, o lider devolve
    /// a sala ao lobby e comeca outra. Cada passo so funciona porque encerrar deixou de matar a
    /// sala — antes, o ultimo <c>StartAsync</c> respondia "esta sala ja tem uma partida em
    /// andamento" e nao havia caminho nenhum de volta.
    /// </summary>
    [Fact]
    public async Task Leader_starts_a_second_match_after_everyone_returns_to_the_lobby()
    {
        var ctx = await PlayableRoomAsync();
        var player = ctx.Db.Participants.Single();
        var first = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        await ctx.Matches.FinishAsync(first.Id.ToString(), ctx.AsLeader, Ct);
        await ctx.Participants.ReturnToLobbyAsync(ctx.Room.Code, ctx.AsParticipant(player.Id), Ct);
        await ctx.Matches.ReturnToLobbyAsync(first.Id.ToString(), ctx.AsLeader, Ct);

        var second = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        Assert.NotEqual(first.Id, second.Id);
        Assert.Equal(2, ctx.Db.Matches.Count());
        // Comecar apaga o TTL que o fim da primeira marcou.
        Assert.Null(ctx.Room.ExpiresAt);
    }

    /// <summary>O botao fica na tela a partida inteira; dois cliques nao podem mover o TTL.</summary>
    [Fact]
    public async Task Finishing_twice_keeps_the_first_instant()
    {
        var ctx = await PlayableRoomAsync();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        await ctx.Matches.FinishAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        var first = ctx.Db.Matches.Single().FinishedAt;

        await ctx.Matches.FinishAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(first, ctx.Db.Matches.Single().FinishedAt);
    }

    /// <summary>Um <c>Match</c> com <c>FinishedAt</c> e o que acende o historico do perfil, que ate agora saia sempre vazio.</summary>
    [Fact]
    public async Task Finished_match_shows_up_in_the_leader_profile_history()
    {
        var ctx = await PlayableRoomAsync();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        await ctx.Matches.FinishAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        var profile = await ctx.Profiles.GetProfileAsync(ctx.Leader.Id.ToString(), ctx.AsLeader, Ct);
        Assert.Single(profile.Matches);
    }

    /* ---------------------------------------------------------- return-to-lobby */

    [Fact]
    public async Task Returning_to_the_lobby_ends_the_match_and_unfreezes_the_queue()
    {
        var ctx = await PlayableRoomAsync();
        var extra = ctx.AddPlayableSet(ctx.Leader, "Extra", phaseCount: 1);
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        await ctx.Matches.ReturnToLobbyAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(RoomStatus.Lobby, ctx.Room.Status);
        Assert.Null(ctx.Room.MatchMode);
        Assert.NotNull(ctx.Db.Matches.Single().FinishedAt);
        Assert.Null(ctx.Room.ExpiresAt);

        // A fila volta a aceitar mutacao — o unico motivo de voltar ao lobby.
        await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(extra.Id.ToString()), ctx.AsLeader, Ct);
        Assert.Single(ctx.Realtime.OfType<MatchReturnedToLobbyEvent>());
    }

    /// <summary>
    /// A segunda partida da mesma sala e o caso que o indice unico de submissao errava antes da
    /// migration <c>MatchRuntime</c>: sem <c>MatchId</c> na chave, o primeiro envio de quem ja tinha
    /// jogado aquela fase seria recusado pelo banco.
    /// </summary>
    [Fact]
    public async Task A_second_match_can_start_in_the_same_room()
    {
        var ctx = await PlayableRoomAsync();
        var first = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        await ctx.Matches.ReturnToLobbyAsync(first.Id.ToString(), ctx.AsLeader, Ct);

        var second = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        Assert.NotEqual(first.Id, second.Id);
        Assert.Equal(second.Id, (await ctx.Matches.GetByRoomAsync(ctx.Room.Code, ctx.AsLeader, Ct)).Id);
    }

    /* ------------------------------------------------- expulsar durante a partida */

    [Fact]
    public async Task Removing_a_player_takes_their_score_with_them_and_closes_their_socket()
    {
        var ctx = await PlayableRoomAsync();
        var player = ctx.Db.Participants.Single();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var phase = await CurrentPhaseIdAsync(ctx, match);

        await ctx.Submissions.SubmitAsync(match.Id.ToString(), phase.ToString(), Quiz("o1"), ctx.AsParticipant(player.Id), Ct);

        await ctx.Matches.RemovePlayerAsync(match.Id.ToString(), player.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Empty(ctx.Db.Participants);
        Assert.Empty(ctx.Db.Submissions);

        var removed = Assert.Single(ctx.Realtime.OfType<ParticipantRemovedEvent>());
        Assert.Equal(RealtimeChannels.Participant(player.Id), removed.Channel);
    }

    /* ------------------------------------------------------------------ helpers */

    private static SubmitAnswerRequest Quiz(string optionId) => new(new AnswerDto("quiz", OptionId: optionId));

    private static async Task<Guid> CurrentPhaseIdAsync(RoomTestContext ctx, MatchDto match)
        => (await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct)).Phase.Id;

    /// <summary>Empurra o cronometro para o passado, que e o que o tempo faria numa aula de verdade.</summary>
    private static DateTimeOffset Expire(RoomTestContext ctx, Guid matchId)
    {
        var match = ctx.Db.Matches.Single(m => m.Id == matchId);
        var endsAt = DateTimeOffset.UtcNow.AddSeconds(-1);
        match.CurrentPhaseEndsAt = endsAt;
        ctx.Db.SaveChanges();
        return endsAt;
    }
}
