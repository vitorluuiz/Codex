using Codex.Api.Common.Errors;
using Codex.Api.Common.Formatting;
using Codex.Api.Contracts.Matches;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Tests;

/// <summary>
/// api-rest.md secoes 9 e 10 — o painel do lider, a comparacao com a turma, o placar e o podio.
/// </summary>
public class MatchStatsTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly StartMatchRequest Live = new("live");

    /// <summary>Sala com <paramref name="playerCount"/> alunos aprovados e a partida em andamento.</summary>
    private static async Task<(RoomTestContext Ctx, MatchDto Match, Guid PhaseId, List<Participant> Players)> PlayingAsync(
        int playerCount = 3,
        int phaseCount = 1,
        int timeSeconds = 60)
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPlayableSet(ctx.Leader, "Frações", phaseCount, timeSeconds));

        var players = Enumerable.Range(1, playerCount)
            .Select(index => ctx.AddParticipant($"Aluno {index}"))
            .ToList();

        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var phaseId = (await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct)).Phase.Id;

        return (ctx, match, phaseId, players);
    }

    private static Task Submit(RoomTestContext ctx, MatchDto match, Guid phaseId, Participant player, string optionId)
        => ctx.Submissions.SubmitAsync(
            match.Id.ToString(),
            phaseId.ToString(),
            new SubmitAnswerRequest(new AnswerDto("quiz", OptionId: optionId)),
            ctx.AsParticipant(player.Id),
            Ct);

    /* -------------------------------------------------------------------- stats */

    [Fact]
    public async Task Panel_counts_the_class_and_the_answers()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 3);

        await Submit(ctx, match, phaseId, players[0], "o1");
        await Submit(ctx, match, phaseId, players[1], "o2");

        var stats = await ctx.Matches.GetStatsAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(2, stats.SubmittedCount);
        Assert.Equal(3, stats.TotalPlayers);
        Assert.Equal(2, stats.GradedCount);
        Assert.Equal(1, stats.CorrectCount);
        Assert.Equal(50, stats.AccuracyRate);
    }

    /// <summary>
    /// A taxa de acerto e sobre os <b>corrigidos</b>, e nao sobre a turma: com text e code pendentes,
    /// dividir pelo total faria a taxa cair sozinha a cada resposta que ainda nem foi avaliada.
    /// </summary>
    [Fact]
    public async Task Accuracy_is_measured_over_the_graded_answers_only()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 4);

        await Submit(ctx, match, phaseId, players[0], "o1");

        var stats = await ctx.Matches.GetStatsAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(100, stats.AccuracyRate);
        Assert.Equal(1, stats.SubmittedCount);
        Assert.Equal(4, stats.TotalPlayers);
    }

    /// <summary>
    /// A mesma armadilha do <c>correctIndexes</c>, do lado do painel: marcar so a primeira mostraria
    /// ao lider uma barra vermelha para uma resposta que o proprio sistema aceitou.
    /// </summary>
    [Fact]
    public async Task Answer_distribution_marks_every_correct_option()
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPlayableSet(ctx.Leader, "Frações", phaseCount: 1, correctIndexes: [0, 2]));
        var player = ctx.AddParticipant("Ana Silva");
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var phaseId = (await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct)).Phase.Id;

        await Submit(ctx, match, phaseId, player, "o3");

        var stats = await ctx.Matches.GetStatsAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsLeader, Ct);

        Assert.Equal([true, false, true], stats.AnswerDistribution.Select(entry => entry.Correct));
        Assert.Equal(1, stats.AnswerDistribution[2].Count);
    }

    /// <summary>"Mande os dois — o custo e irrelevante e evita um if/else de rota" (secao 10).</summary>
    [Fact]
    public async Task Non_quiz_phase_sends_an_empty_answer_distribution_and_a_full_grading_one()
    {
        var ctx = new RoomTestContext();
        var content = new PhaseContent(Question: "Explique.", ExpectedAnswer: "Porque sim.");
        await ctx.EnqueueAsync(ctx.AddPhaseSet(ctx.Leader, "Texto", PhaseKind.Text, content));
        var player = ctx.AddParticipant("Ana Silva");
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var phaseId = (await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct)).Phase.Id;

        await ctx.Submissions.SubmitAsync(
            match.Id.ToString(),
            phaseId.ToString(),
            new SubmitAnswerRequest(new AnswerDto("text", Value: "porque sim")),
            ctx.AsParticipant(player.Id),
            Ct);

        var stats = await ctx.Matches.GetStatsAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsLeader, Ct);

        Assert.Empty(stats.AnswerDistribution);
        Assert.Equal(1, stats.GradingDistribution.Single(e => e.Status == GradingDistributionEntryDto.Awaiting).Count);
        Assert.Equal(0, stats.GradedCount);
    }

    /// <summary>A soma dos baldes tem de bater com <c>submittedCount</c>, senao o painel se contradiz.</summary>
    [Fact]
    public async Task Response_time_buckets_cover_every_submission()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 2, timeSeconds: 60);

        await Submit(ctx, match, phaseId, players[0], "o1");
        await Submit(ctx, match, phaseId, players[1], "o2");

        var stats = await ctx.Matches.GetStatsAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(LabelFormatter.ResponseTimeBucketCount, stats.ResponseTimeBuckets.Count);
        Assert.Equal(stats.SubmittedCount, stats.ResponseTimeBuckets.Sum(bucket => bucket.Count));
        Assert.Equal("0-15s", stats.ResponseTimeBuckets[0].Label);
    }

    [Fact]
    public async Task Player_rows_separate_who_answered_from_who_did_not()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 2);

        await Submit(ctx, match, phaseId, players[0], "o1");

        var stats = await ctx.Matches.GetStatsAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsLeader, Ct);

        var answered = stats.Players.Single(row => row.ParticipantId == players[0].Id);
        var missing = stats.Players.Single(row => row.ParticipantId == players[1].Id);

        Assert.Equal(LeaderPlayerRowDto.Submitted, answered.Status);
        Assert.True(answered.Correct);
        Assert.NotNull(answered.ElapsedSeconds);

        Assert.Equal(LeaderPlayerRowDto.Pending, missing.Status);
        Assert.Null(missing.Correct);
        Assert.Null(missing.ElapsedSeconds);
    }

    /// <summary>"players e o modo avancado do painel" — e a unica saida com nome e tempo por aluno.</summary>
    [Fact]
    public async Task Stats_are_leader_only()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 1);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Matches.GetStatsAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsParticipant(players[0].Id), Ct));

        Assert.Equal(ErrorCodes.NotRoomLeader, error.Code);
    }

    /* --------------------------------------------------------------- comparison */

    [Fact]
    public async Task Comparison_is_PHASE_STILL_OPEN_while_the_class_is_answering()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 2);
        await Submit(ctx, match, phaseId, players[0], "o1");

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Submissions.GetComparisonAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsParticipant(players[0].Id), Ct));

        Assert.Equal(ErrorCodes.PhaseStillOpen, error.Code);
    }

    /// <summary>Pedir a comparacao de uma fase futura nao pode ser um jeito de ler o gabarito adiantado.</summary>
    [Fact]
    public async Task Comparison_of_a_future_phase_is_PHASE_STILL_OPEN()
    {
        var (ctx, match, _, players) = await PlayingAsync(playerCount: 1, phaseCount: 2);
        var second = ctx.Db.RoomQueuePhases.Single(p => p.OrderIndex == 1);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Submissions.GetComparisonAsync(match.Id.ToString(), second.Id.ToString(), ctx.AsParticipant(players[0].Id), Ct));

        Assert.Equal(ErrorCodes.PhaseStillOpen, error.Code);
    }

    /// <summary>Fechada a fase, e aqui que o gabarito finalmente sai para o aluno.</summary>
    [Fact]
    public async Task Closed_phase_releases_the_answer_and_ranks_the_player()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 3);

        await Submit(ctx, match, phaseId, players[0], "o1"); // acerta
        await Submit(ctx, match, phaseId, players[1], "o2"); // erra
        await Submit(ctx, match, phaseId, players[2], "o2"); // erra — e fecha a fase

        var comparison = await ctx.Submissions.GetComparisonAsync(
            match.Id.ToString(), phaseId.ToString(), ctx.AsParticipant(players[0].Id), Ct);

        Assert.Equal("4/6", comparison.CorrectAnswerLabel);
        Assert.True(comparison.Correct);
        Assert.Equal(100, comparison.Percentile);
        Assert.Equal(3, comparison.Histogram.Count);
        Assert.Single(comparison.Histogram, entry => entry.IsMe);
        // Ja vem ordenado por pontuacao: o front so desenha as barras.
        Assert.Equal(comparison.Histogram.Select(e => e.Score).Order(), comparison.Histogram.Select(e => e.Score));
    }

    /// <summary>Um quiz de multipla resposta mostra todas as certas, e nao so a que cabe no campo singular do contrato.</summary>
    [Fact]
    public async Task Correct_answer_label_lists_every_accepted_option()
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPlayableSet(ctx.Leader, "Frações", phaseCount: 1, correctIndexes: [0, 2]));
        var player = ctx.AddParticipant("Ana Silva");
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var phaseId = (await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct)).Phase.Id;

        await Submit(ctx, match, phaseId, player, "o1");

        var comparison = await ctx.Submissions.GetComparisonAsync(
            match.Id.ToString(), phaseId.ToString(), ctx.AsParticipant(player.Id), Ct);

        Assert.Equal("4/6 / 5/6", comparison.CorrectAnswerLabel);
    }

    /* ------------------------------------------------------ scoreboard e podio */

    /// <summary>
    /// A media inclui quem nao respondeu. Numa fase em que 1 de 3 respondeu, as duas contas diferem
    /// por 3 — e o aluno leria que esta muito abaixo da turma estando na frente dela.
    /// </summary>
    [Fact]
    public async Task Class_average_counts_everyone_not_only_who_answered()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 3, timeSeconds: 60);

        await Submit(ctx, match, phaseId, players[0], "o1");

        var scoreboard = await ctx.Submissions.GetScoreboardAsync(match.Id.ToString(), ctx.AsParticipant(players[0].Id), Ct);

        Assert.InRange(scoreboard.MyScore, 99, 100);
        Assert.InRange(scoreboard.AvgScore, 33, 34);
    }

    /// <summary>
    /// O <c>ChallengeShell</c> sobrescreve <c>scoreboard.avgScore</c> com <c>stats.teamAvgScore</c> ao
    /// receber <c>stats.updated</c>. Os dois numeros tem de ser o mesmo por construcao — hoje a
    /// substituicao nem e observavel, o que so torna a divergencia mais facil de introduzir sem
    /// ninguem ver.
    /// </summary>
    [Fact]
    public async Task Team_average_of_the_panel_equals_the_average_of_the_player_scoreboard()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 3);

        await Submit(ctx, match, phaseId, players[0], "o1");
        await Submit(ctx, match, phaseId, players[1], "o2");

        var stats = await ctx.Matches.GetStatsAsync(match.Id.ToString(), phaseId.ToString(), ctx.AsLeader, Ct);
        var scoreboard = await ctx.Submissions.GetScoreboardAsync(match.Id.ToString(), ctx.AsParticipant(players[0].Id), Ct);

        Assert.Equal(stats.TeamAvgScore, scoreboard.AvgScore);
    }

    [Fact]
    public async Task Podium_is_ordered_and_stops_at_three()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 4);

        await Submit(ctx, match, phaseId, players[0], "o1");
        await Submit(ctx, match, phaseId, players[1], "o1");
        await Submit(ctx, match, phaseId, players[2], "o2");
        await Submit(ctx, match, phaseId, players[3], "o2");

        var podium = await ctx.Matches.GetPodiumAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(3, podium.Count);
        Assert.Equal(podium.Select(e => e.Score).OrderDescending(), podium.Select(e => e.Score));
        Assert.All(podium, entry => Assert.Null(entry.AvatarUrl));
    }

    /// <summary>
    /// Sem criterio de desempate, duas pessoas com a mesma pontuacao trocariam de degrau a cada
    /// leitura, porque a ordem viria do banco.
    /// </summary>
    [Fact]
    public async Task Podium_is_stable_across_reads()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 3);

        await Submit(ctx, match, phaseId, players[0], "o1");
        await Submit(ctx, match, phaseId, players[1], "o1");
        await Submit(ctx, match, phaseId, players[2], "o1");

        var first = await ctx.Matches.GetPodiumAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        var second = await ctx.Matches.GetPodiumAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(first.Select(e => e.ParticipantId), second.Select(e => e.ParticipantId));
    }

    /// <summary>
    /// O envio que fecha a ultima fase encerra a partida sozinho, e o podio publicado e o mesmo que
    /// a rota devolve. O <c>finish</c> do lider depois disso e redundante: devolve o mesmo podio e
    /// <b>nao</b> republica o evento — senao a turma receberia dois <c>match.finished</c>.
    /// </summary>
    [Fact]
    public async Task Finishing_publishes_the_podium_once_even_if_the_leader_clicks_afterwards()
    {
        var (ctx, match, phaseId, players) = await PlayingAsync(playerCount: 1);

        await Submit(ctx, match, phaseId, players[0], "o1");

        var published = Assert.Single(ctx.Realtime.OfType<Contracts.Realtime.MatchFinishedEvent>());

        var returned = await ctx.Matches.FinishAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Single(ctx.Realtime.OfType<Contracts.Realtime.MatchFinishedEvent>());
        Assert.Equal(
            returned.Select(e => e.ParticipantId),
            published.As<Contracts.Realtime.MatchFinishedEvent>().Podium.Select(e => e.ParticipantId));
    }

    /* ------------------------------------------------------- rotulos de balde */

    [Theory]
    [InlineData(60, "0-15s", "45-60s")]
    [InlineData(45, "0-11s", "34-45s")]
    public void Bucket_labels_are_equal_slices_of_the_phase_time(int timeSeconds, string first, string last)
    {
        var labels = LabelFormatter.ResponseTimeBucketLabels(timeSeconds);

        Assert.Equal(first, labels[0]);
        Assert.Equal(last, labels[^1]);
    }

    /// <summary>
    /// Uma fase no minimo de <c>PhaseLimits</c> (5 s) nao pode produzir rotulos como "1-1s" e um
    /// balde impossivel de cair.
    /// </summary>
    [Fact]
    public void Very_short_phase_still_gets_four_distinct_buckets()
    {
        var labels = LabelFormatter.ResponseTimeBucketLabels(PhaseLimits.MinTimeSeconds);

        Assert.Equal(LabelFormatter.ResponseTimeBucketCount, labels.Count);
        Assert.Equal(labels.Count, labels.Distinct().Count());
    }

    /// <summary>Quem respondeu depois do fim (o tempo pausado conta) cai no ultimo balde, e nao some da contagem.</summary>
    [Fact]
    public void Answer_slower_than_the_phase_falls_in_the_last_bucket()
    {
        Assert.Equal(
            LabelFormatter.ResponseTimeBucketCount - 1,
            LabelFormatter.ResponseTimeBucketIndex(elapsedSeconds: 900, timeSeconds: 60));
    }
}
