using Codex.Api.Contracts.Phases;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;

namespace Codex.Api.Services;

/// <summary>
/// A conversao <c>DraftPhase</c> (o que esta gravado) → <c>Phase</c> (o que a partida consome).
///
/// <b>Por que ela existe num lugar so.</b> <see cref="PhaseContent"/> fixou que o banco guarda a
/// forma de <i>autoria</i>, porque so ela e superset (api-phases-log.md §2). Quem precisa da forma
/// de partida deriva na saida — e sao dois: o <c>GET /rooms/{code}/queue/phases/{phaseId}</c> da
/// secao 6 (modal "Ver desafio") e o <c>GET /matches/{matchId}/current-phase</c> da secao 7. Duas
/// conversoes separadas dariam ao lider uma previa diferente do que o aluno joga, que e exatamente
/// o bug que o modal existe para evitar.
///
/// <b>O que ela nao consegue inventar.</b> Um <c>CodePhase</c> do contrato pede <c>difficulty</c>,
/// <c>tags</c>, <c>examples</c>, <c>fileName</c> e <c>languages[]</c>; o editor da secao 5 nao
/// pergunta nada disso — o rascunho de <c>code</c> so tem <c>question</c>, <c>starterCode</c> e
/// <c>testCases</c>. Os campos que faltam sao derivados com padrao aqui (ver as constantes abaixo)
/// em vez de acrescentados ao editor: acrescenta-los seria mudanca da secao 5 do contrato e tela
/// nova, e a fase de codigo funciona sem eles. Quando o produto quiser que o autor escolha
/// dificuldade e linguagem, o lugar de mudar e o editor — e este arquivo passa a so ler.
/// </summary>
public static class PhaseProjection
{
    /// <summary>
    /// O <c>difficulty</c> que sai quando ninguem escolheu — e ninguem escolhe hoje. "medium" e o
    /// meio dos tres valores de <c>AiDifficulty</c>, entao nao empurra a fase para nenhum extremo.
    /// </summary>
    public const string DefaultDifficulty = "medium";

    /// <summary>
    /// Nome do arquivo mostrado sobre o editor de codigo do aluno. Segue a linguagem habilitada,
    /// e o radical espelha o <c>function solucao(entrada)</c> com que o editor cria uma fase
    /// <c>code</c> nova (<c>set-editor/phaseKinds.tsx</c>).
    /// </summary>
    private const string SolutionFileStem = "solucao";

    /// <summary>
    /// O catalogo de linguagens de uma fase <c>code</c>. E do servidor porque nao existe no front:
    /// <c>types.ts</c> descreve o formato (<c>CodeLanguage</c>) e nada o preenche.
    ///
    /// Exatamente as duas do exemplo do contrato (secao 7), e so a primeira habilitada — "linguagens
    /// ainda nao suportadas aparecem desabilitadas ('Em breve')". Habilitar mais e promessa de
    /// executar codigo naquela linguagem, e o sandbox de execucao (secao 8) nao existe nem foi
    /// decidido; listar dez seria mostrar ao aluno nove botoes mortos.
    /// </summary>
    public static readonly IReadOnlyList<(string Id, string Label, bool Enabled, string Extension)> Languages =
    [
        ("js", "JavaScript", true, "js"),
        ("py", "Python", false, "py"),
    ];

    /// <summary>
    /// Prefixos que abrem entrada e saida de um exemplo dentro do texto livre de <c>testCases</c>.
    /// Sao os do placeholder do editor ("Entrada: … / Saida: …",
    /// <c>set-editor/PhaseForm.tsx</c>), que e a unica coisa que ensina o autor a escrever ali —
    /// o contrato diz explicitamente que o formato e livre e "o servidor e quem interpreta".
    /// </summary>
    private static readonly string[] InputPrefixes = ["entrada:", "input:"];
    private static readonly string[] OutputPrefixes = ["saida:", "saída:", "output:"];

