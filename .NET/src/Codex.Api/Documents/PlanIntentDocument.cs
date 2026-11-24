using Codex.Api.Domain;
using MongoDB.Bson.Serialization.Attributes;

namespace Codex.Api.Documents;

/// <summary>
/// Intenção de contratação e percepção de valor registrada pelo usuário na seção provisória
/// "Pagamentos e plano" (1 documento por <c>userId</c> na coleção <c>plan_intents</c>).
/// </summary>
public sealed record PlanIntentDocument
{
    [BsonId]
    public Guid UserId { get; init; }

    public string UserEmail { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public Audience Audience { get; set; }
    public UserPlan CurrentPlan { get; set; }

    public UserPlan SelectedPlan { get; set; }
    public int SuggestedPriceBrl { get; set; }
    public PlanPricePerception PricePerception { get; set; }
    public PlanSubscriptionIntent SubscriptionIntent { get; set; }
    public int? ExpectedPriceBrl { get; set; }
    public string? Comment { get; set; }

    public int SubmissionCount { get; set; } = 1;
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
