using System.Text.Json.Serialization;
using Codex.Api.Domain;

namespace Codex.Api.Contracts.PhaseSets;

/// <summary>
/// Entrada da biblioteca (<c>GET /phase-sets/library</c>) e retorno de <c>POST /phase-sets/{setId}/publish</c>,
/// alinhada com <c>PhaseSetLibraryEntry</c> do contrato e do frontend.
/// </summary>
public record PhaseSetLibraryEntryDto(
    Guid Id,
    string Title,
    int PhaseCount,
    PhaseSetSource Source,
    string? UpdatedLabel,
    string? AuthorName,
    IReadOnlyDictionary<string, int> PhaseKindCounts,
    int? AccuracyRate,
    string DurationLabel,
    string Subject,
    string? Folder,
    long UseCount,
    string? CoverUrl,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? Version = null);

/// <summary>
/// Resposta de <c>GET /phase-sets/library</c>, lida exclusivamente dos documentos do MongoDB.
/// </summary>
public record PhaseSetLibraryResponse(
    IReadOnlyList<PhaseSetLibraryEntryDto> Sets,
    IReadOnlyList<string> Subjects,
    IReadOnlyList<string> Folders,
    string? CoverUrl);

/// <summary>
/// Resumo de desafio avulso publicado no catálogo <c>community_phases</c>.
/// </summary>
public record CommunityPhaseSummaryDto(
    Guid Id,
    string Name,
    string QuestionPreview,
    PhaseKind Kind,
    string Subject,
    AiDifficulty? Difficulty,
    Guid AuthorId,
    string AuthorName,
    int BasePoints,
    decimal PointsMultiplier,
    int TimeSeconds,
    long UseCount,
    int? AccuracyRate,
    DateTimeOffset PublishedAt);

/// <summary>
/// Resposta paginada de <c>GET /community/phases</c>.
/// </summary>
public record CommunityPhaseCatalogResponse(
    IReadOnlyList<CommunityPhaseSummaryDto> Items,
    int? NextOffset);

/// <summary>
/// Corpo de <c>POST /community/phases</c> para publicar um desafio avulso na comunidade.
/// </summary>
public record PublishCommunityPhaseRequest(
    DraftPhaseDto Phase,
    string? Subject = null,
    AiDifficulty? Difficulty = null,
    Guid? OriginPhaseId = null);
