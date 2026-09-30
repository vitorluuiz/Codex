using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.Redis;

namespace Codex.Api.Services.Realtime;

public class RealtimeSessionService(
    ISessionTokenService tokenService,
    RoomAccessService roomAccess,
    IRealtimeTicketStore ticketStore,
    IRoomRepository repo)
{
    public async Task<RealtimeSessionResponse> ResolveAsync(ResolveRealtimeSessionRequest request, CancellationToken ct)
    {
        var (sessionToken, cameFromTicket) = await ResolveCredentialAsync(request, ct);

        if (!tokenService.TryValidate(sessionToken, out var payload))
        {
            throw Unauthenticated();
        }

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

        var room = await roomAccess.GetActiveRoomAsync(request.RoomCode, ct);
        var isLeader = payload.UserId is { } userId && userId.ToString() == room.LeaderUserId;
        var participant = await FindParticipantAsync(room.Id, payload.UserId, payload.ParticipantId, ct);

        return new RealtimeSessionResponse(
            payload.UserId,
            participant is not null ? Guid.Parse(participant.Id) : payload.ParticipantId,
            room.Code,
            isLeader,
            participant is not null ? RoomRedisData.ParseParticipantStatus(participant.Status) : null,
            participant?.DisplayName,
            participant?.AvatarIndex,
            cameFromTicket ? sessionToken : null);
    }

    public async Task<RealtimeTicketResponse> IssueTicketAsync(string sessionToken, TimeSpan lifetime, CancellationToken ct)
    {
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

    private async Task<RoomRedisData.ParticipantData?> FindParticipantAsync(string roomId, Guid? userId, Guid? participantId, CancellationToken ct)
    {
        if (participantId is { } id)
        {
            var byId = await repo.GetParticipantAsync(roomId, id.ToString(), ct);
            if (byId is not null) return byId;
        }

        if (userId is { } user)
        {
            var all = await repo.GetParticipantsAsync(roomId, ct);
            return all.FirstOrDefault(p => p.UserId == user.ToString());
        }

        return null;
    }

    private static ApiException Unauthenticated()
        => new(StatusCodes.Status401Unauthorized, ErrorCodes.Unauthenticated, "Sessao invalida ou expirada.");
}