    /// <summary>
    /// A fase da fila da sala na forma de partida.
    /// </summary>
    /// <param name="includeAnswers">
    /// Deixa sair <c>correctOptionId</c>, <c>correctWords</c> e <c>expectedAnswer</c>. <b>So para o
    /// lider, ou depois da fase fechar</b> — a "regra de ouro" da secao 7: se o gabarito sair para
    /// um aluno com a fase aberta, ele esta no DevTools. Como e um parametro obrigatorio, ninguem
    /// deriva uma fase sem responder essa pergunta.
    /// </param>
    public static PhaseDto ToPhase(RoomQueuePhase phase, bool includeAnswers)
    {
        var content = PhaseContent.Parse(phase.ContentJson);

        var dto = new PhaseDto(
            phase.Id,
            phase.RoomQueueSetId,
            phase.Kind,
            phase.Name,
            phase.BasePoints,
            phase.PointsMultiplier,
            phase.TimeSeconds);

        return phase.Kind switch
        {
            PhaseKind.Quiz => ToQuiz(dto, content, includeAnswers),
            PhaseKind.Fill => ToFill(dto, content, includeAnswers),
            PhaseKind.Text => ToText(dto, content, includeAnswers),
            PhaseKind.Code => ToCode(dto, content, includeAnswers),
            _ => dto,
        };
    }

    private static PhaseDto ToQuiz(PhaseDto dto, PhaseContent content, bool includeAnswers)
    {
        var labels = content.Options ?? [];
        var options = labels.Select((label, index) => new QuizOptionDto(OptionId(index), label)).ToList();

        // O gabarito gravado e uma lista (o editor aceita mais de uma alternativa certa) e o
        // contrato so tem lugar para uma: `correctOptionId`, singular, em types.ts e na secao 6.
        // Sai a primeira. E uma perda conhecida — esta registrada em api-queue-log.md §4,
        // porque quem for implementar a correcao da secao 8 precisa ler `correctIndexes`, e nao
        // este campo, para nao reprovar um aluno que marcou a segunda resposta certa.
        var correct = content.CorrectIndexes?
            .Where(index => index >= 0 && index < options.Count)
            .OrderBy(index => index)
            .Select(OptionId)
            .FirstOrDefault();

        return dto with
        {
            Question = content.Question ?? string.Empty,
            Options = options,
            CorrectOptionId = includeAnswers ? correct : null,
        };
    }

    private static PhaseDto ToFill(PhaseDto dto, PhaseContent content, bool includeAnswers)
    {
        // `correctWords` e posicional como os `blanks` gravados, entao a lacuna que o autor ainda
        // nao preencheu vira "" em vez de sumir: sumindo, a segunda palavra do gabarito passaria a
        // responder pela primeira lacuna.
        var correctWords = content.Blanks?.Select(blank => blank ?? string.Empty).ToList();

        return dto with
        {
            Segments = SplitSegments(content.Question),
            Words = content.Words ?? [],
            CorrectWords = includeAnswers ? correctWords ?? [] : null,
        };
    }

    private static PhaseDto ToText(PhaseDto dto, PhaseContent content, bool includeAnswers) => dto with
    {
        Question = content.Question ?? string.Empty,
        ExpectedAnswer = includeAnswers ? content.ExpectedAnswer ?? string.Empty : null,
    };

    private static PhaseDto ToCode(PhaseDto dto, PhaseContent content, bool includeAnswers)
    {
        var starterCode = content.StarterCode ?? string.Empty;

        var languages = Languages
            // O codigo inicial que o autor escreveu vale para a linguagem habilitada; as outras
            // vem vazias, porque nao existe traducao de starter code entre linguagens.
            .Select(language => new CodeLanguageDto(
                language.Id,
                language.Label,
                language.Enabled,
                language.Enabled ? starterCode : string.Empty))
            .ToList();

        var extension = Languages.FirstOrDefault(language => language.Enabled).Extension is { Length: > 0 } enabled
            ? enabled
            : "txt";

        return dto with
        {
            // `title` da fase de codigo e o nome dela na fila: sao a mesma coisa para o autor, que
            // so digita um campo. `statement` e o enunciado — texto puro, sem HTML (secao 7).
            Title = dto.Name,
            Difficulty = DefaultDifficulty,
            Tags = [],
            Statement = content.Question ?? string.Empty,
            Examples = ParseExamples(content.TestCases),
            FileName = $"{SolutionFileStem}.{extension}",
            Languages = languages,
            ExpectedAnswer = includeAnswers ? content.ExpectedAnswer ?? string.Empty : null,
        };
    }

