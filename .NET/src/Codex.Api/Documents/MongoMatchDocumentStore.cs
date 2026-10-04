using MongoDB.Driver;

namespace Codex.Api.Documents;

/// <summary>
/// O store de verdade. A conexao e preguicosa pela mesma razao do <c>RedisRealtimeConnection</c>:
/// conectar no startup faria a API deixar de subir com o Mongo fora do ar, trocando uma degradacao
/// por uma indisponibilidade.
///
/// Os indices sao garantidos uma vez, na primeira operacao — <c>CreateMany</c> e idempotente no
/// Mongo, entao nao ha migration a rodar nem passo manual de deploy a esquecer.
/// </summary>
public sealed class MongoMatchDocumentStore : IMatchDocumentStore
{
    private readonly DocumentOptions _options;
    private readonly ILogger<MongoMatchDocumentStore> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IMongoCollection<MatchDocument>? _matches;
    private IMongoCollection<MatchParticipantDocument>? _participants;

    public MongoMatchDocumentStore(DocumentOptions options, ILogger<MongoMatchDocumentStore> logger)
    {
        _options = options;
        _logger = logger;
        DocumentConventions.Register();
    }

    public async Task CommitAsync(MatchDocument match, IReadOnlyList<MatchParticipantDocument> participants, CancellationToken ct)
    {
        var (matches, participantsCollection) = await CollectionsAsync(ct);

        // Participantes primeiro. Se a escrita da partida falhar depois disto, o historico nao
        // enxerga nada — matches e a colecao que ele consulta — e o commit inteiro pode ser
        // refeito sem duplicar linha nenhuma, porque as chaves sao estaveis.
        if (participants.Count > 0)
        {
            var writes = participants
                .Select(participant => new ReplaceOneModel<MatchParticipantDocument>(
                    Builders<MatchParticipantDocument>.Filter.Where(
                        p => p.MatchId == participant.MatchId && p.ParticipantId == participant.ParticipantId),
                    participant)
                {
                    IsUpsert = true,
                })
                .ToList();

            await participantsCollection.BulkWriteAsync(writes, new BulkWriteOptions { IsOrdered = false }, ct);
        }

        // O marcador de commit.
        await matches.ReplaceOneAsync(
            Builders<MatchDocument>.Filter.Eq(m => m.Id, match.Id),
            match,
            new ReplaceOptions { IsUpsert = true },
            ct);
    }

    public async Task<IReadOnlyList<MatchDocument>> ListByLeaderAsync(Guid leaderUserId, int limit, CancellationToken ct)
    {
        var (matches, _) = await CollectionsAsync(ct);

        return await matches
            .Find(m => m.LeaderUserId == leaderUserId)
            .SortByDescending(m => m.FinishedAt)
            .Limit(limit)
            .ToListAsync(ct);
    }

    public async Task<MatchDocument?> FindAsync(Guid matchId, CancellationToken ct)
    {
        var (matches, _) = await CollectionsAsync(ct);

        return await matches.Find(m => m.Id == matchId).FirstOrDefaultAsync(ct);
    }

    public async Task<IReadOnlyList<MatchParticipantDocument>> ParticipantsAsync(Guid matchId, CancellationToken ct)
    {
        var (_, participants) = await CollectionsAsync(ct);

        // A ordem do podio: pontuacao, depois menor tempo somado, depois ordem de entrada. Nunca a
        // ordem natural do banco — duas leituras empatadas trocariam de posicao entre si.
        return await participants
            .Find(p => p.MatchId == matchId)
            .SortByDescending(p => p.TotalScore)
            .ThenBy(p => p.TotalElapsedSeconds)
            .ThenBy(p => p.JoinedAt)
            .ToListAsync(ct);
    }

    private async Task<(IMongoCollection<MatchDocument> Matches, IMongoCollection<MatchParticipantDocument> Participants)> CollectionsAsync(
        CancellationToken ct)
    {
        if (_matches is not null && _participants is not null)
        {
            return (_matches, _participants);
        }

        await _gate.WaitAsync(ct);
        try
        {
            if (_matches is not null && _participants is not null)
            {
                return (_matches, _participants);
            }

            var database = new MongoClient(_options.ConnectionString).GetDatabase(_options.DatabaseName);
            var matches = database.GetCollection<MatchDocument>("matches");
            var participants = database.GetCollection<MatchParticipantDocument>("match_participants");

            await EnsureIndexesAsync(matches, participants, ct);

            _matches = matches;
            _participants = participants;
            _logger.LogInformation("Store de partidas conectado ao banco de documentos \"{Database}\".", _options.DatabaseName);
            return (matches, participants);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static async Task EnsureIndexesAsync(
        IMongoCollection<MatchDocument> matches,
        IMongoCollection<MatchParticipantDocument> participants,
        CancellationToken ct)
    {
        var match = Builders<MatchDocument>.IndexKeys;
        await matches.Indexes.CreateManyAsync(
            [
                // O historico do lider.
                new CreateIndexModel<MatchDocument>(match.Ascending(m => m.LeaderUserId).Descending(m => m.FinishedAt)),
                new CreateIndexModel<MatchDocument>(match.Descending(m => m.FinishedAt)),
                new CreateIndexModel<MatchDocument>(match.Ascending(m => m.RoomCode).Descending(m => m.FinishedAt)),
            ],
            ct);

        var participant = Builders<MatchParticipantDocument>.IndexKeys;
        await participants.Indexes.CreateManyAsync(
            [
                // Reproduz a unicidade que o indice (MatchId, RoomQueuePhaseId, ParticipantId) do
                // Postgres garantia, no nivel em que ela sobrou: uma pessoa, uma linha por partida.
                new CreateIndexModel<MatchParticipantDocument>(
                    participant.Ascending(p => p.MatchId).Ascending(p => p.ParticipantId),
                    new CreateIndexOptions { Unique = true }),
                new CreateIndexModel<MatchParticipantDocument>(participant.Ascending(p => p.MatchId)),
                // O historico do jogador — o vinculo participante->partida que nunca existiu no SQL.
                new CreateIndexModel<MatchParticipantDocument>(
                    participant.Ascending(p => p.UserId).Descending(p => p.MatchId)),
            ],
            ct);
    }
}
