using Codex.Api.Domain;

namespace Codex.Api.Contracts.Billing;

public record SavePlanIntentRequest(
    UserPlan SelectedPlan,
    PlanPricePerception PricePerception,
    PlanSubscriptionIntent SubscriptionIntent,
    int? ExpectedPriceBrl,
    string? Comment);

public record PlanIntentResponse(
    UserPlan SelectedPlan,
    int SuggestedPriceBrl,
    PlanPricePerception PricePerception,
    PlanSubscriptionIntent SubscriptionIntent,
    int? ExpectedPriceBrl,
    string? Comment,
    int SubmissionCount,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public record PlanIntentEnvelopeResponse(PlanIntentResponse? Intent);
