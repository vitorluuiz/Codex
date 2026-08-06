using Codex.Api.Contracts.Rooms;

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
