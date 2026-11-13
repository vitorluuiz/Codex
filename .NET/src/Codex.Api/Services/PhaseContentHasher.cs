using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Codex.Api.Documents;
using Codex.Api.Domain;

namespace Codex.Api.Services;

/// <summary>
/// Calcula o hash SHA-256 canônico do conteúdo de um desafio para deduplicação na publicação
/// e faz a conversão entre <see cref="PhaseContent"/> e <see cref="PhaseContentDocument"/>.
/// </summary>
public static class PhaseContentHasher
{
    private const int MaxQuestionPreviewLength = 300;

    private static readonly JsonSerializerOptions CanonicalJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private sealed record CanonicalPayload(
        PhaseKind Kind,
        string Name,
        int BasePoints,
        decimal PointsMultiplier,
        int TimeSeconds,
        string? Question,
        IReadOnlyList<string>? Options,
        IReadOnlyList<int>? CorrectIndexes,
        IReadOnlyList<string>? Words,
        IReadOnlyList<string?>? Blanks,
        string? StarterCode,
        string? TestCases,
        string? ExpectedAnswer);

    public static string Compute(
        PhaseKind kind,
        string name,
        int basePoints,
        decimal pointsMultiplier,
        int timeSeconds,
        PhaseContent content)
    {
        var payload = new CanonicalPayload(
            kind,
            name.Trim(),
            basePoints,
            PhaseLimits.RoundMultiplier(pointsMultiplier),
            timeSeconds,
            content.Question,
            content.Options,
            content.CorrectIndexes,
            content.Words,
            content.Blanks,
            content.StarterCode,
            content.TestCases,
            content.ExpectedAnswer);

        var json = JsonSerializer.Serialize(payload, CanonicalJsonOptions);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
    }

    public static string BuildQuestionPreview(string? question)
    {
        if (string.IsNullOrWhiteSpace(question))
        {
            return string.Empty;
        }

        var trimmed = question.Trim();
        return trimmed.Length <= MaxQuestionPreviewLength
            ? trimmed
            : trimmed[..MaxQuestionPreviewLength];
    }

    public static PhaseContentDocument FromContent(PhaseContent content) => new()
    {
        Question = content.Question,
        FromAI = content.FromAI,
        Options = content.Options,
        CorrectIndexes = content.CorrectIndexes,
        Words = content.Words,
        Blanks = content.Blanks,
        StarterCode = content.StarterCode,
        TestCases = content.TestCases,
        ExpectedAnswer = content.ExpectedAnswer,
        Theme = content.Theme,
        ShowFeedbackAnimation = content.ShowFeedbackAnimation,
        IntroSeconds = content.IntroSeconds,
        IntroTip = content.IntroTip,
        IntroSound = content.IntroSound,
        IntroShapes = content.IntroShapes,
        VariationSettings = content.VariationSettings,
    };

    public static PhaseContent ToContent(PhaseContentDocument doc) => new(
        Question: doc.Question,
        FromAI: doc.FromAI,
        Options: doc.Options,
        CorrectIndexes: doc.CorrectIndexes,
        Words: doc.Words,
        Blanks: doc.Blanks,
        StarterCode: doc.StarterCode,
        TestCases: doc.TestCases,
        ExpectedAnswer: doc.ExpectedAnswer,
        Theme: doc.Theme,
        ShowFeedbackAnimation: doc.ShowFeedbackAnimation,
        IntroSeconds: doc.IntroSeconds,
        IntroTip: doc.IntroTip,
        IntroSound: doc.IntroSound,
        IntroShapes: doc.IntroShapes,
        VariationSettings: doc.VariationSettings);
}
