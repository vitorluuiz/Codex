using System.Text.Json;
using Codex.Api.Common.Json;
using Codex.Api.Contracts.Phases;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;

namespace Codex.Api.Tests;

/// <summary>
/// A conversao "o que esta gravado" → "o que a partida consome". Alimenta o
/// <c>GET /rooms/{code}/queue/phases/{phaseId}</c> (secao 6) e vai alimentar o
/// <c>current-phase</c> da secao 7 — por isso os testes sao sobre a conversao, e nao sobre a rota.
/// </summary>
public class PhaseProjectionTests
{
    private static RoomQueuePhase Queued(PhaseKind kind, PhaseContent content, string name = "Frações equivalentes") => new()
    {
        RoomId = Guid.CreateVersion7(),
        RoomQueueSetId = Guid.CreateVersion7(),
        Kind = kind,
        Name = name,
        BasePoints = 100,
        PointsMultiplier = 1.5m,
        TimeSeconds = 45,
        ContentJson = content.ToJson(),
    };

    /* ------------------------------------------------------------------------- quiz */

    [Fact]
    public void Quiz_options_get_positional_ids()
    {
        var phase = Queued(PhaseKind.Quiz, new PhaseContent(
            Question: "Qual fração abaixo é equivalente a 2/3?",
            Options: ["4/6", "3/4", "5/9", "6/8"],
            CorrectIndexes: [0]));

        var dto = PhaseProjection.ToPhase(phase, includeAnswers: true);

        Assert.Equal(["o1", "o2", "o3", "o4"], dto.Options!.Select(o => o.Id));
        Assert.Equal(["4/6", "3/4", "5/9", "6/8"], dto.Options!.Select(o => o.Label));
        Assert.Equal("o1", dto.CorrectOptionId);
    }

    /// <summary>A regra de ouro da secao 7, exercida aqui porque e aqui que o gabarito e (ou nao) montado.</summary>
    [Fact]
    public void Quiz_answer_stays_out_when_answers_are_not_included()
    {
        var phase = Queued(PhaseKind.Quiz, new PhaseContent(
            Question: "Qual fração abaixo é equivalente a 2/3?",
            Options: ["4/6", "3/4"],
            CorrectIndexes: [0]));

        var dto = PhaseProjection.ToPhase(phase, includeAnswers: false);

        Assert.Null(dto.CorrectOptionId);
        Assert.Equal(2, dto.Options!.Count);
    }

    /// <summary>
    /// O editor aceita mais de uma alternativa certa e o contrato so tem `correctOptionId`,
    /// singular. Sai a primeira — perda conhecida, registrada em api-queue-log.md §4.
    /// </summary>
    [Fact]
    public void Multiple_correct_indexes_collapse_to_the_first_option_id()
    {
        var phase = Queued(PhaseKind.Quiz, new PhaseContent(
            Options: ["a", "b", "c", "d"],
            CorrectIndexes: [2, 1]));

        var dto = PhaseProjection.ToPhase(phase, includeAnswers: true);

        Assert.Equal("o2", dto.CorrectOptionId);
    }

    /* ------------------------------------------------------------------------- fill */

    [Fact]
    public void Fill_question_is_broken_into_segments()
    {
        var phase = Queued(PhaseKind.Fill, new PhaseContent(
            Question: "Ao ___ os termos, a ___ se mantém.",
            Words: ["multiplicar", "somar", "proporção"],
            Blanks: ["multiplicar", "proporção"]));

        var dto = PhaseProjection.ToPhase(phase, includeAnswers: true);

        Assert.Equal(
            [("text", "Ao"), ("blank", null), ("text", "os termos, a"), ("blank", null), ("text", "se mantém.")],
            dto.Segments!.Select(s => (s.Type, s.Value)));
        Assert.Equal([0, 1], dto.Segments!.Where(s => s.Type is "blank").Select(s => s.Index));
        Assert.Equal(["multiplicar", "proporção"], dto.CorrectWords);
    }

