namespace Codex.Api.Documents;

/// <summary>
/// O store das partidas finalizadas.
///
/// <b><see cref="CommitAsync"/> e o ponto de commit do fim de partida</b> (secao 7 da
/// migracao-dados). Ele e idempotente: chamar duas vezes com o mesmo payload deixa o banco no
/// mesmo estado. A ordem interna nao e negociavel — participantes primeiro, partida por ultimo —,
/// porque <c>matches</c> e a colecao que o historico consulta: grava-la no fim significa que
/// nenhuma leitura enxerga uma partida pela metade.
/// </summary>
public interface IMatchDocumentStore
{
    Task CommitAsync(MatchDocument match, IReadOnlyList<MatchParticipantDocument> participants, CancellationToken ct);

    /// <summary>Historico do lider: partidas encerradas, mais recentes primeiro.</summary>
    Task<IReadOnlyList<MatchDocument>> ListByLeaderAsync(Guid leaderUserId, int limit, CancellationToken ct);

    Task<MatchDocument?> FindAsync(Guid matchId, CancellationToken ct);

    /// <summary>A matriz do relatorio: uma consulta so devolve participantes x fases da partida.</summary>
    Task<IReadOnlyList<MatchParticipantDocument>> ParticipantsAsync(Guid matchId, CancellationToken ct);
}
