using Codex.Api.Domain;

namespace Codex.Api.Documents;

/// <summary>
/// Repositório de documentos da biblioteca de conjuntos no MongoDB:
/// <c>user_workspaces</c>, <c>private_phase_sets</c> e <c>community_phase_sets</c>.
/// </summary>
public interface IPhaseSetDocumentStore
{
    Task<UserWorkspaceDocument> GetOrCreateWorkspaceAsync(Guid userId, CancellationToken ct);
    Task UpsertWorkspaceAsync(UserWorkspaceDocument workspace, CancellationToken ct);

    Task<PrivatePhaseSetDocument?> GetPrivateSetAsync(Guid setId, CancellationToken ct);
    Task<IReadOnlyList<PrivatePhaseSetDocument>> ListPrivateSetsByOwnerAsync(Guid ownerId, string? q, int limit, CancellationToken ct);
    Task UpsertPrivateSetAsync(PrivatePhaseSetDocument doc, CancellationToken ct);
    Task DeletePrivateSetAsync(Guid setId, Guid ownerId, CancellationToken ct);

    Task<CommunityPhaseSetDocument?> GetCommunitySetAsync(Guid setId, CancellationToken ct);
    Task<IReadOnlyList<CommunityPhaseSetDocument>> ListCommunitySetsAsync(
        string? q,
        string? subject,
        PhaseKind? kind,
        string? sort,
        Guid? excludeAuthorId,
        int limit,
        CancellationToken ct);
    Task<IReadOnlyList<CommunityPhaseSetDocument>> ListCommunitySetsByAuthorAsync(Guid authorId, int limit, CancellationToken ct);
    Task InsertCommunitySetAsync(CommunityPhaseSetDocument doc, CancellationToken ct);
    Task IncrementSetUseCountAsync(Guid setId, bool isCommunity, CancellationToken ct);
}
