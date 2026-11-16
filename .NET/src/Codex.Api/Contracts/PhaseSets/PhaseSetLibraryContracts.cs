using System.Text.Json.Serialization;
using Codex.Api.Domain;

namespace Codex.Api.Contracts.PhaseSets;

/// <summary>
/// Entrada da biblioteca (<c>GET /phase-sets/owned</c> e <c>GET /phase-sets/community</c>) e retorno de <c>POST /phase-sets/{setId}/publish</c>,
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
/// Detalhe completo de um conjunto privado ou publicado na comunidade (<c>GET /phase-sets/{setId}</c>).
/// </summary>
public record PhaseSetDetailResponse(
    Guid Id,
    string Title,
    int PhaseCount,
    PhaseSetSource Source,
    string Visibility,
    bool IsOwner,
    Guid? AuthorId,
    string? UpdatedLabel,
    string? AuthorName,
    IReadOnlyDictionary<string, int> PhaseKindCounts,
    int? AccuracyRate,
    string DurationLabel,
    string Subject,
    string? Folder,
    long UseCount,
    string? CoverUrl,
    IReadOnlyList<DraftPhaseDto> Phases,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    Guid? PublishedSetId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    Guid? SourcePrivateSetId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? Version = null);

/// <summary>
/// Resposta de <c>GET /phase-sets/owned</c>: conjuntos privados do usuário e os metadados do workspace
/// (disciplinas, pastas e capa), lidos exclusivamente dos documentos do MongoDB.
/// </summary>
public record OwnedPhaseSetListResponse(
    IReadOnlyList<PhaseSetLibraryEntryDto> Sets,
    IReadOnlyList<string> Subjects,
    IReadOnlyList<string> Folders,
    string? CoverUrl);

/// <summary>
/// Resposta de <c>GET /phase-sets/community</c>: conjuntos publicados na comunidade (versão mais recente
/// de cada um), lidos exclusivamente de <c>community_phase_sets</c> no MongoDB.
/// </summary>
public record CommunityPhaseSetSearchResponse(
    IReadOnlyList<PhaseSetLibraryEntryDto> Sets);

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
    int? NextOffset,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string>? Subjects = null);

/// <summary>
/// Corpo de <c>POST /community/phases</c> para publicar um desafio avulso na comunidade.
/// </summary>
public record PublishCommunityPhaseRequest(
    DraftPhaseDto Phase,
    string? Subject = null,
    AiDifficulty? Difficulty = null,
    Guid? OriginPhaseId = null);
