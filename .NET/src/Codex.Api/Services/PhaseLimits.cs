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

    /// <summary>
    /// <b>Os tetos de texto livre.</b> Ate aqui nao existia nenhum: <c>ContentJson</c> e
    /// <c>AnswerJson</c> sao <c>jsonb</c> sem <c>HasMaxLength</c>, e a validacao do editor conferia
    /// tamanho de nome, pontos, tempo e multiplicador — nunca o de enunciado, codigo inicial,
    /// casos de teste ou resposta. O teto real era o limite de corpo do HTTP.
    ///
    /// Isso ja era um buraco, e vira <b>bloqueio</b> na migracao de dados: um documento do Mongo
    /// tem teto rigido de 16 MB, e o Redis — que passa a guardar a fila e as submissoes da partida
    /// viva — tem <c>maxmemory</c>. Estourar no Redis e estritamente pior que no Mongo: no meio da
    /// partida ainda nao existe snapshot para o qual retentar.
    ///
    /// O pior caso que a aplicacao aceita, com estes numeros (400 fases numa fila, 400 submissoes
    /// por participante):
    /// <code>
    /// fase code   4.000 + 4.096 + 4.096  =  ~12 KB  x 400 fases       =  ~4,9 MB  (matches.phases)
    /// envio code  4.096 + metadados      =  ~4,2 KB x 400 submissoes  =  ~1,7 MB  (por item de matches.participants)
    /// </code>
    /// Com os participantes embutidos no documento da partida, a soma de todas as folhas de resposta
    /// divide os 16 MB com <c>phases</c>: o teto deixou de ser estrutural e passou a depender do
    /// tamanho da turma — limitacao aceita conscientemente, ver <c>docs/contracts/mongodb.md</c>.
    /// Os tetos aqui continuam valendo para o Redis. Ver <c>docs/contracts/postgresql/migracao-dados.md</c> §5.3.
    /// </summary>
    public const int MaxQuestionLength = 300;

    /// <summary>Uma alternativa de quiz, uma palavra do banco do fill, uma entrada do gabarito posicional.</summary>
    public const int MaxOptionLength = 100;

    /// <summary>Banco de palavras do <c>fill</c>: distratores inclusos, 50 ja e muito mais do que qualquer enunciado real.</summary>
    public const int MaxWords = 10;

    public const int MaxStarterCodeLength = 4_096;
    public const int MaxTestCasesLength = 4_096;
    public const int MaxExpectedAnswerLength = 2_000;

    public const int MinIntroSeconds = 1;
    public const int MaxIntroSeconds = 60;
    public const int MaxIntroTipLength = 60;

    public static readonly IReadOnlySet<string> AllowedThemes = new HashSet<string>(StringComparer.Ordinal)
    {
        "default",
        "cyberpunk",
        "emerald",
        "sunset",
        "crimson",
    };

    /// <summary>
    /// O lado da <i>resposta</i>. <c>MaxAnswerSourceLength</c> espelha
    /// <see cref="MaxStarterCodeLength"/>: o aluno parte do codigo inicial, entao um teto menor
    /// recusaria uma solucao que apenas completasse o esqueleto que a propria fase entregou.
    /// </summary>
    public const int MaxAnswerTextLength = 4_000;

    public const int MaxAnswerSourceLength = MaxStarterCodeLength;

    public static decimal RoundMultiplier(decimal multiplier) => decimal.Round(multiplier, PointsMultiplierDecimals);

    /// <summary>
    /// Confere um texto opcional contra um teto. Devolve o proprio valor para encadear na
    /// validacao, e <c>null</c> continua valido em todo lugar que aceitava <c>null</c> — campo em
    /// branco e rascunho pela metade, nao erro (a politica de <see cref="PhaseSetService"/>).
    /// </summary>
    public static bool ExceedsLength(string? value, int max) => value is not null && value.Length > max;
}
