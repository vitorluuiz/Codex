using MongoDB.Driver;

namespace Codex.Api.Documents;

/// <summary>
/// O store de verdade. A conexao e preguicosa pela mesma razao do <c>RedisRealtimeConnection</c>:
/// conectar no startup faria a API deixar de subir com o Mongo fora do ar, trocando uma degradacao
/// por uma indisponibilidade.
///
/// Os indices sao garantidos uma vez, na primeira operacao — <c>CreateMany</c> e idempotente no
/// Mongo, entao nao ha migration a rodar nem passo manual de deploy a esquecer.
///
/// <b>Uma colecao so.</b> Os participantes vivem embutidos em <c>matches.participants[]</c>; a
/// antiga <c>match_participants</c> nao e mais lida nem escrita (o script
/// <c>mongo/migrations/001-embed-participants.js</c> converte documentos da versao 1).
/// </summary>
public sealed class MongoMatchDocumentStore : IMatchDocumentStore
{
    private readonly DocumentOptions _options;
    private readonly ILogger<MongoMatchDocumentStore> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IMongoCollection<MatchDocument>? _matches;

    public MongoMatchDocumentStore(DocumentOptions options, ILogger<MongoMatchDocumentStore> logger)
    {
        _options = options;
        _logger = logger;
        DocumentConventions.Register();
    }

    public async Task CommitAsync(MatchDocument match, CancellationToken ct)
    {
        // A unicidade que o indice (matchId, participantId) garantia: indice unico nao alcanca
        // elementos repetidos dentro de um mesmo array, entao a checagem e feita aqui.
        match.EnsureParticipantsAreUnique();

        var matches = await MatchesAsync(ct);

        // Um documento, uma escrita: atomica no Mongo, entao nao existe mais o estado intermediario
        // "participantes gravados, partida nao" que a ordem antiga precisava esconder. Refazer o
        // commit depois de uma falha substitui o documento inteiro pela mesma chave — idempotente.
        await matches.ReplaceOneAsync(
            Builders<MatchDocument>.Filter.Eq(m => m.Id, match.Id),
            match,
            new ReplaceOptions { IsUpsert = true },
            ct);
    }

    public async Task<IReadOnlyList<MatchDocument>> ListByLeaderAsync(Guid leaderUserId, int limit, CancellationToken ct)
    {
        var matches = await MatchesAsync(ct);

        // O historico so le cabecalho, fases e agregados. Projetar participants[] para fora evita
        // trazer do disco a folha de respostas de cada turma so para descarta-la; a propriedade
        // volta com o valor padrao (lista vazia).
        return await matches
            .Find(m => m.LeaderUserId == leaderUserId)
            .Project<MatchDocument>(Builders<MatchDocument>.Projection.Exclude(m => m.Participants))
            .SortByDescending(m => m.FinishedAt)
            .Limit(limit)
            .ToListAsync(ct);
    }

    public async Task<MatchDocument?> FindAsync(Guid matchId, CancellationToken ct)
    {
        var matches = await MatchesAsync(ct);

        return await matches.Find(m => m.Id == matchId).FirstOrDefaultAsync(ct);
    }

    public async Task<MatchDocument?> FindLatestByRoomCodeAsync(string roomCode, CancellationToken ct)
    {
        var matches = await MatchesAsync(ct);

        return await matches
            .Find(m => m.RoomCode == roomCode)
            .SortByDescending(m => m.FinishedAt)
            .FirstOrDefaultAsync(ct);
    }

    public async Task<IReadOnlyList<MatchDocument>> ListByUserAsync(Guid userId, int limit, CancellationToken ct)
    {
        var matches = await MatchesAsync(ct);
        var filter = Builders<MatchDocument>.Filter.Or(
            Builders<MatchDocument>.Filter.Eq(m => m.LeaderUserId, userId),
            Builders<MatchDocument>.Filter.ElemMatch(m => m.Participants, p => p.UserId == userId));

        return await matches
            .Find(filter)
            .SortByDescending(m => m.FinishedAt)
            .Limit(limit)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<MatchParticipantDocument>> ParticipantsAsync(Guid matchId, CancellationToken ct)
    {
        var matches = await MatchesAsync(ct);

        // So participants[] sai do servidor. A ordem e a do array — a do podio, fixada pelo
        // MatchDocumentWriter no commit —, e a ordem de um array BSON e preservada pelo banco:
        // duas leituras nunca trocam empatados de posicao.
        var participants = await matches
            .Find(m => m.Id == matchId)
            .Project(m => m.Participants)
            .FirstOrDefaultAsync(ct);

        return participants ?? [];
    }

    private async Task<IMongoCollection<MatchDocument>> MatchesAsync(CancellationToken ct)
    {
        if (_matches is not null)
        {
            return _matches;
        }

        await _gate.WaitAsync(ct);
        try
        {
            if (_matches is not null)
            {
                return _matches;
            }

            var database = new MongoClient(_options.ConnectionString).GetDatabase(_options.DatabaseName);
            var matches = database.GetCollection<MatchDocument>("matches");

            await EnsureIndexesAsync(matches, ct);

            _matches = matches;
            _logger.LogInformation("Store de partidas conectado ao banco de documentos \"{Database}\".", _options.DatabaseName);
            return matches;
        }
        finally
        {
            _gate.Release();
        }
    }

    private static async Task EnsureIndexesAsync(IMongoCollection<MatchDocument> matches, CancellationToken ct)
    {
        var match = Builders<MatchDocument>.IndexKeys;
        await matches.Indexes.CreateManyAsync(
            [
                // O historico do lider.
                new CreateIndexModel<MatchDocument>(match.Ascending(m => m.LeaderUserId).Descending(m => m.FinishedAt)),
                new CreateIndexModel<MatchDocument>(match.Descending(m => m.FinishedAt)),
                new CreateIndexModel<MatchDocument>(match.Ascending(m => m.RoomCode).Descending(m => m.FinishedAt)),
                // O historico do jogador — o vinculo participante->partida que nunca existiu no SQL.
                // Multikey sobre o array embutido: a partida entra no indice uma vez por pessoa.
                // Convidado (userId omitido do BSON) cai na chave null, que consulta nenhuma
                // por usuario alcanca.
                new CreateIndexModel<MatchDocument>(
                    match.Ascending("participants.userId").Descending(m => m.FinishedAt)),
            ],
            ct);
    }
}
