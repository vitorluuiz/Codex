using Codex.Api.Common.Errors;
using Codex.Api.Common.Realtime;
using Codex.Api.Contracts.Matches;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Tests;

/// <summary>
/// api-rest.md secao 8 — enviar resposta, a correcao e a pontuacao.
/// </summary>
public class SubmissionTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly StartMatchRequest Live = new("live");

    /// <summary>Sala pronta para jogar, com a partida ja em andamento na primeira fase.</summary>
    private static async Task<(RoomTestContext Ctx, MatchDto Match, Participant Player, Guid PhaseId)> PlayingAsync(
        int timeSeconds = 60,
        int basePoints = 100,
        PhaseKind kind = PhaseKind.Quiz,
        PhaseContent? content = null,
        IReadOnlyList<int>? correctIndexes = null)
    {
        var ctx = new RoomTestContext();

        var set = kind is PhaseKind.Quiz && content is null
            ? ctx.AddPlayableSet(ctx.Leader, "Frações", phaseCount: 1, timeSeconds, basePoints, correctIndexes)
            : ctx.AddPhaseSet(ctx.Leader, "Frações", kind, content!);

        await ctx.EnqueueAsync(set);
        var player = ctx.AddParticipant("Ana Silva");

        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var phaseId = (await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct)).Phase.Id;

        return (ctx, match, player, phaseId);
    }

    /* ------------------------------------------------------------------- quiz */

    [Fact]
    public async Task Right_quiz_answer_comes_back_graded_and_scored()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync();

        var submission = await Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o1"));

        Assert.Equal(GradingStatus.Graded, submission.Grading);
        Assert.True(submission.Correct);
        Assert.True(submission.Score > 0);
    }

    [Fact]
    public async Task Wrong_quiz_answer_scores_zero_and_is_not_pending()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync();

        var submission = await Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o2"));

        Assert.Equal(GradingStatus.Graded, submission.Grading);
        Assert.False(submission.Correct);
        Assert.Equal(0, submission.Score);
    }

    /// <summary>
    /// A armadilha mais cara desta fatia. O editor aceita mais de uma alternativa certa e o contrato
    /// so tem lugar para uma, entao <c>PhaseProjection</c> emite a primeira. Corrigir por aquele
    /// campo reprovaria quem marcou a segunda — e por isso a correcao le <c>correctIndexes</c>
    /// (api-queue-log.md §4).
    /// </summary>
    [Fact]
    public async Task Second_correct_option_of_a_multi_answer_quiz_is_accepted()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync(correctIndexes: [0, 2]);

        var submission = await Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o3"));

        Assert.True(submission.Correct);

        // E a tela continua mostrando so a primeira, que e o que o contrato tem lugar para carregar.
        var phase = await ctx.Queue.GetPhaseDetailAsync(ctx.Room.Code, phaseId.ToString(), ctx.AsLeader, Ct);
        Assert.Equal("o1", phase.CorrectOptionId);
    }

    [Fact]
    public async Task Option_that_does_not_exist_is_VALIDATION_ERROR()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o9")));

        Assert.Equal(ErrorCodes.ValidationError, error.Code);
    }

    /// <summary>Sem isto, mandar <c>{"kind":"text"}</c> numa fase de quiz cairia na correcao como pendente eterno.</summary>
    [Fact]
    public async Task Answer_of_the_wrong_kind_is_VALIDATION_ERROR()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Submit(ctx, match, phaseId, player, new AnswerDto("text", Value: "4/6")));

        Assert.Equal(ErrorCodes.ValidationError, error.Code);
    }

    /* ------------------------------------------------------------------- fill */

    [Fact]
    public async Task Fill_is_all_or_nothing_and_ignores_case_and_spacing()
    {
        var content = new PhaseContent(
            Question: "Ao ___ os termos, a ___ se mantem.",
            Words: ["multiplicar", "proporcao", "somar"],
            Blanks: ["multiplicar", "proporcao"]);

        var (ctx, match, player, phaseId) = await PlayingAsync(kind: PhaseKind.Fill, content: content);

        var submission = await Submit(ctx, match, phaseId, player, new AnswerDto("fill", Blanks: ["  Multiplicar ", "PROPORCAO"]));

        Assert.True(submission.Correct);
    }

    [Fact]
    public async Task One_wrong_blank_loses_the_whole_phase()
    {
        var content = new PhaseContent(
            Question: "Ao ___ os termos, a ___ se mantem.",
            Words: ["multiplicar", "proporcao", "somar"],
            Blanks: ["multiplicar", "proporcao"]);

        var (ctx, match, player, phaseId) = await PlayingAsync(kind: PhaseKind.Fill, content: content);

        var submission = await Submit(ctx, match, phaseId, player, new AnswerDto("fill", Blanks: ["multiplicar", "somar"]));

        Assert.False(submission.Correct);
        Assert.Equal(0, submission.Score);
    }

    [Fact]
    public async Task Blanks_with_the_wrong_length_is_VALIDATION_ERROR()
    {
        var content = new PhaseContent(
            Question: "Ao ___ os termos, a ___ se mantem.",
            Words: ["multiplicar", "proporcao"],
            Blanks: ["multiplicar", "proporcao"]);

        var (ctx, match, player, phaseId) = await PlayingAsync(kind: PhaseKind.Fill, content: content);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Submit(ctx, match, phaseId, player, new AnswerDto("fill", Blanks: ["multiplicar"])));

        Assert.Equal(ErrorCodes.ValidationError, error.Code);
    }

    /* -------------------------------------------------------------- text/code */

    /// <summary>
    /// Nao ha corretor de IA nem sandbox, entao o pendente e permanente por enquanto — e e exatamente
    /// o estado que o contrato descreve para os dois tipos, com a tela mostrando "sua resposta esta
    /// sendo avaliada". A resposta e gravada e a nota chega quando o corretor existir.
    /// </summary>
    [Fact]
    public async Task Text_answer_is_stored_and_left_pending()
    {
        var content = new PhaseContent(Question: "Explique fracoes equivalentes.", ExpectedAnswer: "Multiplicar em cima e embaixo.");
        var (ctx, match, player, phaseId) = await PlayingAsync(kind: PhaseKind.Text, content: content);

        var submission = await Submit(ctx, match, phaseId, player, new AnswerDto("text", Value: "Multiplica os dois."));

        Assert.Equal(GradingStatus.Pending, submission.Grading);
        Assert.Null(submission.Correct);
        Assert.Null(submission.Score);
        Assert.Contains("Multiplica os dois.", ctx.Db.Submissions.Single().AnswerJson);
    }

    [Fact]
    public async Task Code_answer_only_accepts_an_enabled_language()
    {
        var content = new PhaseContent(Question: "Some os pares.", StarterCode: "function f(){}", TestCases: "Entrada: [1,2]\nSaida: 2");
        var (ctx, match, player, phaseId) = await PlayingAsync(kind: PhaseKind.Code, content: content);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Submit(ctx, match, phaseId, player, new AnswerDto("code", LanguageId: "py", Source: "pass")));

        Assert.Equal(ErrorCodes.ValidationError, error.Code);

        var submission = await Submit(ctx, match, phaseId, player, new AnswerDto("code", LanguageId: "js", Source: "return 2;"));
        Assert.Equal(GradingStatus.Pending, submission.Grading);
    }

    /* -------------------------------------------------------------- pontuacao */

    /// <summary>
    /// <c>score = round(basePoints × pointsMultiplier × acerto × bonusDeTempo)</c>, com
    /// <c>bonusDeTempo = 0.5 + 0.5 × (restante / timeSeconds)</c>. Respondendo no primeiro instante,
    /// o bonus e 1 e o acerto vale os pontos cheios.
    /// </summary>
    [Fact]
    public async Task Answering_immediately_earns_the_full_points()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync(timeSeconds: 60, basePoints: 100);

        var submission = await Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o1"));

        // Faixa, e nao igualdade: entre iniciar a partida e enviar passam alguns milissegundos de
        // relogio real, e o teste nao deve depender de quantos.
        Assert.InRange(submission.Score!.Value, 99, 100);
    }

    /// <summary>Metade do tempo gasto, tres quartos dos pontos: 0.5 + 0.5 × 0.5.</summary>
    [Fact]
    public void Half_the_clock_spent_is_three_quarters_of_the_points()
    {
        var phase = new RoomQueuePhase { Name = "Fase", ContentJson = "{}", BasePoints = 100, PointsMultiplier = 1m, TimeSeconds = 60 };

        Assert.Equal(75, PhaseGrading.Score(phase, accuracy: 1m, secondsRemaining: 30));
    }

    /// <summary>Piso de 0,5: quem responde no ultimo segundo ainda leva metade.</summary>
    [Fact]
    public void Answering_at_the_buzzer_still_earns_half()
    {
        var phase = new RoomQueuePhase { Name = "Fase", ContentJson = "{}", BasePoints = 100, PointsMultiplier = 1m, TimeSeconds = 60 };

        Assert.Equal(50, PhaseGrading.Score(phase, accuracy: 1m, secondsRemaining: 0));
    }

    /// <summary>
    /// A conta e em <c>decimal</c> e arredonda <c>AwayFromZero</c>: em <c>double</c>, ou com o
    /// arredondamento bancario padrao do .NET, dois alunos com a mesma resposta poderiam sair com
    /// pontuacoes diferentes por 1.
    /// </summary>
    [Fact]
    public void Multiplier_is_applied_in_decimal_and_rounds_away_from_zero()
    {
        var phase = new RoomQueuePhase { Name = "Fase", ContentJson = "{}", BasePoints = 100, PointsMultiplier = 1.5m, TimeSeconds = 60 };

        // 100 × 1.5 × 1 × (0.5 + 0.5 × 6/60) = 82,5 — um empate exato, escolhido de proposito: o
        // arredondamento bancario padrao do .NET daria 82 (o par mais proximo) e AwayFromZero da 83.
        Assert.Equal(83, PhaseGrading.Score(phase, accuracy: 1m, secondsRemaining: 6));
    }

    /// <summary>
    /// O bonus sai do que faltava para o <c>endsAt</c>, e nao de <c>timeSeconds - elapsedSeconds</c>:
    /// senao uma pausa do lider no meio da fase comeria o bonus da turma inteira.
    /// </summary>
    [Fact]
    public async Task Pause_does_not_eat_the_time_bonus()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync(timeSeconds: 60, basePoints: 100);

        // A fase comecou ha 40 s, mas o lider pausou e ainda sobram 60 s de relogio.
        var running = ctx.Db.Matches.Single();
        running.CurrentPhaseStartedAt = DateTimeOffset.UtcNow.AddSeconds(-40);
        await ctx.Db.SaveChangesAsync(Ct);

        var submission = await Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o1"));

        // Cheios, apesar de 40 s de "tempo decorrido": o relogio nao andou.
        Assert.InRange(submission.Score!.Value, 99, 100);
        // …e o tempo de resposta que o painel mostra continua sendo o literal do contrato.
        Assert.InRange(submission.ElapsedSeconds, 39, 41);
    }

    /// <summary>
    /// "elapsedSeconds e calculado no servidor, nao enviado pelo cliente" — o corpo nem tem campo
    /// para isso, e este teste trava a ausencia.
    /// </summary>
    [Fact]
    public async Task Elapsed_seconds_comes_from_the_server_clock()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync();

        ctx.Db.Matches.Single().CurrentPhaseStartedAt = DateTimeOffset.UtcNow.AddSeconds(-14);
        await ctx.Db.SaveChangesAsync(Ct);

        var submission = await Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o1"));

        Assert.InRange(submission.ElapsedSeconds, 13, 15);
    }

    /* ------------------------------------------------------------------ recusas */

    [Fact]
    public async Task Second_submission_on_the_same_phase_is_PHASE_ALREADY_SUBMITTED()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync();

        await Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o1"));

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o2")));

        Assert.Equal(ErrorCodes.PhaseAlreadySubmitted, error.Code);
        Assert.Equal(StatusCodes.Status409Conflict, error.StatusCode);
    }

    /// <summary>
    /// A garantia que de fato importa do fechamento preguicoso: nao depende de job nem de evento, sai
    /// da comparacao com o <c>endsAt</c> no proprio envio.
    /// </summary>
    [Fact]
    public async Task Submitting_after_the_clock_is_PHASE_CLOSED()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync();

        ctx.Db.Matches.Single().CurrentPhaseEndsAt = DateTimeOffset.UtcNow.AddSeconds(-1);
        await ctx.Db.SaveChangesAsync(Ct);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o1")));

        Assert.Equal(ErrorCodes.PhaseClosed, error.Code);
    }

    [Fact]
    public async Task Submitting_to_a_phase_that_is_not_the_current_one_is_PHASE_CLOSED()
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPlayableSet(ctx.Leader, "Frações", phaseCount: 2));
        var player = ctx.AddParticipant("Ana Silva");
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        var second = ctx.Db.RoomQueuePhases.Single(p => p.OrderIndex == 1);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Submit(ctx, match, second.Id, player, new AnswerDto("quiz", OptionId: "o1")));

        Assert.Equal(ErrorCodes.PhaseClosed, error.Code);
    }

    /// <summary>O lider nao joga: nao responde, nao se compara e nao tem placar proprio.</summary>
    [Fact]
    public async Task Leader_cannot_submit()
    {
        var (ctx, match, _, phaseId) = await PlayingAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() => ctx.Submissions.SubmitAsync(
            match.Id.ToString(),
            phaseId.ToString(),
            new SubmitAnswerRequest(new AnswerDto("quiz", OptionId: "o1")),
            ctx.AsLeader,
            Ct));

        Assert.Equal(ErrorCodes.MatchNotFound, error.Code);
    }

    [Fact]
    public async Task Pending_participant_cannot_submit()
    {
        var (ctx, match, _, phaseId) = await PlayingAsync();
        var pending = ctx.AddParticipant("Bruno Costa", ParticipantStatus.Pending);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Submit(ctx, match, phaseId, pending, new AnswerDto("quiz", OptionId: "o1")));

        Assert.Equal(ErrorCodes.MatchNotFound, error.Code);
    }

    /* ------------------------------------------------------------------ eventos */

    [Fact]
    public async Task Submitting_publishes_progress_to_the_class_and_stats_to_the_leader()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync();
        ctx.AddParticipant("Bruno Costa");
        ctx.Realtime.Published.Clear();

        await Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o1"));

        var progress = Assert.Single(ctx.Realtime.OfType<PhaseProgressEvent>());
        Assert.Equal(RealtimeChannels.Match(ctx.Room.Code), progress.Channel);
        Assert.Equal(1, progress.As<PhaseProgressEvent>().SubmittedCount);
        Assert.Equal(2, progress.As<PhaseProgressEvent>().TotalPlayers);

        var stats = Assert.Single(ctx.Realtime.OfType<StatsUpdatedEvent>());
        Assert.Equal(RealtimeChannels.Leader(ctx.Room.Code), stats.Channel);
    }

    /// <summary>
    /// O outro gatilho de <c>phase.ended</c> alem do relogio e do <c>advance</c>: "todos enviaram
    /// (ou endsAt passou) → API publica phase.ended".
    /// </summary>
    [Fact]
    public async Task Last_player_to_answer_closes_the_phase()
    {
        var (ctx, match, first, phaseId) = await PlayingAsync();
        var second = ctx.AddParticipant("Bruno Costa");

        await Submit(ctx, match, phaseId, first, new AnswerDto("quiz", OptionId: "o1"));
        Assert.Empty(ctx.Realtime.OfType<PhaseEndedEvent>());

        await Submit(ctx, match, phaseId, second, new AnswerDto("quiz", OptionId: "o2"));

        Assert.Single(ctx.Realtime.OfType<PhaseEndedEvent>());
        Assert.NotNull(ctx.Db.Matches.Single().CurrentPhaseEndedAt);
    }

    /* -------------------------------------------------------------------- ready */

    [Fact]
    public async Task Marking_ready_is_counted_once_and_shows_up_in_the_panel()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync();
        await Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o1"));

        await ctx.Submissions.MarkReadyAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsParticipant(player.Id), Ct);
        var first = ctx.Db.Submissions.Single().ReadyAt;

        await ctx.Submissions.MarkReadyAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsParticipant(player.Id), Ct);

        Assert.Equal(first, ctx.Db.Submissions.Single().ReadyAt);

        var stats = await ctx.Matches.GetStatsAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsLeader, Ct);
        Assert.Equal(1, stats.ReadyCount);
    }

    [Fact]
    public async Task Marking_ready_without_answering_is_VALIDATION_ERROR()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Submissions.MarkReadyAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsParticipant(player.Id), Ct));

        Assert.Equal(ErrorCodes.ValidationError, error.Code);
    }

    /// <summary>
    /// Reiniciar a fase apaga as submissoes, e os readies moram nelas.
    ///
    /// Fila de <b>duas</b> fases de proposito: com uma so, o envio do unico jogador fecharia a
    /// ultima fase e encerraria a partida, e reiniciar uma partida encerrada e outro caso.
    /// </summary>
    [Fact]
    public async Task Restarting_the_phase_clears_the_ready_marks()
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPlayableSet(ctx.Leader, "Frações", phaseCount: 2));
        var player = ctx.AddParticipant("Ana Silva");
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var phaseId = (await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct)).Phase.Id;

        await Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o1"));
        await ctx.Submissions.MarkReadyAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsParticipant(player.Id), Ct);

        await ctx.Matches.RestartPhaseAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsLeader, Ct);

        var stats = await ctx.Matches.GetStatsAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsLeader, Ct);
        Assert.Equal(0, stats.ReadyCount);
        Assert.Equal(0, stats.SubmittedCount);
    }

    /* ---------------------------------------------------- recarregar a pagina */

    /// <summary>
    /// "mySubmission preenchido significa que a pessoa recarregou a pagina depois de enviar — o front
    /// cai direto na tela de espera em vez de mostrar o desafio de novo."
    /// </summary>
    [Fact]
    public async Task Reloading_after_answering_brings_my_submission_back()
    {
        var (ctx, match, player, phaseId) = await PlayingAsync();
        await Submit(ctx, match, phaseId, player, new AnswerDto("quiz", OptionId: "o1"));

        var mine = await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsParticipant(player.Id), Ct);
        var leader = await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.NotNull(mine.MySubmission);
        Assert.Equal("o1", mine.MySubmission!.Answer.OptionId);
        Assert.Equal(1, mine.SubmittedCount);

        // O lider nao tem submissao propria — ele nao joga.
        Assert.Null(leader.MySubmission);
    }

    /* -------------------------------------------------- tetos de texto da resposta */

    /// <summary>
    /// <c>answer.source</c> era o unico campo que um aluno enviava sem teto nenhum, e e o que mais
    /// cresce — e codigo colado. E ele que decide o tamanho do bucket do participante no documento
    /// da partida e o consumo do Redis durante a partida
    /// (<c>docs/contracts/postgresql/migracao-dados.md</c> secao 5.3).
    /// </summary>
    [Fact]
    public async Task Code_source_longer_than_the_ceiling_is_rejected()
    {
        var content = new PhaseContent(Question: "Some os pares.", StarterCode: "function f(){}", TestCases: "Entrada: [1,2]\nSaida: 2");
        var (ctx, match, player, phaseId) = await PlayingAsync(kind: PhaseKind.Code, content: content);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Submit(ctx, match, phaseId, player, new AnswerDto("code", LanguageId: "js", Source: Filler(PhaseLimits.MaxAnswerSourceLength + 1))));

        Assert.Equal(ErrorCodes.ValidationError, error.Code);
        Assert.Equal(StatusCodes.Status400BadRequest, error.StatusCode);
        Assert.Empty(ctx.Db.Submissions);
    }

    /// <summary>O teto e <c>&gt;</c>, nao <c>&gt;=</c>: o valor exato passa e e gravado.</summary>
    [Fact]
    public async Task Code_source_exactly_at_the_ceiling_is_accepted()
    {
        var content = new PhaseContent(Question: "Some os pares.", StarterCode: "function f(){}", TestCases: "Entrada: [1,2]\nSaida: 2");
        var (ctx, match, player, phaseId) = await PlayingAsync(kind: PhaseKind.Code, content: content);

        var submission = await Submit(
            ctx, match, phaseId, player,
            new AnswerDto("code", LanguageId: "js", Source: Filler(PhaseLimits.MaxAnswerSourceLength)));

        Assert.Equal(GradingStatus.Pending, submission.Grading);
        Assert.Equal(PhaseLimits.MaxAnswerSourceLength, submission.Answer.Source!.Length);
    }

    [Fact]
    public async Task Text_answer_longer_than_the_ceiling_is_rejected()
    {
        var content = new PhaseContent(Question: "Explique fracoes equivalentes.", ExpectedAnswer: "Multiplicar em cima e embaixo.");
        var (ctx, match, player, phaseId) = await PlayingAsync(kind: PhaseKind.Text, content: content);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Submit(ctx, match, phaseId, player, new AnswerDto("text", Value: Filler(PhaseLimits.MaxAnswerTextLength + 1))));

        Assert.Equal(ErrorCodes.ValidationError, error.Code);
        Assert.Empty(ctx.Db.Submissions);
    }

    [Fact]
    public async Task Fill_blank_longer_than_the_ceiling_is_rejected()
    {
        var content = new PhaseContent(
            Question: "Ao ___ os termos, a ___ se mantem.",
            Words: ["multiplicar", "proporcao"],
            Blanks: ["multiplicar", "proporcao"]);
        var (ctx, match, player, phaseId) = await PlayingAsync(kind: PhaseKind.Fill, content: content);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            Submit(ctx, match, phaseId, player, new AnswerDto("fill", Blanks: ["multiplicar", Filler(PhaseLimits.MaxOptionLength + 1)])));

        Assert.Equal(ErrorCodes.ValidationError, error.Code);
        Assert.Empty(ctx.Db.Submissions);
    }

    /* ------------------------------------------------------------------ helpers */

    /// <summary>Texto de <paramref name="length"/> caracteres, para exercitar um teto.</summary>
    private static string Filler(int length) => new('x', length);

    private static Task<SubmissionDto> Submit(
        RoomTestContext ctx,
        MatchDto match,
        Guid phaseId,
        Participant player,
        AnswerDto answer)
        => ctx.Submissions.SubmitAsync(
            match.Id.ToString(),
            phaseId.ToString(),
            new SubmitAnswerRequest(answer),
            ctx.AsParticipant(player.Id),
            Ct);
}
