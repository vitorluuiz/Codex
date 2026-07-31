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

    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>TTL (secao 13): sugestao e 24h apos o fim da partida. Um job de limpeza (fora do escopo desta base) le este campo.</summary>
    public DateTimeOffset? ExpiresAt { get; set; }

    public ICollection<Participant> Participants { get; init; } = [];
    public ICollection<RoomQueueSet> QueueSets { get; init; } = [];
    public ICollection<RoomQueuePhase> QueuePhases { get; init; } = [];
    public ICollection<Match> Matches { get; init; } = [];
}
