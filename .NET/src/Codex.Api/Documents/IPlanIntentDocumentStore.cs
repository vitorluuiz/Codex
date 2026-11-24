namespace Codex.Api.Documents;

/// <summary>
/// Repositório de documentos da pesquisa de intenção de planos na coleção <c>plan_intents</c>.
/// </summary>
public interface IPlanIntentDocumentStore
{
    Task<PlanIntentDocument?> GetByUserIdAsync(Guid userId, CancellationToken ct);
    Task UpsertAsync(PlanIntentDocument doc, CancellationToken ct);
}
