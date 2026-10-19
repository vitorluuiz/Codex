using System.Text.Json.Serialization;
using Codex.Api.Contracts.Ai;
using Codex.Api.Domain;

namespace Codex.Api.Contracts.PhaseSets;

/// <summary>
/// Formato de PhaseSetDraft (api-rest.md secao 5): o conjunto na forma que o <b>editor</b>
/// manipula, que nao e a mesma que a partida consome.
///
/// E o corpo de GET /phase-sets/{setId}/draft e tambem a resposta de POST /phase-sets e
/// PUT /phase-sets/{setId}/draft — "ambos devolvem o rascunho salvo", ja reidentificado.
/// </summary>
public record PhaseSetDraftResponse(
    Guid Id,
    string Title,
    IReadOnlyList<DraftPhaseDto> Phases);

/// <summary>
/// Corpo de POST /phase-sets e de PUT /phase-sets/{setId}/draft — "mesmo corpo" nos dois, diz o
/// contrato, e por isso um tipo so.
///
/// O editor grava o conjunto <b>inteiro</b> de uma vez, nao fase por fase: a ordem das fases e a
/// ordem do array, entao nao existe campo de posicao que possa sair de sincronia com o que o
/// autor ve no rail.
/// </summary>
public record SavePhaseSetRequest(
    string? Title,
    IReadOnlyList<DraftPhaseDto>? Phases);

/// <summary>Corpo de PATCH /phase-sets/{setId}: "so renomeia; o conteudo vai pelo PUT".</summary>
public record RenamePhaseSetRequest(string? Title);

/// <summary>
/// Uma DraftPhase de types.ts. Os campos comuns sao colunas de <c>phases</c>; os campos por
/// <c>kind</c> — que sao os que mudam de shape — entram e saem por aqui e ficam guardados no
/// <c>ContentJson</c> (ver <see cref="Codex.Api.Services.PhaseContent"/>).
///
/// <b>Um tipo so para ida e volta</b>, e nao um par request/response, porque o unico campo que
/// difere entre as duas direcoes e o <c>Id</c>: o editor manda <c>draft_*</c> em fase nova e o
/// servidor devolve o id definitivo — e por isso ele e <c>string</c>, nao <c>Guid</c>. Duplicar o
/// tipo faria as regras por kind precisarem ser escritas duas vezes.
///
/// Os campos por kind sao anulaveis e omitidos quando nulos, entao o JSON que sai e exatamente a
/// uniao discriminada de types.ts: quiz tem <c>options</c>/<c>correctIndexes</c> e nao tem
/// <c>blanks</c>, fill tem <c>words</c>/<c>blanks</c> e nao tem <c>options</c>, e assim por
/// diante. Na entrada, e a validacao por kind que cobra os que fazem falta.
///
/// <c>Name</c> e <c>Question</c> sao anulaveis so por causa da entrada (nada obriga um cliente a
/// mandar o campo): toda resposta os preenche. <c>FromAI</c> e do autor, nao do servidor — o que
/// o editor mandar volta como veio, e enquanto for <c>true</c> a fase aparece marcada como nao
/// revisada. <c>Blanks</c> e posicional: uma entrada por lacuna de <c>Question</c>, na ordem, com
/// <c>null</c> onde o autor ainda nao escolheu a palavra.
/// </summary>
public record DraftPhaseDto(
    string? Id,
    PhaseKind Kind,
    string? Name,
    int BasePoints,
    decimal PointsMultiplier,
    int TimeSeconds,
    bool FromAI,
    string? Question,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string>? Options = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<int>? CorrectIndexes = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string>? Words = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string?>? Blanks = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? StarterCode = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? TestCases = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? ExpectedAnswer = null,
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
    bool? IntroShapes = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    AiVariationOptions? VariationSettings = null);
