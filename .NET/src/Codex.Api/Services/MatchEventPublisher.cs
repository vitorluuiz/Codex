using Codex.Api.Common.Realtime;
using Codex.Api.Contracts.Matches;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.Realtime;

namespace Codex.Api.Services;

/// <summary>
/// Os eventos de partida do websocket-contract.md §5, num lugar so.
///
/// Existe porque <b>duas</b> camadas os publicam — o ciclo de vida da partida
/// (<see cref="MatchService"/>) e o envio de resposta (<see cref="SubmissionService"/>) — e a
/// escolha de canal por evento nao pode ser feita duas vezes. Errar o canal aqui nao daria erro
/// nenhum: o servico de WS descarta silenciosamente o evento que nao pertence ao canal
/// (<c>realtime/src/channels.ts</c>), e a tela simplesmente nunca atualizaria.
///
/// <b>Todo metodo daqui assume que o SaveChanges ja aconteceu.</b> Publicar antes entregaria ao
/// cliente um estado que ainda pode sumir (contrato de WS §1).
/// </summary>
public class MatchEventPublisher(MatchStatsService stats, IRealtimeEventPublisher realtime)
{
    /// <summary>
    /// Canal da <b>sala</b>, e nao o da partida: quem esta no lobby ainda nao assina
    /// <c>room:{code}:match</c>, e e este evento que manda todo mundo para a tela de desafios.
    /// </summary>
    public Task MatchStartedAsync(Room room, Match match, CancellationToken ct)
        => realtime.PublishAsync(room.Code, RealtimeChannels.Room(room.Code), new MatchStartedEvent(match.Id, match.Mode), ct);

    public Task PhaseStartedAsync(Room room, Match match, PhaseStateDto state, CancellationToken ct)
        => realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Match(room.Code),
            new PhaseStartedEvent(state.PhaseNumber, state.TotalPhases, EpochMs(match.CurrentPhaseStartedAt), EpochMs(match.CurrentPhaseEndsAt), state),
            ct);

    /// <summary>Ao pausar, <c>endsAt</c> vai <c>null</c>; ao retomar, o instante novo ja deslocado.</summary>
    public Task PhasePausedAsync(Room room, Match match, bool paused, CancellationToken ct)
        => realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Match(room.Code),
            new PhasePausedEvent(paused, EpochMs(match.CurrentPhaseEndsAt)),
            ct);

    public Task PhaseEndedAsync(Room room, Guid phaseId, CancellationToken ct)
        => realtime.PublishAsync(room.Code, RealtimeChannels.Match(room.Code), new PhaseEndedEvent(phaseId), ct);

    public Task MatchFinishedAsync(Room room, IReadOnlyList<PodiumEntryDto> podium, CancellationToken ct)
        => realtime.PublishAsync(room.Code, RealtimeChannels.Match(room.Code), new MatchFinishedEvent(podium), ct);

    public Task ReturnedToLobbyAsync(Room room, CancellationToken ct)
        => realtime.PublishAsync(room.Code, RealtimeChannels.Match(room.Code), new MatchReturnedToLobbyEvent(), ct);

    /// <summary>
    /// Canal privado, e o servico de WS fecha o socket de quem recebe isto. "So mandar o evento
    /// deixa a conexao viva recebendo eventos da sala" (contrato de WS §10).
    /// </summary>
    public Task ParticipantRemovedAsync(Room room, Guid participantId, CancellationToken ct)
        => realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Participant(participantId),
            new ParticipantRemovedEvent("removed_by_leader"),
            ct);

    /// <summary>
    /// Os dois eventos de contador, publicados juntos porque saem do mesmo calculo: o agregado
    /// anonimo para a turma (<c>phase.progress</c>) e o painel inteiro para o lider
    /// (<c>stats.updated</c>).
    ///
    /// A separacao e de seguranca, nao de organizacao: <c>room:{code}:match</c> leva so "13 de 28
    /// enviaram", enquanto a lista com nome e tempo de cada aluno vai por <c>room:{code}:leader</c>.
    /// "Se a autorizacao de canal falhar, o pior caso vaza um contador, nao uma resposta."
    ///
    /// Sao publicados a cada envio, sem contencao aqui: o throttle (500 ms e 1 s) e do servico de WS,
    /// que e quem sabe quantos sockets ha do outro lado.
    /// </summary>
    public async Task ProgressAsync(Room room, Match match, RoomQueuePhase phase, CancellationToken ct)
    {
        var payload = await stats.GetStatsAsync(match, phase, ct);

        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Match(room.Code),
            new PhaseProgressEvent(phase.Id, payload.SubmittedCount, payload.TotalPlayers, payload.ReadyCount),
            ct);

        await realtime.PublishAsync(room.Code, RealtimeChannels.Leader(room.Code), new StatsUpdatedEvent(payload), ct);
    }

    /// <summary>
    /// O cronometro trafega como epoch em <b>ms</b> (contrato de WS §6), e nao como data ISO: o
    /// cliente faz aritmetica com ele a cada 250 ms e corrige o relogio local pelo offset do ping.
    /// </summary>
    private static long? EpochMs(DateTimeOffset? instant) => instant?.ToUnixTimeMilliseconds();
}
