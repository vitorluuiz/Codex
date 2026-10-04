using Codex.Api.Domain.Entities;

namespace Codex.Api.Services.Redis;

public interface IMatchRepository
{
    Task<Match?> GetMatchAsync(string matchId, CancellationToken ct);
    Task SetMatchAsync(Match match, CancellationToken ct);
    Task<bool> PutSubmissionAsync(Submission submission, CancellationToken ct);
    Task<bool> MarkSubmissionReadyAsync(string matchId, string queuePhaseId, string participantId, DateTimeOffset readyAt, CancellationToken ct);
    Task<IReadOnlyList<Submission>> GetSubmissionsAsync(string matchId, string queuePhaseId, CancellationToken ct);
    Task<MatchRedisData.PhaseAggregatesData> GetPhaseAggregatesAsync(string matchId, string queuePhaseId, CancellationToken ct);
    Task RestartPhaseAsync(string matchId, string queuePhaseId, CancellationToken ct);
    Task MarkPendingCommitAsync(string matchId, CancellationToken ct);
}
