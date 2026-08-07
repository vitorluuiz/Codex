namespace Codex.Api.Domain.Entities;

/// <summary>api-rest.md secao 7 e 10.</summary>
public class Match
{
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public Guid RoomId { get; set; }
    public Room Room { get; init; } = null!;

    public MatchMode Mode { get; set; }
    public MatchStatus Status { get; set; } = MatchStatus.Running;

    /// <summary>
    /// Posicao da fase corrente na fila da sala — casa com <c>RoomQueuePhase.OrderIndex</c>.
    ///
    /// Nao ha FK para a fase, e nao por economia: a fila fica congelada durante a partida
    /// (<c>MATCH_ALREADY_STARTED</c> em toda mutacao da secao 6), entao o indice e estavel, e uma
    /// segunda referencia para a mesma coisa e uma segunda coisa que pode divergir.
    /// </summary>
    public int CurrentPhaseIndex { get; set; }

    public DateTimeOffset StartedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; set; }

    /// <summary>
    /// Quando a fase corrente comecou a valer. E o minuendo de <c>elapsedSeconds</c>, que a secao 8
    /// manda calcular no servidor (<c>submittedAt - phaseStartedAt</c>) justamente para o cliente
    /// nao poder mandar um numero menor e ganhar bonus de tempo.
    /// </summary>
    public DateTimeOffset? CurrentPhaseStartedAt { get; set; }

    /// <summary>
    /// Instante absoluto em que a fase corrente fecha — o <c>endsAt</c> do websocket-contract.md §6
    /// ("o servidor manda um instante absoluto, nunca 'faltam 32 segundos'").
    ///
    /// <c>null</c> significa pausada: e literalmente o que o contrato manda mandar ao pausar.
    /// O <c>secondsLeft</c> do <c>current-phase</c> e derivado disto na saida, nunca gravado.
    /// </summary>
    public DateTimeOffset? CurrentPhaseEndsAt { get; set; }

    /// <summary>
    /// Quando a fase corrente foi dada por encerrada. E o que torna o fechamento <b>idempotente</b>:
    /// sem esta coluna, "ja fechei esta fase?" nao tem onde ser respondido, e toda leitura que
    /// passasse do <see cref="CurrentPhaseEndsAt"/> republicaria <c>phase.ended</c>.
    ///
    /// Existe porque a decisao foi fechar a fase <i>preguicosamente</i>, sem job: quem chega primeiro
    /// depois do fim do cronometro (uma leitura, um envio, o <c>advance</c> do lider) marca aqui e
    /// publica uma vez so. Um <c>BackgroundService</c> futuro nao muda nada disto — vira apenas mais
    /// um chamador de <c>MatchService.CloseExpiredPhaseAsync</c>.
    /// </summary>
    public DateTimeOffset? CurrentPhaseEndedAt { get; set; }

    /// <summary>
    /// Quanto sobrava do cronometro no instante da pausa. Existe porque <see cref="CurrentPhaseEndsAt"/>
    /// vira <c>null</c> ao pausar e o instante original nao serve mais para retomar — ao despausar,
    /// o fim novo e <c>agora + PausedSecondsLeft</c>, deslocado pela duracao da pausa.
    /// </summary>
    public int? PausedSecondsLeft { get; set; }

    public ICollection<Submission> Submissions { get; init; } = [];
}
