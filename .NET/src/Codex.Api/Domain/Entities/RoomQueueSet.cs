namespace Codex.Api.Domain.Entities;

/// <summary>
/// api-rest.md secao 6, decisao 1 da secao 13: a fila COPIA o conjunto, nao referencia.
/// Por isso <see cref="SourcePhaseSetId"/> nao e uma FK — e so linhagem/auditoria. Editar o
/// PhaseSet original depois nao pode alterar uma partida em andamento.
/// </summary>
public class RoomQueueSet
{
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public Guid RoomId { get; set; }
    public Room Room { get; init; } = null!;

    /// <summary>Id do PhaseSet de origem no momento em que entrou na fila. Sem FK de proposito.</summary>
    public Guid SourcePhaseSetId { get; set; }

    public required string Title { get; set; }

    /// <summary>Token de cor CSS (ex.: "var(--blue-500)"), atribuido pelo servidor a partir de paleta fixa de 8 tons, sem repetir na sala.</summary>
    public required string Color { get; set; }

    public int OrderIndex { get; set; }

    public ICollection<RoomQueuePhase> Phases { get; init; } = [];
}
