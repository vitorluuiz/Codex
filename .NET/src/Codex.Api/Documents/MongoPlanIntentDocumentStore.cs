using MongoDB.Driver;

namespace Codex.Api.Documents;

/// <summary>
/// Implementação MongoDB de <see cref="IPlanIntentDocumentStore"/> seguindo o padrão de conexão
/// preguiçosa dos demais stores de documentos.
/// </summary>
public sealed class MongoPlanIntentDocumentStore : IPlanIntentDocumentStore
{
    private readonly DocumentOptions _options;
    private readonly ILogger<MongoPlanIntentDocumentStore> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private IMongoCollection<PlanIntentDocument>? _intents;

    public MongoPlanIntentDocumentStore(DocumentOptions options, ILogger<MongoPlanIntentDocumentStore> logger)
    {
        _options = options;
        _logger = logger;
        DocumentConventions.Register();
    }

    public async Task<PlanIntentDocument?> GetByUserIdAsync(Guid userId, CancellationToken ct)
    {
        var collection = await CollectionAsync(ct);
        return await collection.Find(doc => doc.UserId == userId).FirstOrDefaultAsync(ct);
    }

    public async Task UpsertAsync(PlanIntentDocument doc, CancellationToken ct)
    {
        var collection = await CollectionAsync(ct);
        await collection.ReplaceOneAsync(
            Builders<PlanIntentDocument>.Filter.Eq(d => d.UserId, doc.UserId),
            doc,
            new ReplaceOptions { IsUpsert = true },
            ct);
    }

    private async Task<IMongoCollection<PlanIntentDocument>> CollectionAsync(CancellationToken ct)
    {
        if (_intents is not null)
        {
            return _intents;
        }

        await _gate.WaitAsync(ct);
        try
        {
            if (_intents is not null)
            {
                return _intents;
            }

            var database = new MongoClient(_options.ConnectionString).GetDatabase(_options.DatabaseName);
            var collection = database.GetCollection<PlanIntentDocument>("plan_intents");

            await EnsureIndexesAsync(collection, ct);

            _intents = collection;
            _logger.LogInformation("Store de intenções de plano conectado ao banco de documentos \"{Database}\".", _options.DatabaseName);
            return collection;
        }
        finally
        {
            _gate.Release();
        }
    }

    private static Task EnsureIndexesAsync(IMongoCollection<PlanIntentDocument> collection, CancellationToken ct)
    {
        var keys = Builders<PlanIntentDocument>.IndexKeys;
        return collection.Indexes.CreateManyAsync(
            [
                new CreateIndexModel<PlanIntentDocument>(keys.Ascending(d => d.SelectedPlan).Descending(d => d.UpdatedAt)),
                new CreateIndexModel<PlanIntentDocument>(keys.Ascending(d => d.SubscriptionIntent).Ascending(d => d.PricePerception)),
                new CreateIndexModel<PlanIntentDocument>(keys.Descending(d => d.UpdatedAt)),
            ],
            ct);
    }
}
