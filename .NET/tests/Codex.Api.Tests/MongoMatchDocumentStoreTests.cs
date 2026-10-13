using Codex.Api.Contracts.Matches;
using Codex.Api.Documents;
using Codex.Api.Domain;
using Codex.Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace Codex.Api.Tests;

/// <summary>
/// O caminho real do driver: serializacao, indices, upsert e as tres consultas.
///
/// <b>Roda so quando ha um Mongo apontado por <c>CODEX_TEST_MONGO</c></b>, e por isso o resto da
/// suite continua sem dependencia externa (EF InMemory, sem Postgres nem Redis). O que
/// <c>MatchDocumentTests</c> cobre com o store em memoria e a <i>montagem</i> do snapshot; o que
/// so aparece aqui e o que o driver faz com ele — o <c>Guid</c> como UUID padrao, o
/// <c>Decimal128</c>, o enum em camelCase, a projecao de <c>participants[]</c> e o upsert idempotente por <c>_id</c>.
///
/// <code>
/// docker run -d --rm -p 27019:27017 mongo:8.0
/// $env:CODEX_TEST_MONGO = "mongodb://localhost:27019"
/// dotnet test
/// </code>
/// </summary>
public class MongoMatchDocumentStoreTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static string? ConnectionString => Environment.GetEnvironmentVariable("CODEX_TEST_MONGO");

    private static MongoMatchDocumentStore Store(out string database)
    {
        // Um database por teste: os testes rodam em paralelo e um DROP no fim seria uma corrida.
        database = $"codex_test_{Guid.CreateVersion7():N}";

        return new MongoMatchDocumentStore(
            new DocumentOptions { ConnectionString = ConnectionString, DatabaseName = database },
            NullLogger<MongoMatchDocumentStore>.Instance);
    }

    [SkippableFact]
    public async Task A_committed_match_comes_back_with_every_field_intact()
    {
        Skip.If(ConnectionString is null, "CODEX_TEST_MONGO nao configurado.");
        var store = Store(out _);

        var match = Sample();
        await store.CommitAsync(match, Ct);

        var found = await store.FindAsync(match.Id, Ct);

        Assert.NotNull(found);
        Assert.Equal(MatchDocument.CurrentSchemaVersion, found.SchemaVersion);
        Assert.Equal(match.RoomCode, found.RoomCode);
        Assert.Equal(match.LeaderUserId, found.LeaderUserId);
        Assert.Equal(MatchMode.Live, found.Mode);
        Assert.Equal(match.FinishedAt, found.FinishedAt);

        var phase = Assert.Single(found.Phases);
        Assert.Equal(PhaseKind.Quiz, phase.Kind);
        // Decimal128, e nao string: o multiplicador entra no calculo da nota.
        Assert.Equal(1.5m, phase.PointsMultiplier);
        // O conteudo e copia, nao traducao — o gabarito volta inteiro.
        Assert.Equal("Quanto e 1 + 2?", phase.Content.Question);
        Assert.Equal([0], phase.Content.CorrectIndexes);

        // Os participantes voltam embutidos no proprio documento da partida.
        Assert.Equal("Maria", Assert.Single(found.Participants).DisplayName);
    }

    /// <summary>
    /// O round-trip dos participantes embutidos, e junto com ele a <b>ordem do array</b>: o
    /// <c>MatchDocumentWriter</c> grava <c>participants[]</c> na ordem do podio, e o banco tem que
    /// devolve-la intacta — e o que a tela de podio le.
    /// </summary>
    [SkippableFact]
    public async Task Participants_and_their_submissions_survive_the_round_trip()
    {
        Skip.If(ConnectionString is null, "CODEX_TEST_MONGO nao configurado.");
        var store = Store(out _);

        var match = Sample();
        // Um segundo participante com menos pontos, gravado depois do primeiro.
        var runnerUp = match.Participants[0] with
        {
            ParticipantId = Guid.CreateVersion7(),
            DisplayName = "Joao",
            TotalScore = 40,
        };
        match = match with { Participants = [.. match.Participants, runnerUp] };
        await store.CommitAsync(match, Ct);

        var found = await store.ParticipantsAsync(match.Id, Ct);

        Assert.Equal(["Maria", "Joao"], found.Select(p => p.DisplayName));
        Assert.Equal(137, found[0].TotalScore);

        var submission = Assert.Single(found[0].Submissions);
        Assert.Equal(GradingStatus.Graded, submission.Grading);
        Assert.Equal("quiz", submission.Answer.Kind);
        Assert.Equal("o1", submission.Answer.OptionId);
        // O ponteiro resolve contra phases[] do mesmo documento, e nao carrega copia.
        Assert.Equal(match.Phases[0].PhaseId, submission.PhaseId);
    }

    [SkippableFact]
    public async Task Participants_of_an_unknown_match_come_back_empty()
    {
        Skip.If(ConnectionString is null, "CODEX_TEST_MONGO nao configurado.");
        var store = Store(out _);

        Assert.Empty(await store.ParticipantsAsync(Guid.CreateVersion7(), Ct));
    }

    /// <summary>
    /// O requisito da secao 7: refazer o commit depois de uma falha nao pode duplicar nada. Com um
    /// documento so, quem garante isso e o upsert por <c>_id</c>.
    /// </summary>
    [SkippableFact]
    public async Task Committing_twice_is_idempotent()
    {
        Skip.If(ConnectionString is null, "CODEX_TEST_MONGO nao configurado.");
        var store = Store(out _);

        var match = Sample();
        await store.CommitAsync(match, Ct);
        await store.CommitAsync(match, Ct);

        Assert.Single(await store.ParticipantsAsync(match.Id, Ct));
        Assert.Single(await store.ListByLeaderAsync(match.LeaderUserId, 50, Ct));
    }

    /// <summary>
    /// A unicidade que o indice <c>(matchId, participantId)</c> garantia. Indice unico nao alcanca
    /// elementos de um mesmo array, entao o store recusa o documento antes de grava-lo.
    /// </summary>
    [SkippableFact]
    public async Task A_participant_repeated_inside_the_match_is_rejected()
    {
        Skip.If(ConnectionString is null, "CODEX_TEST_MONGO nao configurado.");
        var store = Store(out _);

        var match = Sample();
        match = match with { Participants = [match.Participants[0], match.Participants[0]] };

        await Assert.ThrowsAsync<InvalidOperationException>(() => store.CommitAsync(match, Ct));
        Assert.Null(await store.FindAsync(match.Id, Ct));
    }

    [SkippableFact]
    public async Task Leader_history_comes_back_newest_first_and_respects_the_limit()
    {
        Skip.If(ConnectionString is null, "CODEX_TEST_MONGO nao configurado.");
        var store = Store(out _);

        var leader = Guid.CreateVersion7();
        var stranger = Guid.CreateVersion7();

        for (var day = 1; day <= 3; day++)
        {
            await store.CommitAsync(Sample(leader, finishedAt: new DateTime(2026, 9, day, 12, 0, 0, DateTimeKind.Utc)), Ct);
        }

        await store.CommitAsync(Sample(stranger), Ct);

        var history = await store.ListByLeaderAsync(leader, 2, Ct);

        Assert.Equal(2, history.Count);
        Assert.True(history[0].FinishedAt > history[1].FinishedAt);
        Assert.All(history, m => Assert.Equal(leader, m.LeaderUserId));
        // O historico projeta participants[] para fora: so cabecalho, fases e agregados.
        Assert.All(history, m => Assert.Empty(m.Participants));
        Assert.All(history, m => Assert.Equal(1, m.Stats.ParticipantCount));
    }

    /* ------------------------------------------------------------------ amostra */

    private static MatchDocument Sample(
        Guid? leaderUserId = null,
        DateTime? finishedAt = null)
    {
        var matchId = Guid.CreateVersion7();
        var phaseId = Guid.CreateVersion7();
        var participantId = Guid.CreateVersion7();
        var startedAt = new DateTime(2026, 9, 4, 14, 13, 52, DateTimeKind.Utc);

        var match = new MatchDocument
        {
            Id = matchId,
            RoomCode = "969180",
            RoomId = Guid.CreateVersion7(),
            LeaderUserId = leaderUserId ?? Guid.CreateVersion7(),
            Mode = MatchMode.Live,
            StartedAt = startedAt,
            FinishedAt = finishedAt ?? startedAt.AddMinutes(16),
            PhaseSets =
            [
                new MatchPhaseSetDocument
                {
                    QueueSetId = Guid.CreateVersion7(),
                    SourcePhaseSetId = Guid.CreateVersion7(),
                    Title = "Conjunto de exemplo",
                    Color = "var(--blue-500)",
                    OrderIndex = 0,
                },
            ],
            Phases =
            [
                new MatchPhaseDocument
                {
                    PhaseId = phaseId,
                    QueueSetId = Guid.CreateVersion7(),
                    SourcePhaseId = Guid.CreateVersion7(),
                    OrderIndex = 0,
                    Kind = PhaseKind.Quiz,
                    Name = "Pergunta facil de soma",
                    BasePoints = 50,
                    PointsMultiplier = 1.5m,
                    TimeSeconds = 15,
                    MaxScore = 75,
                    Content = new PhaseContent(
                        Question: "Quanto e 1 + 2?",
                        Options: ["3", "2", "1", "4"],
                        CorrectIndexes: [0]),
                },
            ],
            Stats = new MatchStatsDocument
            {
                ParticipantCount = 1,
                AvgScore = 137,
                MaxScore = 75,
                AccuracyRate = 100,
                PhaseAccuracy = [100],
                PhaseAvgScore = [137],
            },
        };

        var participant = new MatchParticipantDocument
        {
            ParticipantId = participantId,
            UserId = Guid.CreateVersion7(),
            DisplayName = "Maria",
            AvatarIndex = 1,
            JoinedAt = startedAt,
            TotalScore = 137,
            GradedCount = 1,
            CorrectCount = 1,
            PendingCount = 0,
            TotalElapsedSeconds = 5,
            Submissions =
            [
                new MatchSubmissionDocument
                {
                    PhaseId = phaseId,
                    PhaseOrderIndex = 0,
                    MaxScore = 75,
                    Answer = new AnswerDto("quiz", OptionId: "o1"),
                    SubmittedAt = startedAt.AddSeconds(5),
                    ElapsedSeconds = 5,
                    Grading = GradingStatus.Graded,
                    Correct = true,
                    Score = 137,
                },
            ],
        };

        return match with { Participants = [participant] };
    }
}