    /// <summary>
    /// Mesma varredura de PhaseContent.CountBlanks — se as duas discordassem, o gabarito posicional
    /// deixaria de corresponder as lacunas da tela.
    /// </summary>
    [Fact]
    public void Segment_blanks_are_counted_the_same_way_the_editor_validates_them()
    {
        const string question = "Uma ___ é PALAVRA quando ____ os termos.";

        var segments = PhaseProjection.SplitSegments(question);

        Assert.Equal(PhaseContent.CountBlanks(question), segments.Count(s => s.Type is "blank"));
    }

    [Fact]
    public void Question_that_starts_or_ends_with_a_blank_has_no_empty_text_segment()
    {
        var segments = PhaseProjection.SplitSegments("___ e ___");

        Assert.Equal(["blank", "text", "blank"], segments.Select(s => s.Type));
    }

    /// <summary>Lacuna ainda em branco vira "" e nao some: sumindo, a segunda palavra responderia pela primeira lacuna.</summary>
    [Fact]
    public void Unfilled_blank_keeps_its_position_in_correct_words()
    {
        var phase = Queued(PhaseKind.Fill, new PhaseContent(
            Question: "Ao ___ os termos, a ___ se mantém.",
            Words: ["multiplicar"],
            Blanks: [null, "proporção"]));

        var dto = PhaseProjection.ToPhase(phase, includeAnswers: true);

        Assert.Equal(["", "proporção"], dto.CorrectWords);
    }

    [Fact]
    public void Fill_answer_stays_out_when_answers_are_not_included()
    {
        var phase = Queued(PhaseKind.Fill, new PhaseContent(
            Question: "Ao ___ os termos.",
            Words: ["multiplicar", "somar"],
            Blanks: ["multiplicar"]));

        var dto = PhaseProjection.ToPhase(phase, includeAnswers: false);

        Assert.Null(dto.CorrectWords);
        Assert.Equal(["multiplicar", "somar"], dto.Words);
    }

    /* ------------------------------------------------------------------- text e code */

    [Fact]
    public void Text_carries_question_and_expected_answer()
    {
        var phase = Queued(PhaseKind.Text, new PhaseContent(
            Question: "Explique com suas palavras.",
            ExpectedAnswer: "Duas frações são equivalentes quando…"));

        Assert.Equal("Duas frações são equivalentes quando…", PhaseProjection.ToPhase(phase, includeAnswers: true).ExpectedAnswer);
        Assert.Null(PhaseProjection.ToPhase(phase, includeAnswers: false).ExpectedAnswer);
    }

    /// <summary>
    /// Os campos que o editor da secao 5 nao pergunta, derivados com padrao aqui (ver o cabecalho
    /// de PhaseProjection). Este teste e o que trava esses padroes: se alguem acrescentar
    /// dificuldade ao editor, e para ele passar a ler do rascunho e este teste mudar junto.
    /// </summary>
    [Fact]
    public void Code_fields_the_editor_never_asks_come_from_defaults()
    {
        var phase = Queued(
            PhaseKind.Code,
            new PhaseContent(
                Question: "Dado um array de inteiros, retorne os índices…",
                StarterCode: "function somaDosPares(nums) {\n}\n",
                TestCases: "Entrada: nums = [2,7,11,15], target = 9\nSaída: [0,1]"),
            name: "Soma dos pares");

        var dto = PhaseProjection.ToPhase(phase, includeAnswers: true);

        Assert.Equal("Soma dos pares", dto.Title);
        Assert.Equal("Dado um array de inteiros, retorne os índices…", dto.Statement);
        Assert.Equal(PhaseProjection.DefaultDifficulty, dto.Difficulty);
        Assert.Empty(dto.Tags!);
        Assert.Equal("solucao.js", dto.FileName);

        // So a linguagem habilitada recebe o codigo inicial do autor: nao existe traducao de
        // starter code entre linguagens.
        var languages = dto.Languages!;
        Assert.Equal("js", languages[0].Id);
        Assert.True(languages[0].Enabled);
        Assert.Equal("function somaDosPares(nums) {\n}\n", languages[0].StarterCode);
        Assert.All(languages.Skip(1), language =>
        {
            Assert.False(language.Enabled);
            Assert.Equal(string.Empty, language.StarterCode);
        });
    }

