namespace Codex.Api.Domain.Entities;

/// <summary>api-rest.md secao 4. "code" e indexado mas nao e o id: codigos de 6 digitos sao reciclados quando a sala expira.</summary>
public class Room
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string Code { get; set; }
    public RoomStatus Status { get; set; } = RoomStatus.Lobby;
    public MatchMode? MatchMode { get; set; }
    public int Capacity { get; set; }
    public bool Locked { get; set; }
    public bool RequireAccount { get; set; }

    public Guid LeaderUserId { get; set; }
    public User Leader { get; init; } = null!;

    /// <summary>
    /// Contador de mutacoes da fila de fases (secao 6). Existe para o <c>revision</c> do
    /// <c>queue.updated</c>, que o websocket-contract.md §5 manda publicar e que nada no schema
    /// guardava — o evento leva "so o numero" de proposito, e quem quiser o detalhe refaz o GET.
    ///
    /// So cresce, e cresce em <b>toda</b> mutacao da secao 6 (inclusive as que nao mudam a
    /// quantidade de fases, como o PATCH de pontuacao): um numero que as vezes repete faria o
    /// cliente descartar uma mudanca real achando que ja a tinha visto.
    ///
    /// Nao e trava de concorrencia. O <c>409 QUEUE_MISMATCH</c> do <c>PUT /queue/order</c> compara
    /// os ids enviados com os da fila, que e o que o contrato descreve; ver
    /// <c>RoomQueueService.ReorderAsync</c>.
    /// </summary>
    public int QueueRevision { get; set; }

    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>TTL (secao 13): sugestao e 24h apos o fim da partida. Um job de limpeza (fora do escopo desta base) le este campo.</summary>
    public DateTimeOffset? ExpiresAt { get; set; }

    public ICollection<Participant> Participants { get; init; } = [];
    public ICollection<RoomQueueSet> QueueSets { get; init; } = [];
    public ICollection<RoomQueuePhase> QueuePhases { get; init; } = [];
    public ICollection<Match> Matches { get; init; } = [];
    public Guid? CurrentMatchId { get; set; }
}
