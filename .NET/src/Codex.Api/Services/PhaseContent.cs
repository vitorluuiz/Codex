using System.Text.Json;
using System.Text.Json.Serialization;
using Codex.Api.Contracts.Ai;
using Codex.Api.Contracts.PhaseSets;

namespace Codex.Api.Services;

/// <summary>
/// O que vai dentro de <c>phases.ContentJson</c> (jsonb) — os campos que mudam de shape conforme
/// o <c>kind</c> da fase. O resto (nome, pontos, tempo, ordem) e coluna.
///
/// <b>A decisao que este tipo fixa:</b> o que fica gravado e a forma de <i>autoria</i>
/// (DraftPhase), nao a forma de <i>partida</i> (Phase). As duas sao projecoes da mesma fase
/// (tabela da secao 5 do contrato), mas so a de autoria e superset: dela da para derivar a da
/// partida (quebrar o enunciado do <c>fill</c> em segmentos, dar id a cada alternativa do quiz,
/// esconder o gabarito), e o contrario perde informacao — os segmentos ja quebrados nao dizem se
/// o autor escreveu <c>___</c> ou <c>PALAVRA</c>, e uma alternativa com id nao volta a ser indice.
/// Gravar a forma de partida obrigaria a guardar as duas, que e o jeito garantido de elas
/// divergirem. Quem le isto de volta na hora da partida (secao 7) converte na saida.
///
/// A copia PhaseSet -> fila (<see cref="RoomQueueService.AppendSetAsync"/>) move este JSON
/// <b>literal</b>, entao a fila de uma sala guarda exatamente o mesmo formato — e o
/// <c>GET /queue/phases/{phaseId}</c> da secao 6 vai ler daqui.
/// </summary>
public sealed record PhaseContent(
    string? Question = null,
    bool FromAI = false,
    IReadOnlyList<string>? Options = null,
    IReadOnlyList<int>? CorrectIndexes = null,
    IReadOnlyList<string>? Words = null,
    IReadOnlyList<string?>? Blanks = null,
    string? StarterCode = null,
    string? TestCases = null,
    string? ExpectedAnswer = null,
    string? Theme = null,
    bool? ShowFeedbackAnimation = null,
    int? IntroSeconds = null,
    string? IntroTip = null,
    bool? IntroSound = null,
    bool? IntroShapes = null,
    AiVariationOptions? VariationSettings = null)
{
    /// <summary>
    /// Marcadores que abrem uma lacuna numa fase <c>fill</c>. Espelham
    /// <c>BLANK_TOKENS</c>/<c>BLANK_PATTERN</c> de <c>set-editor/phaseKinds.tsx</c>: o gabarito e
    /// posicional, entao servidor e editor precisam contar exatamente as mesmas lacunas — contar
    /// diferente aqui rejeitaria um rascunho que a tela mostra como valido.
    /// </summary>
    public static readonly IReadOnlyList<string> BlankTokens = ["___", "PALAVRA"];

    /// <summary>
    /// Serializacao propria, e nao a do HTTP: este JSON e formato de <b>armazenamento</b>. Fica
    /// camelCase de proposito (as chaves sao as mesmas do contrato, e assim quem abrir a coluna no
    /// psql le o que ve na tela) e omite nulo, para uma fase de quiz nao gravar sete campos vazios
    /// de outros kinds.
    /// </summary>
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    /// <summary>
    /// Quantas lacunas o enunciado declara. Varredura da esquerda para a direita, com
    /// <c>___</c> tentado antes de <c>PALAVRA</c> — a mesma ordem da alternancia do regex do
    /// editor, que e o que decide o resultado em casos como <c>"____"</c> (uma lacuna, e sobra um
    /// underscore).
    /// </summary>
    public static int CountBlanks(string? question)
    {
        if (string.IsNullOrEmpty(question))
        {
            return 0;
        }

        var count = 0;

        for (var index = 0; index < question.Length;)
        {
            var token = BlankTokens.FirstOrDefault(t => string.CompareOrdinal(question, index, t, 0, t.Length) is 0);
            if (token is null)
            {
                index++;
                continue;
            }

            count++;
            index += token.Length;
        }

        return count;
    }

    /// <summary>O que sobra da fase depois de tirar o que virou coluna.</summary>
    public static PhaseContent From(DraftPhaseDto phase) => new(
        phase.Question ?? string.Empty,
        phase.FromAI,
        phase.Options,
        phase.CorrectIndexes,
        phase.Words,
        phase.Blanks,
        phase.StarterCode,
        phase.TestCases,
        phase.ExpectedAnswer,
        string.IsNullOrWhiteSpace(phase.Theme) ? null : phase.Theme.Trim(),
        phase.ShowFeedbackAnimation,
        phase.IntroSeconds,
        phase.IntroTip?.Trim(),
        phase.IntroSound,
        phase.IntroShapes,
        phase.VariationSettings);

    public string ToJson() => JsonSerializer.Serialize(this, SerializerOptions);

    /// <summary>
    /// Conteudo vazio no lugar de excecao quando o JSON nao desserializa: uma linha corrompida
    /// (ou semeada a mao por um teste antigo) deve abrir o editor com a fase em branco para o
    /// autor reescrever, e nao derrubar a biblioteca inteira dele.
    /// </summary>
    public static PhaseContent Parse(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<PhaseContent>(json, SerializerOptions) ?? new PhaseContent();
        }
        catch (JsonException)
        {
            return new PhaseContent();
        }
    }
}
