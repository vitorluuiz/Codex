using System.Collections.Concurrent;

namespace Codex.Api.Documents;

/// <summary>
/// Implementação em memória de <see cref="IPlanIntentDocumentStore"/> para testes unitários e
/// desenvolvimento local sem MongoDB configurado.
/// </summary>
public sealed class InMemoryPlanIntentDocumentStore : IPlanIntentDocumentStore
{
    private readonly ConcurrentDictionary<Guid, PlanIntentDocument> _intents = new();

    public Task<PlanIntentDocument?> GetByUserIdAsync(Guid userId, CancellationToken ct)
        => Task.FromResult(_intents.TryGetValue(userId, out var doc) ? doc with { } : null);

    public Task UpsertAsync(PlanIntentDocument doc, CancellationToken ct)
    {
        _intents[doc.UserId] = doc with { };
        return Task.CompletedTask;
    }
}
