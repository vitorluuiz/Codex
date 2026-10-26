namespace Codex.Api.Domain.Entities;

public class AiGeneration
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid UserId { get; init; }
    public User User { get; init; } = null!;
    public AiOperation Operation { get; init; }
    public PhaseKind? Kind { get; init; }
    public required string Provider { get; set; }
    public required string Model { get; set; }
    public AiGenerationStatus Status { get; set; }
    public AiDecision Decision { get; set; }
    public int Cost { get; set; }
    public required string InputJson { get; init; }
    public string? OutputJson { get; set; }
    public int? PromptTokens { get; set; }
    public int? CompletionTokens { get; set; }
    public int? LatencyMs { get; set; }
    public string? ErrorCode { get; set; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DecidedAt { get; set; }
}
