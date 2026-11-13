using Codex.Api.Contracts.Ai;
using Codex.Api.Domain;
using MongoDB.Bson.Serialization.Attributes;

namespace Codex.Api.Documents;

/// <summary>
/// Organização pessoal da biblioteca do usuário (1 documento por <c>userId</c> em <c>user_workspaces</c>).
/// </summary>
public sealed record UserWorkspaceDocument
{
    [BsonId]
    public Guid UserId { get; init; }

    public List<string> Folders { get; init; } = [];
    public List<string> Subjects { get; init; } = [];
    public string? CoverUrl { get; set; }
    public List<Guid> SavedCommunitySetIds { get; init; } = [];
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Subdocumento <c>summary</c> pré-calculado em <c>private_phase_sets</c> e <c>community_phase_sets</c>,
/// permitindo renderizar e filtrar cards da biblioteca sem carregar arrays completos de fases.
/// </summary>
public sealed record PhaseSetSummarySubdocument
{
    public int PhaseCount { get; set; }
    public Dictionary<string, int> PhaseKindCounts { get; set; } = [];
    public List<PhaseKind> Kinds { get; set; } = [];
    public int TotalTimeSeconds { get; set; }
    public long UseCount { get; set; }
    public long SubmissionsCount { get; set; }
    public long CorrectSubmissionsCount { get; set; }
    public int? AccuracyRate { get; set; }

    public static PhaseSetSummarySubdocument Compute(
        IReadOnlyList<(PhaseKind Kind, int TimeSeconds)> phases,
        long useCount = 0,
        long submissionsCount = 0,
        long correctSubmissionsCount = 0)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        var kinds = new List<PhaseKind>();
        var seenKinds = new HashSet<PhaseKind>();
        var totalTime = 0;

        foreach (var (kind, timeSeconds) in phases)
        {
            totalTime += timeSeconds;
            var key = kind.ToString().ToLowerInvariant();
            counts[key] = counts.GetValueOrDefault(key) + 1;
            if (seenKinds.Add(kind))
            {
                kinds.Add(kind);
            }
        }

        int? accuracyRate = submissionsCount > 0
            ? (int)Math.Round(correctSubmissionsCount * 100.0 / submissionsCount, MidpointRounding.AwayFromZero)
            : null;

        return new PhaseSetSummarySubdocument
        {
            PhaseCount = phases.Count,
            PhaseKindCounts = counts,
            Kinds = kinds,
            TotalTimeSeconds = totalTime,
            UseCount = useCount,
            SubmissionsCount = submissionsCount,
            CorrectSubmissionsCount = correctSubmissionsCount,
            AccuracyRate = accuracyRate,
        };
    }
}

/// <summary>
/// Conteúdo embutido de uma fase em <c>private_phase_sets.phases[]</c>.
/// </summary>
public sealed record PhaseContentDocument
{
    public string? Question { get; init; }
    public bool FromAI { get; init; }
    public IReadOnlyList<string>? Options { get; init; }
    public IReadOnlyList<int>? CorrectIndexes { get; init; }
    public IReadOnlyList<string>? Words { get; init; }
    public IReadOnlyList<string?>? Blanks { get; init; }
    public string? StarterCode { get; init; }
    public string? TestCases { get; init; }
    public string? ExpectedAnswer { get; init; }
    public string? Theme { get; init; }
    public bool? ShowFeedbackAnimation { get; init; }
    public int? IntroSeconds { get; init; }
    public string? IntroTip { get; init; }
    public bool? IntroSound { get; init; }
    public bool? IntroShapes { get; init; }
    public AiVariationOptions? VariationSettings { get; init; }
}

/// <summary>
/// Cópia completa e isolada de uma fase dentro de um conjunto privado.
/// </summary>
public sealed record PrivatePhaseItemDocument
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? OriginCommunityPhaseId { get; set; }
    public required string ContentHash { get; set; }
    public PhaseKind Kind { get; set; }
    public required string Name { get; set; }
    public int BasePoints { get; set; }
    public decimal PointsMultiplier { get; set; } = 1.0m;
    public int TimeSeconds { get; set; }
    public int OrderIndex { get; set; }
    public required PhaseContentDocument Content { get; set; }
}

/// <summary>
/// Documento de conjunto privado em <c>private_phase_sets</c>.
/// </summary>
public sealed record PrivatePhaseSetDocument
{
    [BsonId]
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public Guid OwnerId { get; init; }
    public required string Title { get; set; }
    public string Subject { get; set; } = "Geral";
    public string? Folder { get; set; }
    public string? CoverUrl { get; set; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public Guid? PublishedSetId { get; set; }
    public int? PublishedVersion { get; set; }

    public PhaseSetSummarySubdocument Summary { get; set; } = new();
    public List<PrivatePhaseItemDocument> Phases { get; set; } = [];
}

/// <summary>
/// Conjunto publicado e imutável em <c>community_phase_sets</c>, apontando por <see cref="PhaseIds"/>
/// para os registros de <c>community_phases</c> (PostgreSQL).
/// </summary>
public sealed record CommunityPhaseSetDocument
{
    [BsonId]
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public Guid? SourcePrivateSetId { get; init; }
    public int Version { get; init; } = 1;
    public Guid AuthorId { get; init; }
    public required string AuthorName { get; init; }
    public required string Title { get; init; }
    public string Subject { get; init; } = "Geral";
    public string? CoverUrl { get; init; }
    public CommunityResourceStatus Status { get; set; } = CommunityResourceStatus.Published;
    public DateTime PublishedAt { get; init; } = DateTime.UtcNow;

    public List<Guid> PhaseIds { get; init; } = [];
    public PhaseSetSummarySubdocument Summary { get; set; } = new();
}
