namespace Codex.Api.Domain.Entities;

/// <summary>api-rest.md secao 5. Biblioteca de conjuntos de fases (proprios ou da comunidade).</summary>
public class PhaseSet
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string Title { get; set; }

    public Guid OwnerId { get; set; }
    public User Owner { get; init; } = null!;

    public PhaseSetVisibility Visibility { get; set; } = PhaseSetVisibility.Private;

    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public ICollection<Phase> Phases { get; init; } = [];
}
