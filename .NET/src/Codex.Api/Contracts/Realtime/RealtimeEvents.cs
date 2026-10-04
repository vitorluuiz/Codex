using Codex.Api.Contracts.Matches;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Domain;

namespace Codex.Api.Contracts.Realtime;

/// <summary>
/// O que trafega no broker. O servico de WS le <c>channel</c> para decidir o fan-out e repassa
/// <c>event</c> literal ao cliente — ele nao desserializa o payload de proposito, para que uma
/// mudanca de campo aqui nao exija deploy la.
/// </summary>
public record RealtimeEnvelope(string Channel, object Event, long PublishedAt);

/// <summary>
/// Eventos de websocket-contract.md secao 5. O campo <c>Type</c> e literal em cada record: e o
/// discriminante que o front usa no <c>switch</c> do <c>ServerMessage</c>, entao errar a string
/// aqui e um evento que simplesmente nunca acontece na tela, sem erro nenhum no meio.
///
/// Os payloads reusam os DTOs do REST (<c>ParticipantDto</c>): "um formato so, usado por HTTP e
/// por WS — o front nao precisa de dois parsers, e o backend nao precisa manter dois
/// serializadores em sincronia" (secao 5 do contrato, sobre <c>stats.updated</c>).
/// </summary>
public record ParticipantJoinedEvent(ParticipantDto Participant)
{
    public string Type => "participant.joined";
}

public record ParticipantUpdatedEvent(ParticipantDto Participant)
{
    public string Type => "participant.updated";
}

public record ParticipantLeftEvent(Guid ParticipantId)
{
    public string Type => "participant.left";
}

/// <summary>
/// Canal privado. O servico de WS fecha o socket de quem recebe isto (secao 10: "so mandar o
/// evento deixa a conexao viva recebendo eventos da sala").
/// </summary>
public record ParticipantRemovedEvent(string Reason)
{
    public string Type => "participant.removed";
}

public record RoomSettingsEvent(bool Locked, bool RequireAccount, int Capacity)
{
    public string Type => "room.settings";
}

/// <summary>
/// "Manda so a revisao de proposito: a fila so interessa ao lider, e ele e quem acabou de
/// muda-la." Nao ha nada no schema guardando revisao de fila hoje — quando as mutacoes da secao
/// 6 existirem, e elas que vao publicar isto.
/// </summary>
public record QueueUpdatedEvent(int Revision)
{
    public string Type => "queue.updated";
}

public record RoomClosedEvent
{
    public string Type => "room.closed";
}

/* -------------------------------------------------------------------------- */
/* Partida                                                                     */
/* -------------------------------------------------------------------------- */

/// <summary>
/// Canal da sala, e nao o da partida: e o evento que tira todo mundo do lobby (o
/// <c>LobbyView</c> navega para /partida ao receber isto), e no lobby ninguem assina
/// <c>room:{code}:match</c> ainda.
/// </summary>
public record MatchStartedEvent(Guid MatchId, MatchMode Mode)
{
    public string Type => "match.started";
}

/// <summary>
/// Troca de fase. <c>EndsAt</c> e epoch em <b>ms</b>, e nao uma data ISO: o contrato de WS §6 manda
/// instante absoluto, e o cliente calcula <c>endsAt - (agora + offset)</c> a cada 250 ms. <c>null</c>
/// e "sem cronometro correndo" (pausada).
///
/// <b>O <c>State</c> vai sempre sem gabarito</b>, inclusive para o lider: este canal e coletivo
/// (§3, "se a autorizacao de canal falhar, o pior caso vaza um contador, nao uma resposta"), e o
/// lider tem caminho proprio para a resposta certa — o modal "Ver desafio" da secao 6 e o
/// <c>answerDistribution</c> do painel, que vai pelo canal dele.
/// </summary>
public record PhaseStartedEvent(int PhaseNumber, int TotalPhases, long? StartsAt, long? EndsAt, PhaseStateDto State)
{
    public string Type => "phase.started";

    public PhaseStartedEvent(int phaseNumber, int totalPhases, long? endsAt, PhaseStateDto state)
        : this(phaseNumber, totalPhases, null, endsAt, state)
    {
    }
}

public record PhasePausedEvent(bool Paused, long? EndsAt)
{
    public string Type => "phase.paused";
}

/// <summary>
/// Contadores agregados — nada que identifique alguem. E o unico evento de partida com volume, e
/// por isso o servico de WS o agrega numa janela de 500 ms por sala
/// (<c>realtime/src/throttle.ts</c>): a API publica a cada envio e nao se preocupa com isso.
/// </summary>
public record PhaseProgressEvent(Guid PhaseId, int SubmittedCount, int TotalPlayers, int ReadyCount)
{
    public string Type => "phase.progress";
}

public record PhaseEndedEvent(Guid PhaseId)
{
    public string Type => "phase.ended";
}

public record MatchFinishedEvent(IReadOnlyList<PodiumEntryDto> Podium)
{
    public string Type => "match.finished";
}

public record MatchReturnedToLobbyEvent
{
    public string Type => "match.returned-to-lobby";
}

/// <summary>
/// Canal do lider. "Carrega exatamente o corpo de <c>GET /matches/{id}/phases/{id}/stats</c> — um
/// formato so, usado por HTTP e por WS" (websocket-contract.md §5). Throttle de 1 s no servico de WS.
/// </summary>
public record StatsUpdatedEvent(PhaseStatsDto Stats)
{
    public string Type => "stats.updated";
}
