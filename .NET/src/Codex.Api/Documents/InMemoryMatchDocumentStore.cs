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
    private readonly ConcurrentDictionary<(Guid MatchId, Guid ParticipantId), MatchParticipantDocument> _participants = new();

    public Task CommitAsync(MatchDocument match, IReadOnlyList<MatchParticipantDocument> participants, CancellationToken ct)
    {
        // Mesma ordem da implementacao real, para os dois caminhos falharem igual.
        foreach (var participant in participants)
        {
            _participants[(participant.MatchId, participant.ParticipantId)] = participant;
        }

        _matches[match.Id] = match;
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<MatchDocument>> ListByLeaderAsync(Guid leaderUserId, int limit, CancellationToken ct)
    {
        IReadOnlyList<MatchDocument> result = _matches.Values
            .Where(m => m.LeaderUserId == leaderUserId)
            .OrderByDescending(m => m.FinishedAt)
            .Take(limit)
            .ToList();

        return Task.FromResult(result);
    }

    public Task<MatchDocument?> FindAsync(Guid matchId, CancellationToken ct)
        => Task.FromResult(_matches.GetValueOrDefault(matchId));

    public Task<IReadOnlyList<MatchParticipantDocument>> ParticipantsAsync(Guid matchId, CancellationToken ct)
    {
        IReadOnlyList<MatchParticipantDocument> result = _participants.Values
            .Where(p => p.MatchId == matchId)
            .OrderByDescending(p => p.TotalScore)
            .ThenBy(p => p.TotalElapsedSeconds)
            .ThenBy(p => p.JoinedAt)
            .ToList();

        return Task.FromResult(result);
    }
}
