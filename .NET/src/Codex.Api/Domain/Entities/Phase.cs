namespace Codex.Api.Domain.Entities;

/// <summary>
/// api-rest.md secao 6/7. Fase dentro de um PhaseSet (biblioteca).
/// Os campos especificos de cada "kind" (question/options, segments/words, statement/examples...)
/// nao viram colunas: ficam em <see cref="ContentJson"/> (jsonb) e sao lidos/validados pela
/// camada de servico de acordo com <see cref="Kind"/>. Isso evita uma tabela com 15+ colunas
/// esparsas e casa com o formato "um payload por kind" descrito na secao 7.4 do documento.
/// </summary>
public class Phase
{
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public Guid PhaseSetId { get; set; }
    public PhaseSet PhaseSet { get; init; } = null!;

    public PhaseKind Kind { get; set; }
    public required string Name { get; set; }
    public int BasePoints { get; set; }
    public decimal PointsMultiplier { get; set; } = 1m;
    public int TimeSeconds { get; set; }
    public int OrderIndex { get; set; }

    /// <summary>Payload por kind, incluindo o gabarito (correctOptionId/correctWords/expectedAnswer). Nunca serializado para aluno enquanto a fase estiver aberta.</summary>
    public required string ContentJson { get; set; }
}
