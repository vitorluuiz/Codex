namespace Codex.Api.Domain.Entities;

/// <summary>api-rest.md secao 7 e 10.</summary>
public class Match
{
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public Guid RoomId { get; set; }
    public Room Room { get; init; } = null!;

    public MatchMode Mode { get; set; }
    public MatchStatus Status { get; set; } = MatchStatus.Running;
    public int CurrentPhaseIndex { get; set; }

    public DateTimeOffset StartedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; set; }

    public ICollection<Submission> Submissions { get; init; } = [];
}
