using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Matches;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;

namespace Codex.Api.Services;

/// <summary>
/// A correcao de uma resposta e a pontuacao dela (secao 8), mais o portao que cobra fase completa
/// no inicio da partida (secao 7).
///
/// Estatico e sem dependencia de banco de proposito: e a parte da partida que nao le nada — recebe a
/// fase copiada na fila, a resposta e o relogio, e devolve nota. Isso e o que a deixa testavel caso
/// a caso sem montar sala, participante e submissao.
///
/// <b>Le <c>correctIndexes</c>, nunca <c>correctOptionId</c>.</b> O editor aceita mais de uma
/// alternativa certa e o contrato so tem lugar para uma, entao <see cref="PhaseProjection"/> emite a
/// primeira — o que serve a <i>tela</i>. Corrigir por ali reprovaria quem marcou a segunda resposta
/// certa (api-queue-log.md §4). Esta e a razao de a correcao nao reusar o <c>PhaseDto</c>.
/// </summary>
public static class PhaseGrading
{
    /// <summary>Piso do bonus de tempo: responder no ultimo segundo ainda vale metade dos pontos.</summary>
    private const decimal MinimumTimeBonus = 0.5m;

    /// <summary>
    /// Recusa a fase que nao tem gabarito utilizavel, com <c>409 INCOMPLETE_PHASE</c>.
    ///
    /// <b>Por que aqui, e nao na correcao.</b> A secao 5 deixa salvar rascunho incompleto de
    /// proposito ("enunciado vazio e lacuna sem palavra passam — e um rascunho"), e
    /// api-phases-log.md ja registrava que "quem deveria cobrar fase completa e o inicio da
    /// partida". Sem este portao, a correcao precisaria de uma regra para gabarito vazio em cada
    /// tipo, e as tres respostas possiveis (reprovar todo mundo, aprovar todo mundo, ignorar a fase)
    /// sao erradas de jeitos diferentes. Com ele, a correcao assume gabarito presente.
    /// </summary>
    public static void EnsureComplete(RoomQueuePhase phase)
    {
        var content = PhaseContent.Parse(phase.ContentJson);

        if (string.IsNullOrWhiteSpace(content.Question))
        {
            throw Incomplete(phase, "esta sem enunciado");
        }

        switch (phase.Kind)
        {
            case PhaseKind.Quiz:
                var options = content.Options ?? [];
                if (options.Count < 2)
                {
                    throw Incomplete(phase, "precisa de pelo menos duas alternativas");
                }

                var correct = content.CorrectIndexes ?? [];
                if (correct.Count is 0 || correct.Any(index => index < 0 || index >= options.Count))
                {
                    throw Incomplete(phase, "esta sem alternativa correta marcada");
                }

                break;

            case PhaseKind.Fill:
                var blankCount = PhaseContent.CountBlanks(content.Question);
                if (blankCount is 0)
                {
                    throw Incomplete(phase, "nao tem nenhuma lacuna no enunciado");
                }

                var blanks = content.Blanks ?? [];
                if (blanks.Count != blankCount || blanks.Any(string.IsNullOrWhiteSpace))
                {
                    throw Incomplete(phase, "tem lacuna sem palavra definida");
                }

                break;

            case PhaseKind.Text:
                if (string.IsNullOrWhiteSpace(content.ExpectedAnswer))
                {
                    throw Incomplete(phase, "esta sem resposta esperada");
                }

                break;

            case PhaseKind.Code:
                // Para `code` o gabarito nao e `expectedAnswer` — quem corrige sao os testes, e sao
                // eles tambem que viram os exemplos da tela (PhaseProjection.ParseExamples). Uma fase
                // de codigo sem caso nenhum mostra ao aluno um enunciado sem exemplo e nao tem como
                // ser corrigida nem quando o sandbox existir.
                if (string.IsNullOrWhiteSpace(content.TestCases))
                {
                    throw Incomplete(phase, "esta sem casos de teste");
                }

                break;
        }
    }

