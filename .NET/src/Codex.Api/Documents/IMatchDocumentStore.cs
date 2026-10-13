namespace Codex.Api.Documents;

/// <summary>
/// O store das partidas finalizadas.
///
/// <b><see cref="CommitAsync"/> e o ponto de commit do fim de partida</b> (secao 7 da
/// migracao-dados). Ele e idempotente: chamar duas vezes com o mesmo payload deixa o banco no
/// mesmo estado. Como os participantes vivem embutidos em <see cref="MatchDocument.Participants"/>,
/// o commit e a escrita de <b>um documento so</b> — atomica no Mongo por definicao —, e nenhuma
/// leitura enxerga uma partida pela metade nem participante orfao.
/// </summary>
public interface IMatchDocumentStore
{
    Task CommitAsync(MatchDocument match, CancellationToken ct);

    /// <summary>
    /// Historico do lider: partidas encerradas, mais recentes primeiro. <b>Sem participantes</b>:
    /// a tela so usa cabecalho, fases e agregados, entao <see cref="MatchDocument.Participants"/>
    /// volta vazio para nao trazer a folha de respostas de cada turma do disco.
    /// </summary>
    Task<IReadOnlyList<MatchDocument>> ListByLeaderAsync(Guid leaderUserId, int limit, CancellationToken ct);

    /// <summary>A partida inteira, participantes e submissoes inclusos.</summary>
    Task<MatchDocument?> FindAsync(Guid matchId, CancellationToken ct);

    /// <summary>
    /// A matriz do relatorio: participantes x fases da partida, na ordem do podio em que foram
    /// gravados. Vazio se a partida nao existe.
    /// </summary>
    Task<IReadOnlyList<MatchParticipantDocument>> ParticipantsAsync(Guid matchId, CancellationToken ct);
}