    /// <summary>
    /// Id da alternativa a partir da posicao ("o1", "o2", … — os ids do exemplo do contrato).
    ///
    /// Derivado, e nao gravado, porque o que existe no banco sao indices: <c>options</c> e
    /// <c>string[]</c> e o gabarito e <c>correctIndexes</c> (decisao da secao 5). Ser deterministico
    /// e o que faz a submissao do aluno (<c>answer.optionId</c>, secao 8) poder ser conferida
    /// depois contra o mesmo gabarito, sem uma tabela de ids de alternativa.
    ///
    /// <b>Consequencia:</b> reordenar as alternativas no editor troca o significado dos ids. Isso e
    /// inofensivo para uma fase ja copiada para a fila (a copia e literal e nao acompanha o
    /// conjunto de origem), e e por isso que a copia existe.
    /// </summary>
    public static string OptionId(int index) => $"o{index + 1}";

    /// <summary>
    /// Quebra o enunciado gravado (<c>"Ao ___ os termos, a ___ se mantem."</c>) nos segmentos que
    /// o front renderiza — "a frase vem quebrada em segmentos, para o front nao fazer parse".
    ///
    /// Mesma varredura de <see cref="PhaseContent.CountBlanks"/>, e isso importa: o gabarito e
    /// posicional, entao contar lacunas de um jeito na validacao e quebrar de outro aqui daria uma
    /// fase cujo <c>correctWords[i]</c> nao corresponde a lacuna <c>i</c> da tela.
    ///
    /// Trecho de texto e trimado e trecho vazio nao entra: <c>.sentence</c> e um flex com
    /// <c>gap: 8px</c> (<c>FillChallenge.module.css</c>) — o espacamento e do CSS, e um segmento so
    /// com espacos viraria um item invisivel ocupando um gap a mais.
    /// </summary>
    public static IReadOnlyList<FillSegmentDto> SplitSegments(string? question)
    {
        var segments = new List<FillSegmentDto>();

        if (string.IsNullOrEmpty(question))
        {
            return segments;
        }

        var start = 0;
        var blankIndex = 0;

        for (var index = 0; index < question.Length;)
        {
            var token = PhaseContent.BlankTokens.FirstOrDefault(t => string.CompareOrdinal(question, index, t, 0, t.Length) is 0);
            if (token is null)
            {
                index++;
                continue;
            }

            AddText(segments, question[start..index]);
            segments.Add(FillSegmentDto.Blank(blankIndex++));

            index += token.Length;
            start = index;
        }

        AddText(segments, question[start..]);

        return segments;
    }

    private static void AddText(List<FillSegmentDto> segments, string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length > 0)
        {
            segments.Add(FillSegmentDto.Text(trimmed));
        }
    }

    /// <summary>
    /// Os exemplos de entrada/saida que a tela de codigo mostra, lidos do texto livre de
    /// <c>testCases</c> no formato que o placeholder do editor ensina.
    ///
    /// Linha que nao comeca com um dos prefixos e ignorada — inclusive as do meio de um par, o que
    /// permite ao autor separar os casos com linhas em branco ou comentarios. Entrada sem saida
    /// vira exemplo com saida vazia em vez de sumir: o autor ve na tela que ficou pela metade, e
    /// descartar em silencio esconderia o erro dele.
    /// </summary>
    public static IReadOnlyList<CodeExampleDto> ParseExamples(string? testCases)
    {
        var examples = new List<CodeExampleDto>();

        if (string.IsNullOrWhiteSpace(testCases))
        {
            return examples;
        }

        string? pendingInput = null;

        foreach (var line in testCases.Split('\n'))
        {
            var trimmed = line.Trim();

            if (Strip(trimmed, InputPrefixes) is { } input)
            {
                if (pendingInput is not null)
                {
                    examples.Add(new CodeExampleDto(pendingInput, string.Empty));
                }

                pendingInput = input;
            }
            else if (Strip(trimmed, OutputPrefixes) is { } output && pendingInput is not null)
            {
                examples.Add(new CodeExampleDto(pendingInput, output));
                pendingInput = null;
            }
        }

        if (pendingInput is not null)
        {
            examples.Add(new CodeExampleDto(pendingInput, string.Empty));
        }

        return examples;
    }

    private static string? Strip(string line, string[] prefixes)
    {
        var prefix = prefixes.FirstOrDefault(p => line.StartsWith(p, StringComparison.OrdinalIgnoreCase));
        return prefix is null ? null : line[prefix.Length..].Trim();
    }
}
