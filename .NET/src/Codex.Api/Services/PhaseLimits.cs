namespace Codex.Api.Services;

/// <summary>
/// Os limites numericos de uma fase, validos em qualquer forma que ela tenha.
///
/// Nasceram privados no <see cref="PhaseSetService"/>, onde eram a validacao do editor (secao 5).
/// Sairam de la quando o <c>PATCH /rooms/{code}/queue/phases/{phaseId}</c> (secao 6) passou a
/// mexer nos <b>mesmos tres numeros</b> pela fila da sala: com duas copias, o lider poderia gravar
/// pela fila um tempo que o editor recusaria, e a fase copiada de volta para um conjunto ficaria
/// invalida sem nunca ter passado por uma validacao que reclamasse.
///
/// Os tetos nao vem do contrato — sao sanidade contra digitacao e abuso — mas
/// <see cref="MaxNameLength"/> e <see cref="PointsMultiplierDecimals"/> vem do schema
/// (<c>HasMaxLength(160)</c> e <c>HasPrecision(5,2)</c>): cortar aqui devolve VALIDATION_ERROR em
/// vez de estourar no INSERT.
/// </summary>
public static class PhaseLimits
{
    public const int MaxNameLength = 160;

    public const int MaxBasePoints = 10_000;
    public const int MinTimeSeconds = 5;
    public const int MaxTimeSeconds = 3_600;
    public const decimal MinPointsMultiplier = 0.1m;
    public const decimal MaxPointsMultiplier = 10m;

    /// <summary>Cabe no HasPrecision(5,2) da coluna; alem disso o front mostra "x1,5", nao "x1,4999".</summary>
    public const int PointsMultiplierDecimals = 2;

    public static decimal RoundMultiplier(decimal multiplier) => decimal.Round(multiplier, PointsMultiplierDecimals);
}
