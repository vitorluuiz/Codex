namespace Codex.Api.Domain.Entities;

/// <summary>
/// api-rest.md secao 8, decisao 2 da secao 13: unicidade de "um envio por pessoa por fase" e
/// garantida por indice unico (RoomQueuePhaseId, ParticipantId) em vez de checagem sujeita a corrida.
/// </summary>
public class Submission
{
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public Guid MatchId { get; set; }
    public Match Match { get; init; } = null!;

    public Guid RoomQueuePhaseId { get; set; }
    public RoomQueuePhase RoomQueuePhase { get; init; } = null!;

    public Guid ParticipantId { get; set; }
    public Participant Participant { get; init; } = null!;

    /// <summary>Formato por kind (quiz/fill/text/code), ver secao 8 da doc.</summary>
    public required string AnswerJson { get; set; }

    public DateTimeOffset SubmittedAt { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>Calculado no servidor (SubmittedAt - fase iniciada), nunca recebido do cliente.</summary>
    public int ElapsedSeconds { get; set; }

    /// <summary>
    /// Quando a pessoa marcou "pronto para a proxima fase" (<c>POST .../ready</c>, secao 8). Alimenta
    /// o <c>readyCount</c> do painel do lider.
    ///
    /// <b>Mora na submissao, e nao numa tabela propria</b>, porque no front o botao so e alcancavel
    /// na tela de comparacao coletiva — e so se chega la depois de enviar. Ready sem envio nao existe
    /// hoje, entao uma tabela a parte descreveria o mesmo fato com uma FK a mais. Bonus: o
    /// <c>restart</c> "zera envios e cronometro da fase" apagando as submissoes, e leva os readies
    /// junto sem codigo extra. Se um dia der para marcar pronto sem responder, esta decisao precisa
    /// virar tabela (ver match-implementation-model.md §3.2).
    /// </summary>
    public DateTimeOffset? ReadyAt { get; set; }

    public GradingStatus Grading { get; set; }
    public bool? Correct { get; set; }
    public int? Score { get; set; }
    public string? Explanation { get; set; }

    /// <summary>Preenchido so para fases "code" apos avaliacao por IA/execucao de testes.</summary>
    public string? AiSuggestionsJson { get; set; }
    public string? TestsPassedJson { get; set; }
}
