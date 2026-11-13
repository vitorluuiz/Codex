using System.Text.RegularExpressions;
using Codex.Api.Domain;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Codex.Api.Documents;

/// <summary>
/// Implementação MongoDB de <see cref="IPhaseSetDocumentStore"/> seguindo o padrão de conexão
/// preguiçosa de <see cref="MongoMatchDocumentStore"/>.
/// </summary>
public sealed class MongoPhaseSetDocumentStore : IPhaseSetDocumentStore
{
    private readonly DocumentOptions _options;
    private readonly ILogger<MongoPhaseSetDocumentStore> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private IMongoCollection<UserWorkspaceDocument>? _workspaces;
    private IMongoCollection<PrivatePhaseSetDocument>? _privateSets;
    private IMongoCollection<CommunityPhaseSetDocument>? _communitySets;

    public MongoPhaseSetDocumentStore(DocumentOptions options, ILogger<MongoPhaseSetDocumentStore> logger)
    {
        _options = options;
        _logger = logger;
        DocumentConventions.Register();
    }

    public async Task<UserWorkspaceDocument> GetOrCreateWorkspaceAsync(Guid userId, CancellationToken ct)
    {
        var (workspaces, _, _) = await CollectionsAsync(ct);
        var existing = await workspaces.Find(w => w.UserId == userId).FirstOrDefaultAsync(ct);
        if (existing is not null)
        {
            return existing;
        }

        var created = new UserWorkspaceDocument { UserId = userId, UpdatedAt = DateTime.UtcNow };
        await workspaces.ReplaceOneAsync(
            Builders<UserWorkspaceDocument>.Filter.Eq(w => w.UserId, userId),
            created,
            new ReplaceOptions { IsUpsert = true },
            ct);

        return created;
    }

    public async Task UpsertWorkspaceAsync(UserWorkspaceDocument workspace, CancellationToken ct)
    {
        var (workspaces, _, _) = await CollectionsAsync(ct);
        await workspaces.ReplaceOneAsync(
            Builders<UserWorkspaceDocument>.Filter.Eq(w => w.UserId, workspace.UserId),
            workspace,
            new ReplaceOptions { IsUpsert = true },
            ct);
    }

    public async Task<PrivatePhaseSetDocument?> GetPrivateSetAsync(Guid setId, CancellationToken ct)
    {
        var (_, privateSets, _) = await CollectionsAsync(ct);
        return await privateSets.Find(s => s.Id == setId).FirstOrDefaultAsync(ct);
    }

    public async Task<IReadOnlyList<PrivatePhaseSetDocument>> ListPrivateSetsByOwnerAsync(
        Guid ownerId,
        string? q,
        int limit,
        CancellationToken ct)
    {
        var (_, privateSets, _) = await CollectionsAsync(ct);
        var builder = Builders<PrivatePhaseSetDocument>.Filter;
        var filter = builder.Eq(s => s.OwnerId, ownerId);

        var search = q?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            filter &= builder.Regex(s => s.Title, new BsonRegularExpression(Regex.Escape(search), "i"));
        }

