using System.Text.Json.Serialization;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Domain;

namespace Codex.Api.Contracts.Ai;

public record GeneratePhaseRequest(
    PhaseKind Kind,
    string? Topic,
    AiDifficulty Difficulty = AiDifficulty.Medium,
    string? Notes = null);

public record GenerateVariationsRequest(
    DraftPhaseDto? Source,
    AiVariationOptions? Options);

public record AiVariationOptions(
    int Count = 3,
    IReadOnlyList<AiVariationAspect>? Aspects = null,
    AiDifficultyShift Difficulty = AiDifficultyShift.Same,
    bool KeepSettings = true,
    string? Notes = null);

public record SuggestQuizOptionsRequest(
    string? Question,
    IReadOnlyList<string>? Options,
    IReadOnlyList<int>? CorrectIndexes,
    int Count = 3,
    QuizSuggestionMode Mode = QuizSuggestionMode.Distractors);

public record AiUsageDto(
    string Plan,
    int CreditsUsed,
    int CreditsLimit,
    int SuggestionsUsedToday,
    int SuggestionsDailyLimit,
    DateTimeOffset ResetsAt,
    bool Enabled)
{
    public AiUsageDto After(int costDelta, int suggestionsDelta = 0) => this with
    {
        CreditsUsed = CreditsUsed + costDelta,
        SuggestionsUsedToday = SuggestionsUsedToday + suggestionsDelta,
    };
}

public record AiPhaseResponse(
    Guid GenerationId,
    DraftPhaseDto Phase,
    AiUsageDto Usage);

public record AiVariationsResponse(
    Guid GenerationId,
    IReadOnlyList<DraftPhaseDto> Phases,
    int Discarded,
    AiUsageDto Usage);

public record QuizOptionSuggestionDto(
    string Label,
    bool IsCorrect,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Rationale = null);

public record AiQuizOptionsResponse(
    Guid GenerationId,
    IReadOnlyList<QuizOptionSuggestionDto> Suggestions,
    AiUsageDto Usage);

public record AiDecisionRequest(
    AiDecision Decision,
    int? AcceptedCount = null);
