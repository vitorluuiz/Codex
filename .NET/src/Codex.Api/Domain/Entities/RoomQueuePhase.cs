namespace Codex.Api.Domain.Entities;

/// <summary>
/// api-rest.md secao 6/7. Copia de uma <see cref="Phase"/> dentro da fila de uma sala especifica.
/// E o que a partida de fato executa (<c>GET /matches/{id}/current-phase</c> le daqui).
/// </summary>
public class RoomQueuePhase
{
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public Guid RoomId { get; set; }
    public Room Room { get; init; } = null!;

    public Guid RoomQueueSetId { get; set; }
    public RoomQueueSet RoomQueueSet { get; init; } = null!;

    /// <summary>Id da Phase de origem no momento da copia. Sem FK de proposito (mesma razao de RoomQueueSet).</summary>
    public Guid SourcePhaseId { get; set; }

    public PhaseKind Kind { get; set; }
    public required string Name { get; set; }
    public int BasePoints { get; set; }
    public decimal PointsMultiplier { get; set; } = 1m;
    public int TimeSeconds { get; set; }
    public int OrderIndex { get; set; }

    /// <summary>Mesmo formato de <see cref="Phase.ContentJson"/>.</summary>
    public required string ContentJson { get; set; }

    public ICollection<Submission> Submissions { get; init; } = [];
}
