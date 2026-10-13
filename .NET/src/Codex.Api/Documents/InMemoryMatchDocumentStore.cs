using System.Collections.Concurrent;

namespace Codex.Api.Documents;

/// <summary>
/// Store em memoria, para quando <c>CodexApi:Documents:ConnectionString</c> nao esta configurada —
/// dev sem Mongo e a suite de testes, do mesmo jeito que <c>InMemoryRealtimeTicketStore</c> cobre
/// a ausencia de Redis.
///
/// <b>Isto so e aceitavel enquanto o Postgres for a fonte da verdade</b> (ate o passo 5 da secao
/// 8.2 da migracao-dados). Depois dele, perder o documento e perder a partida, e a ausencia de
/// conexao precisa virar erro de inicializacao — nao um fallback silencioso.
/// </summary>
public sealed class InMemoryMatchDocumentStore : IMatchDocumentStore
{
    private readonly ConcurrentDictionary<Guid, MatchDocument> _matches = new();

    public Task CommitAsync(MatchDocument match, CancellationToken ct)
    {
        // Mesma validacao da implementacao real, para os dois caminhos falharem igual.
        match.EnsureParticipantsAreUnique();

        _matches[match.Id] = match;
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<MatchDocument>> ListByLeaderAsync(Guid leaderUserId, int limit, CancellationToken ct)
    {
        // Sem participantes, como a projecao do store real: quem testar contra este store nao pode
        // passar a depender de um campo que o Mongo nao devolve nesta consulta.
        IReadOnlyList<MatchDocument> result = _matches.Values
            .Where(m => m.LeaderUserId == leaderUserId)
            .OrderByDescending(m => m.FinishedAt)
            .Take(limit)
            .Select(m => m with { Participants = [] })
            .ToList();

        return Task.FromResult(result);
    }

    public Task<MatchDocument?> FindAsync(Guid matchId, CancellationToken ct)
        => Task.FromResult(_matches.GetValueOrDefault(matchId));

    public Task<IReadOnlyList<MatchParticipantDocument>> ParticipantsAsync(Guid matchId, CancellationToken ct)
    {
        IReadOnlyList<MatchParticipantDocument> result = _matches.TryGetValue(matchId, out var match)
            ? match.Participants
            : [];

        return Task.FromResult(result);
    }
}