    /// <summary>
    /// Confere que a resposta descreve de fato uma resposta para <i>esta</i> fase. Tudo aqui e
    /// <c>400 VALIDATION_ERROR</c>: sao corpos que o front tipado nao produz.
    /// </summary>
    public static AnswerDto Validate(RoomQueuePhase phase, AnswerDto? answer)
    {
        if (answer is null)
        {
            throw Validation("answer e obrigatorio.");
        }

        var expectedKind = KindName(phase.Kind);
        if (!string.Equals(answer.Kind, expectedKind, StringComparison.Ordinal))
        {
            throw Validation($"answer.kind deve ser \"{expectedKind}\" nesta fase.");
        }

        var content = PhaseContent.Parse(phase.ContentJson);

        switch (phase.Kind)
        {
            case PhaseKind.Quiz:
                var options = content.Options ?? [];
                if (OptionIndex(answer.OptionId) is not { } index || index >= options.Count)
                {
                    throw Validation("answer.optionId nao e uma alternativa desta fase.");
                }

                break;

            case PhaseKind.Fill:
                var blankCount = PhaseContent.CountBlanks(content.Question);
                if (answer.Blanks is not { } blanks || blanks.Count != blankCount)
                {
                    throw Validation($"answer.blanks deve ter exatamente {blankCount} posicoes.");
                }

                break;

            case PhaseKind.Text:
                if (string.IsNullOrWhiteSpace(answer.Value))
                {
                    throw Validation("answer.value nao pode ser vazio.");
                }

                break;

            case PhaseKind.Code:
                // So a linguagem habilitada e aceita: as outras aparecem "Em breve" na tela, e
                // aceitar codigo numa delas seria a promessa de executa-lo.
                var enabled = PhaseProjection.Languages.Where(l => l.Enabled).Select(l => l.Id);
                if (answer.LanguageId is null || !enabled.Contains(answer.LanguageId))
                {
                    throw Validation("answer.languageId nao e uma linguagem habilitada nesta fase.");
                }

                if (string.IsNullOrWhiteSpace(answer.Source))
                {
                    throw Validation("answer.source nao pode ser vazio.");
                }

                break;
        }

        return answer;
    }

    /// <summary>
    /// A nota. <paramref name="secondsRemaining"/> vem do <c>endsAt</c> menos o instante do envio —
    /// e nao de <c>timeSeconds - elapsedSeconds</c> —, para uma pausa no meio da fase nao comer o
    /// bonus de tempo de ninguem.
    /// </summary>
    public static GradingOutcome Grade(RoomQueuePhase phase, AnswerDto answer, int secondsRemaining)
    {
        var content = PhaseContent.Parse(phase.ContentJson);

        // "text e code dependem de IA / execucao de testes -> voltam com grading: pending" (secao 8).
        // Nao ha corretor para nenhum dos dois ainda, entao o pendente e permanente por enquanto —
        // e e exatamente o estado que o contrato descreve, com a tela mostrando "sua resposta esta
        // sendo avaliada".
        if (phase.Kind is PhaseKind.Text or PhaseKind.Code)
        {
            return new GradingOutcome(GradingStatus.Pending, null, null);
        }

        var correct = phase.Kind switch
        {
            PhaseKind.Quiz => IsQuizCorrect(content, answer),
            PhaseKind.Fill => IsFillCorrect(content, answer),
            _ => false,
        };

        return new GradingOutcome(GradingStatus.Graded, correct, Score(phase, correct ? 1m : 0m, secondsRemaining));
    }

