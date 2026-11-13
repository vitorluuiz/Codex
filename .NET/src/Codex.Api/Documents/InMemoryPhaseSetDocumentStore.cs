using System.Collections.Concurrent;
using Codex.Api.Domain;

namespace Codex.Api.Documents;

/// <summary>
/// Implementação em memória de <see cref="IPhaseSetDocumentStore"/> para testes unitários e
/// desenvolvimento local sem MongoDB configurado.
/// </summary>
public sealed class InMemoryPhaseSetDocumentStore : IPhaseSetDocumentStore
{
    private readonly ConcurrentDictionary<Guid, UserWorkspaceDocument> _workspaces = new();
    private readonly ConcurrentDictionary<Guid, PrivatePhaseSetDocument> _privateSets = new();
    private readonly ConcurrentDictionary<Guid, CommunityPhaseSetDocument> _communitySets = new();
    private readonly Lock _gate = new();

    public Task<UserWorkspaceDocument> GetOrCreateWorkspaceAsync(Guid userId, CancellationToken ct)
    {
        var workspace = _workspaces.GetOrAdd(userId, id => new UserWorkspaceDocument { UserId = id });
        return Task.FromResult(Clone(workspace));
    }

    public Task UpsertWorkspaceAsync(UserWorkspaceDocument workspace, CancellationToken ct)
    {
        _workspaces[workspace.UserId] = Clone(workspace);
        return Task.CompletedTask;
    }

    public Task<PrivatePhaseSetDocument?> GetPrivateSetAsync(Guid setId, CancellationToken ct)
        => Task.FromResult(_privateSets.TryGetValue(setId, out var doc) ? Clone(doc, includePhases: true) : null);

    public Task<IReadOnlyList<PrivatePhaseSetDocument>> ListPrivateSetsByOwnerAsync(
        Guid ownerId,
        string? q,
        int limit,
        CancellationToken ct)
    {
        var search = q?.Trim();
        IEnumerable<PrivatePhaseSetDocument> query = _privateSets.Values.Where(d => d.OwnerId == ownerId);

        if (!string.IsNullOrEmpty(search))
        {
            query = query.Where(d => d.Title.Contains(search, StringComparison.OrdinalIgnoreCase));
        }

        var result = query
            .OrderByDescending(d => d.UpdatedAt)
            .Take(limit)
            .Select(d => Clone(d, includePhases: false))
            .ToList();

        return Task.FromResult<IReadOnlyList<PrivatePhaseSetDocument>>(result);
    }

    public Task UpsertPrivateSetAsync(PrivatePhaseSetDocument doc, CancellationToken ct)
    {
        _privateSets[doc.Id] = Clone(doc, includePhases: true);
        return Task.CompletedTask;
    }

    public Task DeletePrivateSetAsync(Guid setId, Guid ownerId, CancellationToken ct)
    {
        if (_privateSets.TryGetValue(setId, out var existing) && existing.OwnerId == ownerId)
        {
            _privateSets.TryRemove(setId, out _);
        }

        return Task.CompletedTask;
    }

    public Task<CommunityPhaseSetDocument?> GetCommunitySetAsync(Guid setId, CancellationToken ct)
        => Task.FromResult(_communitySets.TryGetValue(setId, out var doc) ? Clone(doc) : null);

    public Task<IReadOnlyList<CommunityPhaseSetDocument>> ListCommunitySetsAsync(
        string? q,
        string? subject,
        PhaseKind? kind,
        string? sort,
        Guid? excludeAuthorId,
        int limit,
        CancellationToken ct)
    {
        var query = _communitySets.Values
            .Where(d => d.Status == CommunityResourceStatus.Published);

        if (excludeAuthorId is { } excluded)
        {
            query = query.Where(d => d.AuthorId != excluded);
        }

        if (!string.IsNullOrWhiteSpace(subject))
        {
            var normalizedSubject = subject.Trim();
            query = query.Where(d => string.Equals(d.Subject, normalizedSubject, StringComparison.OrdinalIgnoreCase));
        }

        if (kind is { } k)
        {
            query = query.Where(d => d.Summary.Kinds.Contains(k));
        }

        var search = q?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            query = query.Where(d => d.Title.Contains(search, StringComparison.OrdinalIgnoreCase));
        }

