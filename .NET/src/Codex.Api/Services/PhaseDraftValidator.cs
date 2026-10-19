using Codex.Api.Common.Errors;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Domain;

namespace Codex.Api.Services;

/// <summary>
/// As tres validacoes que o contrato manda o servidor repetir ("a UI ja impede, mas isso nao e
/// garantia") mais os limites de coluna e de sanidade numerica.
///
/// Extraido de <see cref="PhaseSetService"/> para que a geracao por IA valide a saida do modelo
/// exatamente pelas mesmas regras do salvamento do rascunho.
/// </summary>
public static class PhaseDraftValidator
{
    /// <summary>Igual ao HasMaxLength(160) de phase_sets.Title e phases.Name — cortar aqui devolve VALIDATION_ERROR em vez de estourar no INSERT.</summary>
    public const int MaxTitleLength = PhaseLimits.MaxNameLength;

    /// <summary>
    /// Nao vem do contrato: e sanidade. Um conjunto e o roteiro de uma aula, e a fila da sala
    /// aceita 8 deles — 50 fases por conjunto ja e mais do que qualquer aula real, e impede que um
    /// POST unico grave dezenas de milhares de linhas.
    /// </summary>
    public const int MaxPhasesPerSet = 50;

    /// <summary>Limites de alternativas num quiz — abaixo de 2 nao ha escolha, acima de 8 nao cabe na tela.</summary>
    public const int MinOptions = 2;
    public const int MaxOptions = 8;

    /// <summary>
    /// Valida a lista de fases de um conjunto no salvamento.
    ///
    /// <b>O que deliberadamente nao e validado: campo em branco.</b> Enunciado vazio, alternativa
    /// vazia, lacuna sem palavra escolhida — tudo isso passa. Isto e um <i>rascunho</i>: o editor
    /// cria a fase com enunciado vazio e o autor sai da tela no meio, e um conjunto que so pode
    /// ser salvo quando estiver perfeito e um conjunto que se perde. O que nao passa e o que e
    /// <i>contraditorio</i> — um quiz cuja resposta certa e "todas", um gabarito posicional com
    /// mais entradas do que lacunas —, porque isso nao e falta de conteudo, e conteudo que nao
    /// pode existir.
    /// </summary>
    public static IReadOnlyList<DraftPhaseDto> Validate(IReadOnlyList<DraftPhaseDto>? phases)
    {
        // Corpo sem "phases" vira conjunto sem fase — nao e erro: o editor salva o titulo antes de
        // escrever a primeira fase, e a biblioteca mostra "0 fases" sem problema.
        phases ??= [];

        if (phases.Count > MaxPhasesPerSet)
        {
            throw Validation($"um conjunto aceita no maximo {MaxPhasesPerSet} fases.");
        }

        for (var index = 0; index < phases.Count; index++)
        {
            Validate(phases[index], index);
        }

        return phases;
    }

    public static void Validate(DraftPhaseDto phase, int index)
    {
        var name = phase.Name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > MaxTitleLength)
        {
            throw Validation($"phases[{index}].name deve ter entre 1 e {MaxTitleLength} caracteres.");
        }

        if (phase.BasePoints is < 0 or > PhaseLimits.MaxBasePoints)
        {
            throw Validation($"phases[{index}].basePoints deve estar entre 0 e {PhaseLimits.MaxBasePoints}.");
        }

        if (phase.TimeSeconds is < PhaseLimits.MinTimeSeconds or > PhaseLimits.MaxTimeSeconds)
        {
            throw Validation($"phases[{index}].timeSeconds deve estar entre {PhaseLimits.MinTimeSeconds} e {PhaseLimits.MaxTimeSeconds}.");
        }

        if (phase.PointsMultiplier < PhaseLimits.MinPointsMultiplier || phase.PointsMultiplier > PhaseLimits.MaxPointsMultiplier)
        {
            throw Validation($"phases[{index}].pointsMultiplier deve estar entre {PhaseLimits.MinPointsMultiplier} e {PhaseLimits.MaxPointsMultiplier}.");
        }

        if (phase.Theme is { } rawTheme && rawTheme.Trim() is { Length: > 0 } theme && !PhaseLimits.AllowedThemes.Contains(theme))
        {
            throw Validation($"phases[{index}].theme invalido.");
        }

        if (phase.IntroSeconds is { } introSeconds && (introSeconds < PhaseLimits.MinIntroSeconds || introSeconds > PhaseLimits.MaxIntroSeconds))
        {
            throw Validation($"phases[{index}].introSeconds deve estar entre {PhaseLimits.MinIntroSeconds} e {PhaseLimits.MaxIntroSeconds}.");
        }

        if (PhaseLimits.ExceedsLength(phase.IntroTip, PhaseLimits.MaxIntroTipLength))
        {
            throw Validation($"phases[{index}].introTip deve ter no maximo {PhaseLimits.MaxIntroTipLength} caracteres.");
        }

