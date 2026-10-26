using System.Text.Json;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Ai;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Domain;

namespace Codex.Api.Services.Ai;

/// <summary>
/// Converte e normaliza o JSON cru retornado pelo modelo em <see cref="DraftPhaseDto"/> ou
/// <see cref="QuizOptionSuggestionDto"/> antes de passar pelo <see cref="PhaseDraftValidator"/>.
/// </summary>
public static class AiPhaseMapper
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public static DraftPhaseDto MapAndValidatePhase(
        string rawJson,
        PhaseKind kind,
        DraftPhaseDto? settingsSource = null,
        bool keepSettings = false)
    {
        RawAiPhase raw;
        try
        {
            raw = JsonSerializer.Deserialize<RawAiPhase>(rawJson, JsonOptions)
                  ?? throw InvalidFormat("O modelo retornou um JSON nulo.");
        }
        catch (JsonException ex)
        {
            throw InvalidFormat($"O modelo retornou um JSON invalido: {ex.Message}");
        }

        return NormalizeAndValidate(raw, kind, settingsSource, keepSettings);
    }

    public static (IReadOnlyList<DraftPhaseDto> Phases, int Discarded) MapAndValidateVariations(
        string rawJson,
        DraftPhaseDto source,
        AiVariationOptions options)
    {
        RawAiVariationsEnvelope envelope;
        try
        {
            envelope = JsonSerializer.Deserialize<RawAiVariationsEnvelope>(rawJson, JsonOptions)
                       ?? throw InvalidFormat("O modelo retornou um JSON nulo para variacoes.");
        }
        catch (JsonException ex)
        {
            throw InvalidFormat($"O modelo retornou um JSON invalido para variacoes: {ex.Message}");
        }

        if (envelope.Phases is not { Count: > 0 })
        {
            throw InvalidFormat("O modelo nao retornou nenhuma variacao em 'phases'.");
        }

        var maxCount = Math.Clamp(options.Count, 1, 5);
        var valid = new List<DraftPhaseDto>(maxCount);
        var discarded = 0;

        foreach (var raw in envelope.Phases.Take(maxCount))
        {
            try
            {
                var dto = NormalizeAndValidate(raw, source.Kind, source, options.KeepSettings);
                valid.Add(dto);
            }
            catch (ApiException)
            {
                discarded++;
            }
        }

        if (valid.Count == 0)
        {
            throw InvalidFormat("Nenhuma das variacoes retornadas pelo modelo passou na validacao.");
        }

        return (valid, discarded);
    }

    public static IReadOnlyList<QuizOptionSuggestionDto> MapAndValidateQuizOptions(
        string rawJson,
        SuggestQuizOptionsRequest request)
    {
        RawAiQuizOptionsEnvelope envelope;
        try
        {
            envelope = JsonSerializer.Deserialize<RawAiQuizOptionsEnvelope>(rawJson, JsonOptions)
                       ?? throw InvalidFormat("O modelo retornou um JSON nulo para sugestoes.");
        }
        catch (JsonException ex)
        {
            throw InvalidFormat($"O modelo retornou um JSON invalido para sugestoes: {ex.Message}");
        }

        if (envelope.Suggestions is not { Count: > 0 })
        {
            throw InvalidFormat("O modelo nao retornou nenhuma sugestao de alternativa.");
        }

        var existingSet = new HashSet<string>(
            (request.Options ?? [])
                .Where(o => !string.IsNullOrWhiteSpace(o))
                .Select(o => o.Trim()),
            StringComparer.OrdinalIgnoreCase);

        var maxCount = Math.Clamp(request.Count, 1, 6);
        var results = new List<QuizOptionSuggestionDto>(maxCount);

        foreach (var item in envelope.Suggestions)
        {
            var label = Truncate(item.Label?.Trim(), PhaseLimits.MaxOptionLength);
            if (string.IsNullOrWhiteSpace(label))
            {
                continue;
            }

            if (!existingSet.Add(label))
            {
                continue;
            }

            var isCorrect = request.Mode switch
            {
                QuizSuggestionMode.Distractors => false,
                QuizSuggestionMode.Correct => true,
                _ => item.IsCorrect ?? false,
            };

            var rationale = Truncate(item.Rationale?.Trim(), 120);
            if (string.IsNullOrWhiteSpace(rationale))
            {
                rationale = null;
            }

            results.Add(new QuizOptionSuggestionDto(label, isCorrect, rationale));
            if (results.Count >= maxCount)
            {
                break;
            }
        }

        if (results.Count == 0)
        {
            throw InvalidFormat("Todas as sugestoes retornadas pelo modelo estavam vazias ou duplicadas.");
        }

        return results;
    }

    private static DraftPhaseDto NormalizeAndValidate(
        RawAiPhase raw,
        PhaseKind kind,
        DraftPhaseDto? settingsSource,
        bool keepSettings)
    {
        var question = Truncate(raw.Question?.Trim(), PhaseLimits.MaxQuestionLength) ?? string.Empty;
        if (string.IsNullOrWhiteSpace(question))
        {
            throw InvalidFormat("O modelo retornou uma fase com enunciado vazio.");
        }

        var name = Truncate(raw.Name?.Trim(), PhaseLimits.MaxNameLength);
        if (string.IsNullOrWhiteSpace(name))
        {
            name = Truncate(question, 48) ?? "Fase gerada";
        }

        var defaultPoints = settingsSource?.BasePoints ?? 100;
        var defaultTime = settingsSource?.TimeSeconds ?? (kind switch
        {
            PhaseKind.Quiz => 45,
            PhaseKind.Fill => 60,
            PhaseKind.Text => 90,
            PhaseKind.Code => 180,
            _ => 45,
        });

        int basePoints;
        int timeSeconds;
        decimal pointsMultiplier;
        string? theme;
        int? introSeconds;

        if (keepSettings && settingsSource is not null)
        {
            basePoints = Math.Clamp(settingsSource.BasePoints, 0, PhaseLimits.MaxBasePoints);
            timeSeconds = Math.Clamp(settingsSource.TimeSeconds, PhaseLimits.MinTimeSeconds, PhaseLimits.MaxTimeSeconds);
            pointsMultiplier = PhaseLimits.RoundMultiplier(
                Math.Clamp(settingsSource.PointsMultiplier, PhaseLimits.MinPointsMultiplier, PhaseLimits.MaxPointsMultiplier));
            theme = settingsSource.Theme;
            introSeconds = settingsSource.IntroSeconds;
        }
        else
        {
            basePoints = raw.BasePoints is > 0
                ? Math.Clamp(raw.BasePoints.Value, 0, PhaseLimits.MaxBasePoints)
                : defaultPoints;
            timeSeconds = raw.TimeSeconds is > 0
                ? Math.Clamp(raw.TimeSeconds.Value, PhaseLimits.MinTimeSeconds, PhaseLimits.MaxTimeSeconds)
                : defaultTime;
            var rawMult = raw.PointsMultiplier ?? 1.0m;
            pointsMultiplier = PhaseLimits.RoundMultiplier(
                Math.Clamp(rawMult, PhaseLimits.MinPointsMultiplier, PhaseLimits.MaxPointsMultiplier));
            theme = settingsSource?.Theme ?? "default";
            introSeconds = settingsSource?.IntroSeconds;
        }

        var introTip = Truncate(raw.IntroTip?.Trim(), PhaseLimits.MaxIntroTipLength);
        if (string.IsNullOrWhiteSpace(introTip))
        {
            introTip = null;
        }

        IReadOnlyList<string>? options = null;
        IReadOnlyList<int>? correctIndexes = null;
        IReadOnlyList<string>? words = null;
        IReadOnlyList<string?>? blanks = null;
        string? starterCode = null;
        string? testCases = null;
        string? expectedAnswer = null;

        switch (kind)
        {
            case PhaseKind.Quiz:
                (options, correctIndexes) = NormalizeQuiz(raw.Options, raw.CorrectIndexes);
                break;

            case PhaseKind.Fill:
                (words, blanks) = NormalizeFill(question, raw.Words, raw.Blanks);
                break;

            case PhaseKind.Text:
                expectedAnswer = Truncate(raw.ExpectedAnswer?.Trim(), PhaseLimits.MaxExpectedAnswerLength) ?? string.Empty;
                if (string.IsNullOrWhiteSpace(expectedAnswer))
                {
                    throw InvalidFormat("O modelo retornou uma fase do tipo text sem expectedAnswer.");
                }
                break;

            case PhaseKind.Code:
                starterCode = Truncate(raw.StarterCode?.Trim(), PhaseLimits.MaxStarterCodeLength) ?? string.Empty;
                if (string.IsNullOrWhiteSpace(starterCode))
                {
                    throw InvalidFormat("O modelo retornou uma fase do tipo code sem starterCode.");
                }
                testCases = string.Empty;
                break;
        }

        var dto = new DraftPhaseDto(
            Id: $"ai-{Guid.NewGuid():N}",
            Kind: kind,
            Name: name,
            Question: question,
            BasePoints: basePoints,
            TimeSeconds: timeSeconds,
            PointsMultiplier: pointsMultiplier,
            FromAI: true,
            Theme: theme,
            IntroSeconds: introSeconds,
            IntroTip: introTip,
            Options: options,
            CorrectIndexes: correctIndexes,
            Words: words,
            Blanks: blanks,
            StarterCode: starterCode,
            TestCases: testCases,
            ExpectedAnswer: expectedAnswer);

        PhaseDraftValidator.Validate(dto, 0);
        return dto;
    }

    private static (IReadOnlyList<string> Options, IReadOnlyList<int> CorrectIndexes) NormalizeQuiz(
        List<string?>? rawOptions,
        List<int>? rawCorrect)
    {
        if (rawOptions is null || rawCorrect is null)
        {
            throw InvalidFormat("Fase quiz gerada sem options ou correctIndexes.");
        }

        var rawCorrectSet = rawCorrect.ToHashSet();
        var cleanedOptions = new List<string>();
        var cleanedCorrect = new HashSet<int>();
        var indexByText = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        for (var i = 0; i < rawOptions.Count; i++)
        {
            var text = Truncate(rawOptions[i]?.Trim(), PhaseLimits.MaxOptionLength);
            if (string.IsNullOrWhiteSpace(text))
            {
                continue;
            }

            if (indexByText.TryGetValue(text, out var existingIndex))
            {
                if (rawCorrectSet.Contains(i))
                {
                    cleanedCorrect.Add(existingIndex);
                }
                continue;
            }

            if (cleanedOptions.Count >= PhaseDraftValidator.MaxOptions)
            {
                continue;
            }

            var newIndex = cleanedOptions.Count;
            cleanedOptions.Add(text);
            indexByText[text] = newIndex;

            if (rawCorrectSet.Contains(i))
            {
                cleanedCorrect.Add(newIndex);
            }
        }

        return (cleanedOptions, cleanedCorrect.OrderBy(i => i).ToList());
    }

    private static (IReadOnlyList<string> Words, IReadOnlyList<string?> Blanks) NormalizeFill(
        string question,
        List<string?>? rawWords,
        List<string?>? rawBlanks)
    {
        var expectedBlankCount = PhaseContent.CountBlanks(question);
        if (expectedBlankCount <= 0)
        {
            throw InvalidFormat("Fase fill gerada sem marcadores de lacuna '___' no enunciado.");
        }

        if (rawBlanks is null)
        {
            throw InvalidFormat("Fase fill gerada sem lista de blanks.");
        }

        var cleanedBlanks = rawBlanks
            .Select(b => Truncate(b?.Trim(), PhaseLimits.MaxOptionLength))
            .ToList();

        if (cleanedBlanks.Any(string.IsNullOrWhiteSpace))
        {
            throw InvalidFormat("Fase fill gerada com lacuna vazia em blanks.");
        }

        var wordList = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // Garante primeiro que todas as palavras usadas nas lacunas estao no banco de palavras
        foreach (var blank in cleanedBlanks)
        {
            if (!string.IsNullOrWhiteSpace(blank) && seen.Add(blank))
            {
                wordList.Add(blank);
            }
            else if (!string.IsNullOrWhiteSpace(blank))
            {
                // Alinha a grafia do blank com a palavra ja presente no banco (caso difira por maiuscula/minuscula)
                var canonical = wordList.First(w => string.Equals(w, blank, StringComparison.OrdinalIgnoreCase));
                for (var i = 0; i < cleanedBlanks.Count; i++)
                {
                    if (string.Equals(cleanedBlanks[i], blank, StringComparison.OrdinalIgnoreCase))
                    {
                        cleanedBlanks[i] = canonical;
                    }
                }
            }
        }

        if (rawWords is not null)
        {
            foreach (var rawWord in rawWords)
            {
                if (wordList.Count >= PhaseLimits.MaxWords)
                {
                    break;
                }

                var word = Truncate(rawWord?.Trim(), PhaseLimits.MaxOptionLength);
                if (!string.IsNullOrWhiteSpace(word) && seen.Add(word))
                {
                    wordList.Add(word);
                }
            }
        }

        return (wordList, cleanedBlanks!);
    }

    private static string? Truncate(string? value, int maxLength)
    {
        if (value is null)
        {
            return null;
        }

        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private static ApiException InvalidFormat(string detail) => new(
        StatusCodes.Status502BadGateway,
        ErrorCodes.AiInvalidOutput,
        detail);

    private sealed class RawAiPhase
    {
        public string? Name { get; set; }
        public string? Question { get; set; }
        public int? BasePoints { get; set; }
        public int? TimeSeconds { get; set; }
        public decimal? PointsMultiplier { get; set; }
        public string? IntroTip { get; set; }
        public List<string?>? Options { get; set; }
        public List<int>? CorrectIndexes { get; set; }
        public List<string?>? Words { get; set; }
        public List<string?>? Blanks { get; set; }
        public string? StarterCode { get; set; }
        public string? ExpectedAnswer { get; set; }
    }

    private sealed class RawAiVariationsEnvelope
    {
        public List<RawAiPhase>? Phases { get; set; }
    }

    private sealed class RawAiQuizOptionsEnvelope
    {
        public List<RawAiQuizSuggestion>? Suggestions { get; set; }
    }

    private sealed class RawAiQuizSuggestion
    {
        public string? Label { get; set; }
        public bool? IsCorrect { get; set; }
        public string? Rationale { get; set; }
    }
}
