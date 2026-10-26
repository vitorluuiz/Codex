using System.Text.Json.Serialization;
using Codex.Api.Domain;

namespace Codex.Api.Contracts.Phases;

/// <summary>
/// A fase na forma de <b>partida</b> — o <c>Phase</c> de <c>types.ts</c>, nao o <c>DraftPhase</c>.
///
/// E o corpo de <c>GET /rooms/{code}/queue/phases/{phaseId}</c> (secao 6, o modal "Ver desafio") e
/// sera o <c>phase</c> de <c>GET /matches/{matchId}/current-phase</c> (secao 7). Um tipo so para as
/// duas rotas: a diferenca entre elas nao e o formato, e <b>quanto do gabarito sai</b> — para o
/// lider sai tudo, para o aluno com a fase aberta nao sai nada ("regra de ouro" da secao 7). Quem
/// monta decide isso passando <c>includeAnswers</c> a <see cref="Codex.Api.Services.PhaseProjection"/>.
///
/// Como em <see cref="Codex.Api.Contracts.PhaseSets.DraftPhaseDto"/>, os campos por <c>kind</c> sao
/// anulaveis e omitidos quando nulos: o JSON que sai e exatamente a uniao discriminada de
/// <c>types.ts</c> — um quiz tem <c>options</c> e nao tem <c>segments</c>, nem como <c>null</c>.
/// Sem isso, o <c>switch (phase.kind)</c> do front receberia um objeto que nao satisfaz nenhum dos
/// quatro membros da uniao.
/// </summary>
public record PhaseDto(
    Guid Id,
    Guid SetId,
    PhaseKind Kind,
    string Name,
    int BasePoints,
    decimal PointsMultiplier,
    int TimeSeconds,

    // quiz, text (e fill nao usa: o enunciado dele vira `segments`)
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Question = null,

    // quiz
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<QuizOptionDto>? Options = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? CorrectOptionId = null,

    // fill
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<FillSegmentDto>? Segments = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string>? Words = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string>? CorrectWords = null,

    // text, code
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? ExpectedAnswer = null,

    // code
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Title = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Difficulty = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string>? Tags = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Statement = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<CodeExampleDto>? Examples = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? FileName = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<CodeLanguageDto>? Languages = null,

    // temas do desafio e tela de pre-desafio
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Theme = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    bool? ShowFeedbackAnimation = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? IntroSeconds = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? IntroTip = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    bool? IntroSound = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    bool? IntroShapes = null);

/// <summary>
/// Alternativa de quiz com id, que e o que a submissao referencia (<c>answer.optionId</c>, secao 8).
/// O id e derivado da posicao (ver <see cref="Codex.Api.Services.PhaseProjection"/>) porque o que
/// esta gravado sao indices — nao ha id de alternativa no banco para carregar.
/// </summary>
public record QuizOptionDto(string Id, string Label);

/// <summary>
/// Um pedaco do enunciado de uma fase <c>fill</c>: <c>{ type: "text", value }</c> ou
/// <c>{ type: "blank", index }</c>. A frase vai quebrada "para o front nao fazer parse" (secao 7).
/// </summary>
public record FillSegmentDto(
    string Type,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Value = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? Index = null)
{
    public const string TextType = "text";
    public const string BlankType = "blank";

    public static FillSegmentDto Text(string value) => new(TextType, Value: value);

    public static FillSegmentDto Blank(int index) => new(BlankType, Index: index);
}

public record CodeExampleDto(string Input, string Output);

/// <summary>"Linguagens ainda nao suportadas aparecem desabilitadas ('Em breve')" (types.ts).</summary>
public record CodeLanguageDto(string Id, string Label, bool Enabled, string StarterCode);