        // Texto livre tem teto desde a migracao de dados: o conteudo da fase e copiado para a fila
        // da sala e, no fim da partida, para dentro de um documento do Mongo (teto rigido de
        // 16 MB) — passando antes pelo Redis, que tem maxmemory. O porque de cada numero esta em
        // PhaseLimits. Campo <i>vazio</i> continua valido: isto aqui e rascunho.
        if (PhaseLimits.ExceedsLength(phase.Question, PhaseLimits.MaxQuestionLength))
        {
            throw Validation($"phases[{index}].question deve ter no maximo {PhaseLimits.MaxQuestionLength} caracteres.");
        }

        switch (phase.Kind)
        {
            case PhaseKind.Quiz:
                ValidateQuiz(phase, index);
                break;

            case PhaseKind.Fill:
                ValidateFill(phase, index);
                break;

            case PhaseKind.Code:
                if (phase.StarterCode is null || phase.TestCases is null)
                {
                    throw Validation($"phases[{index}] do tipo code exige starterCode e testCases.");
                }

                if (PhaseLimits.ExceedsLength(phase.StarterCode, PhaseLimits.MaxStarterCodeLength))
                {
                    throw Validation($"phases[{index}].starterCode deve ter no maximo {PhaseLimits.MaxStarterCodeLength} caracteres.");
                }

                if (PhaseLimits.ExceedsLength(phase.TestCases, PhaseLimits.MaxTestCasesLength))
                {
                    throw Validation($"phases[{index}].testCases deve ter no maximo {PhaseLimits.MaxTestCasesLength} caracteres.");
                }

                break;

            case PhaseKind.Text:
                if (phase.ExpectedAnswer is null)
                {
                    throw Validation($"phases[{index}] do tipo text exige expectedAnswer.");
                }

                if (PhaseLimits.ExceedsLength(phase.ExpectedAnswer, PhaseLimits.MaxExpectedAnswerLength))
                {
                    throw Validation($"phases[{index}].expectedAnswer deve ter no maximo {PhaseLimits.MaxExpectedAnswerLength} caracteres.");
                }

                break;
        }
    }

    public static void ValidateQuiz(DraftPhaseDto phase, int index)
    {
        if (phase.Options is not { } options || phase.CorrectIndexes is not { } correct)
        {
            throw Validation($"phases[{index}] do tipo quiz exige options e correctIndexes.");
        }

        if (options.Count is < MinOptions or > MaxOptions)
        {
            throw Validation($"phases[{index}].options deve ter entre {MinOptions} e {MaxOptions} alternativas.");
        }

        if (options.Any(option => PhaseLimits.ExceedsLength(option, PhaseLimits.MaxOptionLength)))
        {
            throw Validation($"phases[{index}].options aceita no maximo {PhaseLimits.MaxOptionLength} caracteres por alternativa.");
        }

        if (correct.Count is 0)
        {
            throw Validation($"phases[{index}].correctIndexes nao pode ser vazio.");
        }

        if (correct.Any(i => i < 0 || i >= options.Count))
        {
            throw Validation($"phases[{index}].correctIndexes aponta para uma alternativa que nao existe.");
        }

        // Distintos antes de contar: [0,0,0] em quatro alternativas nao e "todas certas", e sem
        // isto passaria pela checagem de baixo por acidente de contagem.
        if (correct.Distinct().Count() != correct.Count)
        {
            throw Validation($"phases[{index}].correctIndexes tem indices repetidos.");
        }

        // "Nunca com todas as alternativas": uma pergunta em que qualquer clique acerta nao mede
        // nada, e o placar da partida contaria como acerto de todo mundo.
        if (correct.Count >= options.Count)
        {
            throw Validation($"phases[{index}].correctIndexes nao pode marcar todas as alternativas.");
        }
    }

    public static void ValidateFill(DraftPhaseDto phase, int index)
    {
        if (phase.Words is not { } words || phase.Blanks is not { } blanks)
        {
            throw Validation($"phases[{index}] do tipo fill exige words e blanks.");
        }

        if (words.Count > PhaseLimits.MaxWords)
        {
            throw Validation($"phases[{index}].words aceita no maximo {PhaseLimits.MaxWords} palavras.");
        }

        if (words.Any(word => PhaseLimits.ExceedsLength(word, PhaseLimits.MaxOptionLength)))
        {
            throw Validation($"phases[{index}].words aceita no maximo {PhaseLimits.MaxOptionLength} caracteres por palavra.");
        }

        // O gabarito e posicional: uma entrada por lacuna, na ordem. Com tamanho diferente do
        // enunciado, nao da para saber qual palavra pertence a qual lacuna — e o editor ja
        // sincroniza os dois a cada tecla (syncBlanks), entao divergir aqui e corpo montado a mao.
        var expected = PhaseContent.CountBlanks(phase.Question);
        if (blanks.Count != expected)
        {
            throw Validation($"phases[{index}].blanks deve ter uma entrada por lacuna do enunciado ({expected}).");
        }

        // Mesma familia do "todas as alternativas certas": uma lacuna cuja resposta nao esta no
        // banco de palavras e uma fase que ninguem consegue acertar. Lacuna ainda em branco
        // (null) continua valida — e so um rascunho pela metade.
        if (blanks.Any(blank => blank is not null && !words.Contains(blank)))
        {
            throw Validation($"phases[{index}].blanks usa uma palavra que nao esta em words.");
        }
    }

    private static ApiException Validation(string message)
        => new(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, message);
}
