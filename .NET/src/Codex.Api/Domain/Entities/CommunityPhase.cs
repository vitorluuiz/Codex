namespace Codex.Api.Domain.Entities;

/// <summary>
/// Catálogo global e imutável de desafios da comunidade em <c>community_phases</c> (PostgreSQL).
/// </summary>
public class CommunityPhase
{
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public Guid AuthorId { get; set; }
    public User Author { get; set; } = null!;
    public required string AuthorName { get; set; }

    public Guid? OriginPhaseId { get; set; }
    public Guid? SourceDraftPhaseId { get; set; }
    public int Version { get; set; } = 1;

    public PhaseKind Kind { get; set; }
    public string Subject { get; set; } = "Geral";
    public AiDifficulty? Difficulty { get; set; }
    public required string Name { get; set; }
    public required string QuestionPreview { get; set; }
    public int BasePoints { get; set; }
    public decimal PointsMultiplier { get; set; } = 1.00m;
    public int TimeSeconds { get; set; }

    public required string ContentJson { get; set; }
    public required string ContentHash { get; set; }

    public CommunityResourceStatus Status { get; set; } = CommunityResourceStatus.Published;
    public long UseCount { get; set; }
    public long SubmissionsCount { get; set; }
    public long CorrectSubmissionsCount { get; set; }
    public DateTimeOffset PublishedAt { get; init; } = DateTimeOffset.UtcNow;
}
