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
/// <c>Decimal128</c>, o enum em camelCase, e o upsert idempotente por chave composta.
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

        var (match, participants) = Sample();
        await store.CommitAsync(match, participants, Ct);

        var found = await store.FindAsync(match.Id, Ct);

        Assert.NotNull(found);
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
    }

    /// <summary>
    /// O round-trip dos participantes, e junto com ele a <b>ordem do podio pelo driver</b>:
    /// pontuacao, depois menor tempo somado. O store em memoria ordena igual, mas so o Mongo
    /// exercita o <c>SortByDescending().ThenBy()</c> de verdade — e e o que a tela de podio le.
    /// </summary>
    [SkippableFact]
    public async Task Participants_and_their_submissions_survive_the_round_trip()
    {
        Skip.If(ConnectionString is null, "CODEX_TEST_MONGO nao configurado.");
        var store = Store(out _);

        var (match, participants) = Sample();
        // Um segundo participante com menos pontos: o primeiro tem que vir na frente.
        var runnerUp = participants[0] with
        {
            Id = Guid.CreateVersion7(),
            ParticipantId = Guid.CreateVersion7(),
            DisplayName = "Joao",
            TotalScore = 40,
        };
        await store.CommitAsync(match, [.. participants, runnerUp], Ct);

        var found = await store.ParticipantsAsync(match.Id, Ct);

        Assert.Equal(["Maria", "Joao"], found.Select(p => p.DisplayName));
        Assert.Equal(137, found[0].TotalScore);

        var submission = Assert.Single(found[0].Submissions);
        Assert.Equal(GradingStatus.Graded, submission.Grading);
        Assert.Equal("quiz", submission.Answer.Kind);
        Assert.Equal("o1", submission.Answer.OptionId);
        // O ponteiro resolve contra phases[] do documento da partida, e nao carrega copia.
        Assert.Equal(match.Phases[0].PhaseId, submission.PhaseId);
    }

    /// <summary>
    /// O requisito da secao 7: refazer o commit depois de uma falha nao pode duplicar nada. Quem
    /// garante isso no banco e o indice unico <c>(matchId, participantId)</c> mais o upsert.
    /// </summary>
    [SkippableFact]
    public async Task Committing_twice_is_idempotent()
    {
        Skip.If(ConnectionString is null, "CODEX_TEST_MONGO nao configurado.");
        var store = Store(out _);

        var (match, participants) = Sample();
        await store.CommitAsync(match, participants, Ct);
        await store.CommitAsync(match, participants, Ct);

        Assert.Single(await store.ParticipantsAsync(match.Id, Ct));
        Assert.Single(await store.ListByLeaderAsync(match.LeaderUserId, 50, Ct));
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
            var (match, participants) = Sample(leader, finishedAt: new DateTime(2026, 9, day, 12, 0, 0, DateTimeKind.Utc));
            await store.CommitAsync(match, participants, Ct);
        }

        var (other, otherParticipants) = Sample(stranger);
        await store.CommitAsync(other, otherParticipants, Ct);

        var history = await store.ListByLeaderAsync(leader, 2, Ct);

        Assert.Equal(2, history.Count);
        Assert.True(history[0].FinishedAt > history[1].FinishedAt);
        Assert.All(history, m => Assert.Equal(leader, m.LeaderUserId));
    }

    /* ------------------------------------------------------------------ amostra */

    private static (MatchDocument Match, IReadOnlyList<MatchParticipantDocument> Participants) Sample(
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
            Id = participantId,
            MatchId = matchId,
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

        return (match, [participant]);
    }
}