        query = string.Equals(sort, "popular", StringComparison.OrdinalIgnoreCase)
            ? query.OrderByDescending(d => d.Summary.UseCount).ThenByDescending(d => d.PublishedAt)
            : query.OrderByDescending(d => d.PublishedAt);

        var result = query.Take(limit).Select(Clone).ToList();
        return Task.FromResult<IReadOnlyList<CommunityPhaseSetDocument>>(result);
    }

    public Task<IReadOnlyList<CommunityPhaseSetDocument>> ListCommunitySetsByAuthorAsync(
        Guid authorId,
        int limit,
        CancellationToken ct)
    {
        var result = _communitySets.Values
            .Where(d => d.AuthorId == authorId && d.Status == CommunityResourceStatus.Published)
            .OrderByDescending(d => d.PublishedAt)
            .Take(limit)
            .Select(Clone)
            .ToList();

        return Task.FromResult<IReadOnlyList<CommunityPhaseSetDocument>>(result);
    }

    public Task InsertCommunitySetAsync(CommunityPhaseSetDocument doc, CancellationToken ct)
    {
        _communitySets[doc.Id] = Clone(doc);
        return Task.CompletedTask;
    }

    public Task IncrementSetUseCountAsync(Guid setId, bool isCommunity, CancellationToken ct)
    {
        lock (_gate)
        {
            if (isCommunity && _communitySets.TryGetValue(setId, out var communityDoc))
            {
                communityDoc.Summary.UseCount += 1;
            }
            else if (!isCommunity && _privateSets.TryGetValue(setId, out var privateDoc))
            {
                privateDoc.Summary.UseCount += 1;
            }
        }

        return Task.CompletedTask;
    }

    private static UserWorkspaceDocument Clone(UserWorkspaceDocument doc) => new()
    {
        UserId = doc.UserId,
        Folders = [.. doc.Folders],
        Subjects = [.. doc.Subjects],
        CoverUrl = doc.CoverUrl,
        SavedCommunitySetIds = [.. doc.SavedCommunitySetIds],
        UpdatedAt = doc.UpdatedAt,
    };

    private static PhaseSetSummarySubdocument Clone(PhaseSetSummarySubdocument summary) => new()
    {
        PhaseCount = summary.PhaseCount,
        PhaseKindCounts = new Dictionary<string, int>(summary.PhaseKindCounts, StringComparer.Ordinal),
        Kinds = [.. summary.Kinds],
        TotalTimeSeconds = summary.TotalTimeSeconds,
        UseCount = summary.UseCount,
        SubmissionsCount = summary.SubmissionsCount,
        CorrectSubmissionsCount = summary.CorrectSubmissionsCount,
        AccuracyRate = summary.AccuracyRate,
    };

    private static PrivatePhaseSetDocument Clone(PrivatePhaseSetDocument doc, bool includePhases) => new()
    {
        Id = doc.Id,
        OwnerId = doc.OwnerId,
        Title = doc.Title,
        Subject = doc.Subject,
        Folder = doc.Folder,
        CoverUrl = doc.CoverUrl,
        CreatedAt = doc.CreatedAt,
        UpdatedAt = doc.UpdatedAt,
        PublishedSetId = doc.PublishedSetId,
        PublishedVersion = doc.PublishedVersion,
        Summary = Clone(doc.Summary),
        Phases = includePhases ? [.. doc.Phases.Select(p => p with { Content = p.Content with { } })] : [],
    };

    private static CommunityPhaseSetDocument Clone(CommunityPhaseSetDocument doc) => new()
    {
        Id = doc.Id,
        SourcePrivateSetId = doc.SourcePrivateSetId,
        Version = doc.Version,
        AuthorId = doc.AuthorId,
        AuthorName = doc.AuthorName,
        Title = doc.Title,
        Subject = doc.Subject,
        CoverUrl = doc.CoverUrl,
        Status = doc.Status,
        PublishedAt = doc.PublishedAt,
        PhaseIds = [.. doc.PhaseIds],
        Summary = Clone(doc.Summary),
    };
}