    [Fact]
    public void Code_examples_are_read_from_the_free_text_of_test_cases()
    {
        var examples = PhaseProjection.ParseExamples(
            """
            Entrada: nums = [2,7,11,15], target = 9
            Saída: [0,1]

            Entrada: nums = [3,3], target = 6
            Saída: [0,1]
            """);

        Assert.Equal(2, examples.Count);
        Assert.Equal("nums = [2,7,11,15], target = 9", examples[0].Input);
        Assert.Equal("[0,1]", examples[0].Output);
        Assert.Equal("nums = [3,3], target = 6", examples[1].Input);
    }

    /// <summary>O autor ve na tela que ficou pela metade; descartar em silencio esconderia o erro dele.</summary>
    [Fact]
    public void Input_without_output_becomes_an_example_with_empty_output()
    {
        var examples = PhaseProjection.ParseExamples("Entrada: nums = [1]");

        Assert.Equal(string.Empty, Assert.Single(examples).Output);
    }

    [Fact]
    public void Test_cases_in_an_unknown_format_produce_no_examples()
    {
        Assert.Empty(PhaseProjection.ParseExamples("f([2,7]) == 9\nf([3,3]) == 6"));
        Assert.Empty(PhaseProjection.ParseExamples(""));
        Assert.Empty(PhaseProjection.ParseExamples(null));
    }

    /* -------------------------------------------------------------------------- json */

    /// <summary>
    /// A afirmacao e sobre o <b>corpo serializado</b>, e nao sobre o objeto: e no JSON que o front
    /// quebraria. Um quiz que saisse com "segments": null nao seria uma QuizPhase valida em
    /// types.ts — o switch por `kind` do front receberia um objeto que nao satisfaz membro nenhum
    /// da uniao. Mesmo criterio do teste equivalente da secao 5.
    /// </summary>
    [Fact]
    public void Quiz_body_carries_no_field_of_another_kind()
    {
        var phase = Queued(PhaseKind.Quiz, new PhaseContent(
            Question: "Qual fração?",
            Options: ["4/6", "3/4"],
            CorrectIndexes: [0]));

        var json = JsonSerializer.Serialize(PhaseProjection.ToPhase(phase, includeAnswers: false), CodexJsonOptions.Create());

        Assert.Contains("\"kind\":\"quiz\"", json);
        Assert.Contains("\"options\":", json);
        Assert.DoesNotContain("segments", json);
        Assert.DoesNotContain("languages", json);
        Assert.DoesNotContain("expectedAnswer", json);
        // Sem gabarito para aluno: se sair, esta no DevTools.
        Assert.DoesNotContain("correctOptionId", json);
    }

    [Fact]
    public void Fill_body_carries_the_blank_index_zero()
    {
        var phase = Queued(PhaseKind.Fill, new PhaseContent(
            Question: "Ao ___ os termos.",
            Words: ["multiplicar"],
            Blanks: ["multiplicar"]));

        var json = JsonSerializer.Serialize(PhaseProjection.ToPhase(phase, includeAnswers: false), CodexJsonOptions.Create());

        // "index": 0 tem que sair: e o campo que liga o segmento a posicao do gabarito, e omiti-lo
        // deixaria a primeira lacuna sem indice na tela.
        Assert.Contains("\"type\":\"blank\",\"index\":0", json);
        Assert.DoesNotContain("options", json);
    }
}
