namespace Codex.Api.Contracts.Matches;

/// <summary>
/// "Um unico payload alimenta o painel inteiro. Tambem e o corpo do evento <c>stats.updated</c>,
/// para o WebSocket nao ter formato proprio" (secao 10).
///
/// Um formato so, usado por HTTP e por WS — o front nao precisa de dois parsers, e o backend nao
/// precisa manter dois serializadores em sincronia.
/// </summary>
public record PhaseStatsDto(
    Guid PhaseId,
    int SubmittedCount,
    int TotalPlayers,
    int ReadyCount,
    int AccuracyRate,
    int CorrectCount,
    int GradedCount,
    int AvgResponseSeconds,
    int FastestResponseSeconds,
    int TeamAvgScore,
    int TeamTopScore,
    IReadOnlyList<AnswerDistributionEntryDto> AnswerDistribution,
    IReadOnlyList<GradingDistributionEntryDto> GradingDistribution,
    IReadOnlyList<ResponseTimeBucketDto> ResponseTimeBuckets,
    IReadOnlyList<LeaderPlayerRowDto> Players);

/// <summary>
/// "So faz sentido em quiz; nos outros tipos o painel usa gradingDistribution. Mande os dois — o
/// custo e irrelevante e evita um if/else de rota" (secao 10). Em fase que nao e quiz sai vazia.
///
/// <c>Correct</c> sai de <c>correctIndexes</c> (plural) do conteudo gravado, e nao do
/// <c>correctOptionId</c> que a projecao emite: o editor aceita mais de uma alternativa certa e a
/// projecao so tem lugar para a primeira (api-queue-log.md §4).
/// </summary>
public record AnswerDistributionEntryDto(string OptionId, string Label, int Count, bool Correct);

public record GradingDistributionEntryDto(string Status, int Count)
{
    public const string Correct = "correct";
    public const string Incorrect = "incorrect";

    /// <summary>Enviou e ainda nao tem nota — <c>text</c>/<c>code</c> sem corretor caem aqui.</summary>
    public const string Awaiting = "awaiting";
}

public record ResponseTimeBucketDto(string Label, int Count);

/// <summary>
/// Uma linha da tabela do modo avancado do painel. "No modo anonimo o front simplesmente nao
/// desenha a tabela, mas o dado ja veio" (secao 10) — se isso virar problema de privacidade, o
/// contrato sugere um <c>?scope=aggregate</c>, que nao existe ainda.
/// </summary>
public record LeaderPlayerRowDto(
    Guid ParticipantId,
    string Name,
    int AvatarIndex,
    string Status,
    int? ElapsedSeconds,
    bool? Correct)
{
    public const string Submitted = "submitted";
    public const string Pending = "pending";
}

/// <summary>
/// Corpo de <c>GET /matches/{matchId}/phases/{phaseId}/comparison</c> — a tela "Como voce se
/// compara aos outros jogadores". So responde depois que a fase fechou: e aqui que o gabarito
/// finalmente sai para o aluno.
/// </summary>
public record PhaseComparisonDto(
    int MyScore,
    int PhaseScore,
    int Percentile,
    IReadOnlyList<HistogramEntryDto> Histogram,
    string? CorrectAnswerLabel,
    bool? Correct);

/// <summary>
/// Uma barra do histograma. "Ja vem ordenado por pontuacao e sem nomes (e anonimo por construcao)."
///
/// <b>Nao ha campo de contagem no contrato</b>, entao um balde agregado (turma grande) perde
/// quantas pessoas representa — limitacao do formato, registrada em
/// match-implementation-model.md §4, decisao 10.
/// </summary>
public record HistogramEntryDto(int Score, bool IsMe);

/// <summary>Ordenado, no maximo 3 posicoes — "a tela so tem tres degraus" (secao 9).</summary>
public record PodiumEntryDto(
    Guid ParticipantId,
    string Name,
    int Score,
    int AvatarIndex,
    string? AvatarUrl);

/// <summary>"Os dois numeros do canto da barra superior" (secao 9).</summary>
public record PlayerScoreboardDto(int MyScore, int AvgScore);
