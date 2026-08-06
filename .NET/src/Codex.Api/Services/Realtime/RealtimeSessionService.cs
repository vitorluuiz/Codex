using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Data;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services.Realtime;

/// <summary>
/// A resposta de "quem esta neste socket, e o que ele pode ver nesta sala".
///
/// Esta rota existe porque o token de sessao do Codex e opaco: <c>SessionTokenService</c> o
/// protege com Data Protection, e a chave vive no Postgres desta API. Nenhum processo Node
/// consegue le-lo — e isso e desejavel, porque a secao 10 do websocket-contract exige reler o
/// papel <b>do banco</b> a cada <c>subscribe</c>, e o banco e daqui. Entao o servico de WS nao
/// decide autorizacao: ele pergunta, e esta classe responde.
///
/// Continua valendo a regra da secao 1 do contrato REST — "autorizacao num lugar so".
/// </summary>
public class RealtimeSessionService(
    AppDbContext db,
    ISessionTokenService tokenService,
    RoomAccessService roomAccess,
    IRealtimeTicketStore ticketStore)
{
    public async Task<RealtimeSessionResponse> ResolveAsync(ResolveRealtimeSessionRequest request, CancellationToken ct)
    {
        var (sessionToken, cameFromTicket) = await ResolveCredentialAsync(request, ct);

        if (!tokenService.TryValidate(sessionToken, out var payload))
        {
            throw Unauthenticated();
        }

        // Sem sala: o handshake pediu so identidade (a checagem que roda antes do upgrade, quando
        // o `hello` — e portanto o codigo da sala — ainda nao chegou).
        if (string.IsNullOrWhiteSpace(request.RoomCode))
        {
            return new RealtimeSessionResponse(
                payload.UserId,
                payload.ParticipantId,
                payload.RoomCode,
                IsLeader: false,
                ParticipantStatus: null,
                DisplayName: null,
                AvatarIndex: null,
                SessionToken: cameFromTicket ? sessionToken : null);
        }

        // Lanca ROOM_NOT_FOUND (404) para codigo malformado e para sala expirada, do mesmo jeito
        // que qualquer outra rota de sala. O WS traduz isso no code ROOM_NOT_FOUND do protocolo.
        var room = await roomAccess.GetActiveRoomAsync(request.RoomCode, ct);
        var isLeader = payload.UserId is { } userId && userId == room.LeaderUserId;
        var participant = await FindParticipantAsync(room.Id, payload.UserId, payload.ParticipantId, ct);

        return new RealtimeSessionResponse(
            payload.UserId,
            participant?.Id ?? payload.ParticipantId,
            room.Code,
            isLeader,
            participant?.Status,
            participant?.DisplayName,
            participant?.AvatarIndex,
            cameFromTicket ? sessionToken : null);
    }

    public async Task<RealtimeTicketResponse> IssueTicketAsync(string sessionToken, TimeSpan lifetime, CancellationToken ct)
    {
        // Valida antes de emitir: um ticket so vale o que a sessao por tras dele vale, e emitir
        // sobre um token invalido so adiaria a recusa para o handshake.
        if (!tokenService.TryValidate(sessionToken, out _))
        {
            throw Unauthenticated();
        }

        var ticket = await ticketStore.IssueAsync(sessionToken, lifetime, ct);
        return new RealtimeTicketResponse(ticket, (int)lifetime.TotalSeconds);
    }

    private async Task<(string SessionToken, bool CameFromTicket)> ResolveCredentialAsync(
        ResolveRealtimeSessionRequest request,
        CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(request.Ticket))
        {
            var stored = await ticketStore.RedeemAsync(request.Ticket, ct);
            if (stored is null)
            {
                // Nao distingue "nunca existiu", "ja foi usado" e "expirou": os tres sao a mesma
                // resposta para quem esta do outro lado, e distinguir daria um oraculo de
                // tickets validos.
                throw Unauthenticated();
            }

            return (stored, true);
        }

        if (string.IsNullOrWhiteSpace(request.SessionToken))
        {
            throw Unauthenticated();
        }

        return (request.SessionToken, false);
    }

    /// <summary>
    /// O participante desta sala, procurado primeiro pelo id que o token carrega e depois pelo
    /// usuario. A segunda tentativa cobre quem entrou na sala com conta e depois renovou a
    /// sessao por outro caminho (login em outra aba): o token novo tem <c>UserId</c> mas nao
    /// <c>ParticipantId</c>, e sem isto essa pessoa apareceria como "nao e participante" e nao
    /// conseguiria assinar canal nenhum.
    /// </summary>
    private async Task<Participant?> FindParticipantAsync(Guid roomId, Guid? userId, Guid? participantId, CancellationToken ct)
    {
        if (participantId is { } id)
        {
            var byId = await db.Participants
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == id && p.RoomId == roomId, ct);

            if (byId is not null)
            {
                return byId;
            }
        }

        if (userId is { } user)
        {
            return await db.Participants
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.RoomId == roomId && p.UserId == user, ct);
        }

        return null;
    }

    private static ApiException Unauthenticated()
        => new(StatusCodes.Status401Unauthorized, ErrorCodes.Unauthenticated, "Sessao invalida ou expirada.");
}
