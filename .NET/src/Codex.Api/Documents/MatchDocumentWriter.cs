using Codex.Api.Data;
using Codex.Api.Domain.Entities;
using Codex.Api.Domain;
using Codex.Api.Services;
using Codex.Api.Services.Redis;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Documents;

public class MatchDocumentWriter(
    IRoomRepository repo,
    IMatchDocumentStore store,
    ILogger<MatchDocumentWriter> logger,
    Codex.Api.Services.Redis.IMatchRepository matchRepo)
{
    public async Task CommitAsync(Match match, CancellationToken ct)
    {
        try
        {
            var document = await BuildAsync(match, ct);
            await store.CommitAsync(document, ct);
            logger.LogInformation("Snapshot salvo para a partida {MatchId}.", match.Id);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Falha ao gravar snapshot em disco para a partida {MatchId}.", match.Id);
        }
    }

    /// <summary>
    /// Monta o snapshot inteiro da partida: cabecalho, fases, agregados e
    /// <see cref="MatchDocument.Participants"/> — cada participante aprovado com as proprias
    /// submissoes, ja na ordem do podio. Idempotente: montar duas vezes da o mesmo documento.
    /// </summary>
    public async Task<MatchDocument> BuildAsync(Match match, CancellationToken ct)
    {
        var room = await repo.GetRoomAsync(match.RoomId.ToString(), ct)
            ?? throw new InvalidOperationException($"Sala {match.RoomId} não encontrada no Redis ao salvar documento.");

        var queueSetsData = await repo.GetQueueSetsAsync(match.RoomId.ToString(), ct);
        var queuePhasesData = await repo.GetQueuePhasesAsync(match.RoomId.ToString(), ct);

        var queueSets = queueSetsData.Select(s => RoomRedisMappers.ToEntity(s, room.Id)).OrderBy(s => s.OrderIndex).ToList();
        var queuePhases = queuePhasesData.Select(p => RoomRedisMappers.ToEntity(p, room.Id)).OrderBy(p => p.OrderIndex).ToList();

        var playersData = await repo.GetParticipantsAsync(match.RoomId.ToString(), ct);
        var players = playersData
            .Where(p => RoomRedisData.ParseParticipantStatus(p.Status) == ParticipantStatus.Approved)
            .Select(p => RoomRedisMappers.ToEntity(p, room.Id))
            .OrderBy(p => p.JoinedAt)
            .ToList();

        var submissions = new List<Submission>();
        foreach (var ph in queuePhases)
        {
            submissions.AddRange(await matchRepo.GetSubmissionsAsync(match.Id.ToString(), ph.Id.ToString(), ct));
        }

        var phases = queuePhases.Select(ToPhaseDocument).ToList();
        var phaseById = phases.ToDictionary(p => p.PhaseId);
        var byParticipant = submissions.ToLookup(s => s.ParticipantId);

        // A ordem do podio: pontuacao, depois menor tempo somado, depois ordem de entrada — a mesma
        // de MatchStatsService.GetPodiumAsync. Fica fixada aqui, no array gravado, para toda
        // leitura do documento devolver o podio sem reordenar nada.
        var participants = players
            .Select(player => ToParticipantDocument(player, byParticipant[player.Id], phaseById))
            .OrderByDescending(p => p.TotalScore)
            .ThenBy(p => p.TotalElapsedSeconds)
            .ThenBy(p => p.JoinedAt)
            .ToList();

        return new MatchDocument
        {
            Id = match.Id,
            RoomCode = room.Code,
            RoomId = match.RoomId,
            LeaderUserId = Guid.Parse(room.LeaderUserId),
            Mode = match.Mode,
            StartedAt = match.StartedAt.UtcDateTime,
            FinishedAt = (match.FinishedAt ?? match.StartedAt).UtcDateTime,
            PhaseSets = queueSets.Select(ToPhaseSetDocument).ToList(),
            Phases = phases,
            Stats = BuildStats(phases, participants),
            Participants = participants,
        };
    }

    private static MatchPhaseSetDocument ToPhaseSetDocument(RoomQueueSet set) => new()
    {
        QueueSetId = set.Id,
        SourcePhaseSetId = set.SourcePhaseSetId,
        Title = set.Title,
        Color = set.Color,
        OrderIndex = set.OrderIndex,
    };

    private static MatchPhaseDocument ToPhaseDocument(RoomQueuePhase phase) => new()
    {
        PhaseId = phase.Id,
        QueueSetId = phase.RoomQueueSetId,
        SourcePhaseId = phase.SourcePhaseId,
        OrderIndex = phase.OrderIndex,
        Kind = phase.Kind,
        Name = phase.Name,
        BasePoints = phase.BasePoints,
        PointsMultiplier = phase.PointsMultiplier,
        TimeSeconds = phase.TimeSeconds,
        MaxScore = PhaseGrading.MaxScore(phase),
        Content = PhaseContent.Parse(phase.ContentJson),
    };

    private static MatchParticipantDocument ToParticipantDocument(
        Participant player,
        IEnumerable<Submission> submissions,
        IReadOnlyDictionary<Guid, MatchPhaseDocument> phaseById)
    {
        var rows = submissions
            .Where(s => phaseById.ContainsKey(s.RoomQueuePhaseId))
            .Select(s => ToSubmissionDocument(s, phaseById[s.RoomQueuePhaseId]))
            .OrderBy(s => s.PhaseOrderIndex)
            .ToList();

        return new MatchParticipantDocument
        {
            ParticipantId = player.Id,
            UserId = player.UserId,
            DisplayName = player.DisplayName,
            AvatarIndex = player.AvatarIndex,
            JoinedAt = player.JoinedAt.UtcDateTime,
            TotalScore = rows.Sum(s => s.Score ?? 0),
            GradedCount = rows.Count(s => s.Grading is GradingStatus.Graded),
            CorrectCount = rows.Count(s => s.Correct is true),
            PendingCount = rows.Count(s => s.Grading is GradingStatus.Pending),
            TotalElapsedSeconds = rows.Sum(s => s.ElapsedSeconds),
            Submissions = rows,
        };
    }

    private static MatchSubmissionDocument ToSubmissionDocument(Submission submission, MatchPhaseDocument phase)
    {
        var dto = SubmissionProjection.ToDto(submission);

        return new MatchSubmissionDocument
        {
            PhaseId = phase.PhaseId,
            PhaseOrderIndex = phase.OrderIndex,
            MaxScore = phase.MaxScore,
            Answer = dto.Answer,
            SubmittedAt = submission.SubmittedAt.UtcDateTime,
            ElapsedSeconds = submission.ElapsedSeconds,
            ReadyAt = submission.ReadyAt?.UtcDateTime,
            Grading = dto.Grading,
            Correct = dto.Correct,
            Score = dto.Score,
            Explanation = dto.Explanation,
            AiSuggestions = dto.AiSuggestions,
            TestsPassed = dto.TestsPassed,
        };
    }

    private static MatchStatsDocument BuildStats(
        IReadOnlyList<MatchPhaseDocument> phases,
        IReadOnlyList<MatchParticipantDocument> participants)
    {
        var graded = participants.Sum(p => p.GradedCount);
        var correct = participants.Sum(p => p.CorrectCount);

        var byPhase = participants
            .SelectMany(p => p.Submissions)
            .ToLookup(s => s.PhaseId);

        int MaxScore = phases.Sum(p => p.MaxScore);

        return new MatchStatsDocument
        {
            ParticipantCount = participants.Count,
            AvgTotalScore = Average(participants.Select(p => p.TotalScore)),
            AvgScore = Average(participants
        .SelectMany(p => p.Submissions)
        .Where(s => s.Score != null)
        .Select(s => s.Score!.Value)),
            MaxScore = MaxScore,
            AccuracyRate = Percentage(correct, graded),
            MaxAvgScore = MaxScore / phases.Count,
            PhaseAccuracy = phases.Select(phase => PhaseAccuracy(byPhase[phase.PhaseId])).ToList(),
            PhaseAvgScore = phases.Select(phase => PhaseAvgScore(byPhase[phase.PhaseId])).ToList(),
        };
    }

    private static int? PhaseAccuracy(IEnumerable<MatchSubmissionDocument> rows)
    {
        var list = rows.Where(s => s.Grading is GradingStatus.Graded).ToList();
        return list.Count is 0 ? null : Percentage(list.Count(s => s.Correct is true), list.Count);
    }

    private static int? PhaseAvgScore(IEnumerable<MatchSubmissionDocument> rows)
    {
        var list = rows.Where(s => s.Score is not null).ToList();
        return list.Count is 0 ? null : Average(list.Select(s => s.Score!.Value));
    }

    private static int Average(IEnumerable<int> values)
    {
        var list = values as IReadOnlyCollection<int> ?? [.. values];
        return list.Count is 0 ? 0 : (int)Math.Round(list.Average(), MidpointRounding.AwayFromZero);
    }

    private static int Percentage(int part, int total)
        => total is 0 ? 0 : (int)Math.Round(part * 100.0 / total, MidpointRounding.AwayFromZero);
}


