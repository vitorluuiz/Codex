using Codex.Api.Domain;

namespace Codex.Api.Contracts.Realtime;

/// <summary>
/// Corpo de <c>POST /internal/realtime/resolve</c>. Exatamente um entre <c>SessionToken</c> e
/// <c>Ticket</c> deve vir preenchido.
///
/// O token viaja no <b>corpo</b>, e nao no cabecalho <c>Authorization</c>, porque quem chama
/// nao e o dono da sessao: e o servico de WS perguntando "de quem e este token?". Usar o
/// cabecalho faria a rota parecer autenticada como aquela pessoa, o que ela nao e.
/// </summary>
public record ResolveRealtimeSessionRequest(string? SessionToken, string? Ticket, string? RoomCode);

/// <summary>
/// Resposta de <c>POST /internal/realtime/resolve</c>. Espelhada em
/// <c>realtime/src/identity.ts</c>.
/// </summary>
/// <param name="RoomCode">
/// Sala de fato resolvida (o codigo normalizado), nao o que veio no pedido.
/// </param>
/// <param name="ParticipantStatus">
/// <c>null</c> quando quem chamou nao e participante desta sala — o caso do lider, que e um
/// usuario e nao um participante.
/// </param>
/// <param name="SessionToken">
/// So preenchido quando a credencial apresentada foi um <b>ticket</b>: o servico de WS guarda
/// este token para reler o papel nos <c>subscribe</c> seguintes (secao 10 do contrato), coisa
/// que um ticket de uso unico nao permite.
/// </param>
public record RealtimeSessionResponse(
    Guid? UserId,
    Guid? ParticipantId,
    string? RoomCode,
    bool IsLeader,
    ParticipantStatus? ParticipantStatus,
    string? DisplayName,
    int? AvatarIndex,
    string? SessionToken);

/// <summary>
/// Resposta de <c>POST /realtime-ticket</c>. <c>expiresIn</c> em segundos, como as demais rotas
/// que emitem credencial (secao 2 do contrato REST).
/// </summary>
public record RealtimeTicketResponse(string Ticket, int ExpiresIn);
