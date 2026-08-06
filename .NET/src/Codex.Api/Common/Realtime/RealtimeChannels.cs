namespace Codex.Api.Common.Realtime;

/// <summary>
/// Nomes de canal do websocket-contract.md secao 3. Existe deste lado porque quem publica e a
/// API — o servico de WS so transporta (secao 1).
///
/// Duas nomenclaturas diferentes convivem aqui e nao devem ser confundidas:
///
/// - <b>Canal logico</b> ("room:482913:leader"): o que o cliente assina, e o que viaja dentro
///   do envelope. E o unico que o contrato define.
/// - <b>Canal do broker</b> ("codex:rt:room:482913"): onde o Redis publica. Ha um por sala, e
///   nao um por canal logico, para que cada instancia de WS assine so as salas que atende —
///   com um canal global toda instancia receberia o trafego de todas as salas.
///
/// O espelho deste arquivo no servico Node e <c>realtime/src/channels.ts</c>.
/// </summary>
public static class RealtimeChannels
{
    public static string Room(string roomCode) => $"room:{roomCode}";

    public static string Match(string roomCode) => $"room:{roomCode}:match";

    public static string Leader(string roomCode) => $"room:{roomCode}:leader";

    public static string Participant(Guid participantId) => $"participant:{participantId}";

    public static string BrokerRoom(string prefix, string roomCode) => $"{prefix}room:{roomCode}";
}