    /// <summary>
    /// <c>score = round(basePoints × pointsMultiplier × acerto × bonusDeTempo)</c>, a formula da
    /// secao 8.
    ///
    /// Tudo em <c>decimal</c>: <c>pointsMultiplier</c> ja e decimal no banco, e fazer a conta em
    /// <c>double</c> daria pontuacoes que diferem por 1 entre dois alunos com a mesma resposta.
    /// <c>AwayFromZero</c> porque o arredondamento bancario padrao do .NET deixaria 150,5 virar 150 —
    /// e a tela mostra pontuacao inteira, entao a diferenca aparece.
    /// </summary>
    public static int Score(RoomQueuePhase phase, decimal accuracy, int secondsRemaining)
    {
        if (accuracy <= 0m)
        {
            return 0;
        }

        var timeSeconds = Math.Max(phase.TimeSeconds, 1);
        var remaining = Math.Clamp(secondsRemaining, 0, timeSeconds);
        var timeBonus = MinimumTimeBonus + (MinimumTimeBonus * remaining / timeSeconds);

        var score = phase.BasePoints * phase.PointsMultiplier * accuracy * timeBonus;
        return (int)decimal.Round(score, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// A resposta certa em texto, para o <c>correctAnswerLabel</c> do <c>comparison</c> — o unico
    /// lugar por onde o gabarito chega ao aluno, e so depois de a fase fechar.
    ///
    /// <c>code</c> devolve <c>null</c>: nao ha "a resposta certa" de um desafio de codigo, e o
    /// contrato tipa o campo como anulavel justamente por isso.
    /// </summary>
    public static string? CorrectAnswerLabel(RoomQueuePhase phase)
    {
        var content = PhaseContent.Parse(phase.ContentJson);

        return phase.Kind switch
        {
            // Todas as alternativas certas, e nao so a primeira: aqui nao ha o campo singular do
            // contrato limitando, e mostrar uma so mentiria para quem marcou a outra.
            PhaseKind.Quiz => string.Join(" / ", CorrectOptions(content)),
            PhaseKind.Fill => string.Join(" / ", (content.Blanks ?? []).Select(b => b ?? string.Empty)),
            PhaseKind.Text => content.ExpectedAnswer,
            _ => null,
        };
    }

    /// <summary>As alternativas marcadas como certas, na ordem em que aparecem na fase.</summary>
    public static IReadOnlyList<string> CorrectOptions(PhaseContent content)
    {
        var options = content.Options ?? [];
        return [.. (content.CorrectIndexes ?? [])
            .Where(index => index >= 0 && index < options.Count)
            .OrderBy(index => index)
            .Select(index => options[index])];
    }

    /// <summary>O indice por tras de um id posicional de alternativa ("o1" → 0), ou nulo.</summary>
    public static int? OptionIndex(string? optionId)
    {
        if (optionId is not { Length: > 1 } || optionId[0] is not 'o')
        {
            return null;
        }

        return int.TryParse(optionId[1..], out var position) && position > 0 ? position - 1 : null;
    }

    /// <summary>O nome do <c>kind</c> como ele viaja no JSON (camelCase, como todo enum do contrato).</summary>
    public static string KindName(PhaseKind kind) => kind switch
    {
        PhaseKind.Quiz => "quiz",
        PhaseKind.Fill => "fill",
        PhaseKind.Text => "text",
        _ => "code",
    };

    private static bool IsQuizCorrect(PhaseContent content, AnswerDto answer)
        => OptionIndex(answer.OptionId) is { } index && (content.CorrectIndexes ?? []).Contains(index);

    /// <summary>
    /// Todas as lacunas certas, ou nenhum ponto: "acerto ∈ [0,1] — 1/0 em quiz e fill" (secao 8).
    /// Nota parcial por lacuna e uma melhoria obvia e uma mudanca de contrato; nao e improviso desta
    /// camada.
    ///
    /// A comparacao ignora caixa e espaco em volta. Nao ignora acento, e nao precisa: as palavras
    /// vem de um banco (<c>words</c>) que o aluno seleciona, ele nao as digita.
    /// </summary>
    private static bool IsFillCorrect(PhaseContent content, AnswerDto answer)
    {
        var expected = content.Blanks ?? [];
        var given = answer.Blanks ?? [];

        if (given.Count != expected.Count)
        {
            return false;
        }

        return !expected.Where((word, index) => !Matches(word, given[index])).Any();
    }

    private static bool Matches(string? expected, string? given)
        => string.Equals((expected ?? string.Empty).Trim(), (given ?? string.Empty).Trim(), StringComparison.OrdinalIgnoreCase);

    private static ApiException Incomplete(RoomQueuePhase phase, string problem)
        => new(StatusCodes.Status409Conflict, ErrorCodes.IncompletePhase, $"A fase \"{phase.Name}\" {problem}.");

    private static ApiException Validation(string message)
        => new(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, message);
}

/// <summary>O que a correcao decidiu. <c>Correct</c> e <c>Score</c> sao nulos enquanto pendente.</summary>
public record GradingOutcome(GradingStatus Grading, bool? Correct, int? Score);