        return await privateSets
            .Find(filter)
            .Project<PrivatePhaseSetDocument>(Builders<PrivatePhaseSetDocument>.Projection.Exclude(s => s.Phases))
            .SortByDescending(s => s.UpdatedAt)
            .Limit(limit)
            .ToListAsync(ct);
    }

    public async Task UpsertPrivateSetAsync(PrivatePhaseSetDocument doc, CancellationToken ct)
    {
        var (_, privateSets, _) = await CollectionsAsync(ct);
        await privateSets.ReplaceOneAsync(
            Builders<PrivatePhaseSetDocument>.Filter.Eq(s => s.Id, doc.Id),
            doc,
            new ReplaceOptions { IsUpsert = true },
            ct);
    }

    public async Task DeletePrivateSetAsync(Guid setId, Guid ownerId, CancellationToken ct)
    {
        var (_, privateSets, _) = await CollectionsAsync(ct);
        await privateSets.DeleteOneAsync(s => s.Id == setId && s.OwnerId == ownerId, ct);
    }

    public async Task<CommunityPhaseSetDocument?> GetCommunitySetAsync(Guid setId, CancellationToken ct)
    {
        var (_, _, communitySets) = await CollectionsAsync(ct);
        return await communitySets.Find(s => s.Id == setId).FirstOrDefaultAsync(ct);
    }

    public async Task<IReadOnlyList<CommunityPhaseSetDocument>> ListCommunitySetsAsync(
        string? q,
        string? subject,
        PhaseKind? kind,
        string? sort,
        Guid? excludeAuthorId,
        int limit,
        CancellationToken ct)
    {
        var (_, _, communitySets) = await CollectionsAsync(ct);
        var builder = Builders<CommunityPhaseSetDocument>.Filter;
        var filter = builder.Eq(s => s.Status, CommunityResourceStatus.Published);

        if (excludeAuthorId is { } excluded)
        {
            filter &= builder.Ne(s => s.AuthorId, excluded);
        }

        if (!string.IsNullOrWhiteSpace(subject))
        {
            filter &= builder.Eq(s => s.Subject, subject.Trim());
        }

        if (kind is { } k)
        {
            filter &= builder.AnyEq(s => s.Summary.Kinds, k);
        }

        var search = q?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            filter &= builder.Regex(s => s.Title, new BsonRegularExpression(Regex.Escape(search), "i"));
        }

        var find = communitySets.Find(filter);
        var sorted = string.Equals(sort, "popular", StringComparison.OrdinalIgnoreCase)
            ? find.SortByDescending(s => s.Summary.UseCount).ThenByDescending(s => s.PublishedAt)
            : find.SortByDescending(s => s.PublishedAt);

        return await sorted.Limit(limit).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<CommunityPhaseSetDocument>> ListCommunitySetsByAuthorAsync(
        Guid authorId,
        int limit,
        CancellationToken ct)
    {
        var (_, _, communitySets) = await CollectionsAsync(ct);
        return await communitySets
            .Find(s => s.AuthorId == authorId && s.Status == CommunityResourceStatus.Published)
            .SortByDescending(s => s.PublishedAt)
            .Limit(limit)
            .ToListAsync(ct);
    }

    public async Task InsertCommunitySetAsync(CommunityPhaseSetDocument doc, CancellationToken ct)
    {
        var (_, _, communitySets) = await CollectionsAsync(ct);
        await communitySets.InsertOneAsync(doc, cancellationToken: ct);
    }

    public async Task IncrementSetUseCountAsync(Guid setId, bool isCommunity, CancellationToken ct)
    {
        var (_, privateSets, communitySets) = await CollectionsAsync(ct);
        if (isCommunity)
        {
            await communitySets.UpdateOneAsync(
                s => s.Id == setId,
                Builders<CommunityPhaseSetDocument>.Update.Inc(s => s.Summary.UseCount, 1),
                cancellationToken: ct);
            return;
        }

        await privateSets.UpdateOneAsync(
            s => s.Id == setId,
            Builders<PrivatePhaseSetDocument>.Update.Inc(s => s.Summary.UseCount, 1),
            cancellationToken: ct);
    }

    private async Task<(
        IMongoCollection<UserWorkspaceDocument> Workspaces,
        IMongoCollection<PrivatePhaseSetDocument> PrivateSets,
        IMongoCollection<CommunityPhaseSetDocument> CommunitySets)> CollectionsAsync(CancellationToken ct)
    {
        if (_workspaces is not null && _privateSets is not null && _communitySets is not null)
        {
            return (_workspaces, _privateSets, _communitySets);
        }

        await _gate.WaitAsync(ct);
        try
        {
            if (_workspaces is not null && _privateSets is not null && _communitySets is not null)
            {
                return (_workspaces, _privateSets, _communitySets);
            }

            var database = new MongoClient(_options.ConnectionString).GetDatabase(_options.DatabaseName);
            var workspaces = database.GetCollection<UserWorkspaceDocument>("user_workspaces");
            var privateSets = database.GetCollection<PrivatePhaseSetDocument>("private_phase_sets");
            var communitySets = database.GetCollection<CommunityPhaseSetDocument>("community_phase_sets");

            await EnsureIndexesAsync(privateSets, communitySets, ct);

            _workspaces = workspaces;
            _privateSets = privateSets;
            _communitySets = communitySets;

            _logger.LogInformation("Store de conjuntos conectado ao banco de documentos \"{Database}\".", _options.DatabaseName);
            return (workspaces, privateSets, communitySets);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static async Task EnsureIndexesAsync(
        IMongoCollection<PrivatePhaseSetDocument> privateSets,
        IMongoCollection<CommunityPhaseSetDocument> communitySets,
        CancellationToken ct)
    {
        var priv = Builders<PrivatePhaseSetDocument>.IndexKeys;
        await privateSets.Indexes.CreateManyAsync(
            [
                new CreateIndexModel<PrivatePhaseSetDocument>(priv.Ascending(s => s.OwnerId).Descending(s => s.UpdatedAt)),
                new CreateIndexModel<PrivatePhaseSetDocument>(priv.Ascending(s => s.OwnerId).Ascending(s => s.Folder).Descending(s => s.UpdatedAt)),
            ],
            ct);

        var comm = Builders<CommunityPhaseSetDocument>.IndexKeys;
        await communitySets.Indexes.CreateManyAsync(
            [
                new CreateIndexModel<CommunityPhaseSetDocument>(comm.Ascending(s => s.Status).Ascending(s => s.Subject).Descending("summary.useCount")),
                new CreateIndexModel<CommunityPhaseSetDocument>(comm.Ascending(s => s.Status).Descending(s => s.PublishedAt)),
                new CreateIndexModel<CommunityPhaseSetDocument>(comm.Ascending(s => s.AuthorId).Ascending(s => s.Status).Descending(s => s.PublishedAt)),
                new CreateIndexModel<CommunityPhaseSetDocument>(comm.Ascending(s => s.PhaseIds)),
                new CreateIndexModel<CommunityPhaseSetDocument>(
                    comm.Text(s => s.Title),
                    new CreateIndexOptions { DefaultLanguage = "portuguese" }),
            ],
            ct);
    }
}
