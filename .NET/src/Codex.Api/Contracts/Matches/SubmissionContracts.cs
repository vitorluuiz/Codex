using System.Text.Json;
using System.Text.Json.Serialization;
using Codex.Api.Domain;

namespace Codex.Api.Contracts.Matches;

/// <summary>
/// A resposta do aluno, nos quatro formatos da tabela da secao 8.
///
/// Como <c>PhaseDto</c>, e um record so com os campos por tipo anulaveis e omitidos quando nulos —
/// o JSON que sai e exatamente a uniao discriminada <c>AnswerPayload</c> de <c>types.ts</c>, e um
/// <c>quiz</c> nao carrega <c>source: null</c>.
///
/// <c>Kind</c> e string, e nao <see cref="PhaseKind"/>, para um valor desconhecido cair na
/// validacao do app (<c>400 VALIDATION_ERROR</c>) em vez de estourar no conversor de enum, que
/// responderia <c>500</c>. Mesma escolha de <c>StartMatchRequest.Mode</c>.
///
/// <b>Este mesmo tipo e o formato de armazenamento</b> (<c>submissions.AnswerJson</c>): gravar uma
/// forma e servir outra criaria duas verdades sobre a resposta de alguem.
/// </summary>
public record AnswerDto(
    string Kind,

    // quiz
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? OptionId = null,

    // fill — indice = lacuna; nulo e "lacuna deixada em branco", que nao e o mesmo que ""
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string?>? Blanks = null,

    // text
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Value = null,

    // code
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? LanguageId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Source = null)
{
    /// <summary>
    /// Serializacao de armazenamento, propria como a de <c>PhaseContent</c>: camelCase (as chaves
    /// sao as do contrato, entao quem abrir a coluna no psql le o que ve na tela) e sem nulo.
    /// </summary>
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public string ToJson() => JsonSerializer.Serialize(this, SerializerOptions);

    /// <summary>
    /// Resposta vazia no lugar de excecao quando o JSON nao desserializa — mesma politica de
    /// <c>PhaseContent.Parse</c>: uma linha corrompida deve degradar aquela submissao, e nao
    /// derrubar o placar da turma inteira.
    /// </summary>
    public static AnswerDto Parse(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<AnswerDto>(json, SerializerOptions) ?? new AnswerDto(string.Empty);
        }
        catch (JsonException)
        {
            return new AnswerDto(string.Empty);
        }
    }
}

/// <summary>Corpo de <c>POST /matches/{matchId}/phases/{phaseId}/submissions</c>.</summary>
public record SubmitAnswerRequest(AnswerDto? Answer);

/// <summary>
/// Uma sugestao da IA sobre um envio de codigo. Nada a produz hoje (a correcao de <c>code</c>
/// depende da decisao de provedor de IA, fatia C) — existe para o campo do contrato ter tipo.
/// </summary>
public record AiSuggestionDto(string Title, string Body);

public record TestsPassedDto(int Passed, int Total);

/// <summary>
/// A submissao corrigida (secao 8), e o corpo do evento <c>submission.graded</c> quando ele ganhar
/// produtor.
///
/// <c>Correct</c>, <c>Score</c> e <c>Explanation</c> sao nulos enquanto <c>Grading</c> for
/// <c>pending</c> — que e o estado permanente de <c>text</c> e <c>code</c> ate existir corretor. O
/// contrato ja preve isso ("a tela sabe lidar com os dois"), entao nao e um furo: e a degradacao
/// que ele descreve.
/// </summary>
public record SubmissionDto(
    Guid Id,
    Guid PhaseId,
    Guid ParticipantId,
    AnswerDto Answer,
    DateTimeOffset SubmittedAt,
    int ElapsedSeconds,
    GradingStatus Grading,
    bool? Correct,
    int? Score,
    string? Explanation,
    IReadOnlyList<AiSuggestionDto>? AiSuggestions,
    TestsPassedDto? TestsPassed);
