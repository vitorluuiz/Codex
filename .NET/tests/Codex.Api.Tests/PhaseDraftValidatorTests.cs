using Codex.Api.Common.Errors;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Domain;
using Codex.Api.Services;
using Xunit;

namespace Codex.Api.Tests;

public class PhaseDraftValidatorTests
{
    [Fact]
    public void Disregards_empty_and_whitespace_options_in_quiz()
    {
        var phase = new DraftPhaseDto(
            Id: "draft_1",
            Kind: PhaseKind.Quiz,
            Name: "Teste Quiz",
            BasePoints: 100,
            PointsMultiplier: 1.0m,
            TimeSeconds: 30,
            FromAI: false,
            Question: "Qual é a cor?",
            Options: ["Azul", "   ", "", "Vermelho", null!, "Verde"],
            CorrectIndexes: [0, 1, 3, 5]
        );

        var sanitized = PhaseDraftValidator.SanitizePhase(phase);

        Assert.Equal(["Azul", "Vermelho", "Verde"], sanitized.Options);
        // Original: 0 -> Azul (0), 1 -> empty (dropped), 3 -> Vermelho (1), 5 -> Verde (2)
        Assert.Equal([0, 1, 2], sanitized.CorrectIndexes);
    }

    [Fact]
    public void Validate_succeeds_when_empty_options_are_filtered_and_at_least_two_remain()
    {
        var phase = new DraftPhaseDto(
            Id: "draft_1",
            Kind: PhaseKind.Quiz,
            Name: "Teste Quiz",
            BasePoints: 100,
            PointsMultiplier: 1.0m,
            TimeSeconds: 30,
            FromAI: false,
            Question: "Qual é a cor?",
            Options: ["Azul", "", "Vermelho"],
            CorrectIndexes: [0]
        );

        var result = PhaseDraftValidator.Validate([phase]);

        Assert.Single(result);
        Assert.Equal(["Azul", "Vermelho"], result[0].Options);
        Assert.Equal([0], result[0].CorrectIndexes);
    }

    [Fact]
    public void Validate_fails_when_all_options_are_marked_as_correct()
    {
        var phase = new DraftPhaseDto(
            Id: "draft_1",
            Kind: PhaseKind.Quiz,
            Name: "Teste Quiz",
            BasePoints: 100,
            PointsMultiplier: 1.0m,
            TimeSeconds: 30,
            FromAI: false,
            Question: "Pergunta",
            Options: ["A", "B"],
            CorrectIndexes: [0, 1]
        );

        var ex = Assert.Throws<ApiException>(() => PhaseDraftValidator.Validate([phase]));
        Assert.Equal(ErrorCodes.ValidationError, ex.Code);
        Assert.Contains("nao pode marcar todas as alternativas", ex.Message);
    }

    [Fact]
    public void Validate_fails_when_no_option_is_marked_as_correct()
    {
        var phase = new DraftPhaseDto(
            Id: "draft_1",
            Kind: PhaseKind.Quiz,
            Name: "Teste Quiz",
            BasePoints: 100,
            PointsMultiplier: 1.0m,
            TimeSeconds: 30,
            FromAI: false,
            Question: "Pergunta",
            Options: ["A", "B"],
            CorrectIndexes: []
        );

        var ex = Assert.Throws<ApiException>(() => PhaseDraftValidator.Validate([phase]));
        Assert.Equal(ErrorCodes.ValidationError, ex.Code);
        Assert.Contains("nao pode ser vazio", ex.Message);
    }

    [Fact]
    public void Validate_fails_when_question_exceeds_max_length()
    {
        var longQuestion = new string('x', PhaseLimits.MaxQuestionLength + 1);
        var phase = new DraftPhaseDto(
            Id: "draft_1",
            Kind: PhaseKind.Quiz,
            Name: "Teste Quiz",
            BasePoints: 100,
            PointsMultiplier: 1.0m,
            TimeSeconds: 30,
            FromAI: false,
            Question: longQuestion,
            Options: ["A", "B"],
            CorrectIndexes: [0]
        );

        var ex = Assert.Throws<ApiException>(() => PhaseDraftValidator.Validate([phase]));
        Assert.Equal(ErrorCodes.ValidationError, ex.Code);
        Assert.Contains("question deve ter no maximo", ex.Message);
    }

    [Fact]
    public void Validate_fails_when_option_exceeds_max_length()
    {
        var longOption = new string('x', PhaseLimits.MaxOptionLength + 1);
        var phase = new DraftPhaseDto(
            Id: "draft_1",
            Kind: PhaseKind.Quiz,
            Name: "Teste Quiz",
            BasePoints: 100,
            PointsMultiplier: 1.0m,
            TimeSeconds: 30,
            FromAI: false,
            Question: "Pergunta",
            Options: ["A", longOption],
            CorrectIndexes: [0]
        );

        var ex = Assert.Throws<ApiException>(() => PhaseDraftValidator.Validate([phase]));
        Assert.Equal(ErrorCodes.ValidationError, ex.Code);
        Assert.Contains("options aceita no maximo", ex.Message);
    }
}