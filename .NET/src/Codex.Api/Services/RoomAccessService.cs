using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Domain;
using Codex.Api.Services.Redis;

namespace Codex.Api.Services;

public class RoomAccessService(IRoomRepository repo)
{
    public async Task<RoomRedisData.RoomData> GetActiveRoomAsync(string code, CancellationToken ct)
    {
        var normalized = code?.Trim() ?? string.Empty;
        if (normalized.Length is not 6 || !normalized.All(char.IsAsciiDigit))
        {
            throw RoomNotFound();
        }

        var roomId = await repo.GetRoomIdByCodeAsync(normalized, ct);
        if (roomId is null) throw RoomNotFound();

        var room = await repo.GetRoomAsync(roomId, ct);
        if (room is null) throw RoomNotFound();

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (room.ExpiresAtMs.HasValue && room.ExpiresAtMs.Value <= now)
        {
            throw RoomNotFound();
        }

        return room;
    }

    public async Task<RoomRedisData.RoomData> GetRoomAsLeaderAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await GetActiveRoomAsync(code, ct);
        EnsureLeader(room, principal);
        return room;
    }

    public static void EnsureLeader(RoomRedisData.RoomData room, ClaimsPrincipal principal)
    {
        if (principal.GetUserId()?.ToString() != room.LeaderUserId)
        {
            throw new ApiException(StatusCodes.Status403Forbidden, ErrorCodes.NotRoomLeader, "Esta acao e restrita ao apresentador da sala.");
        }
    }

    public async Task<RoomRedisData.RoomData> GetRoomAsMemberAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await GetActiveRoomAsync(code, ct);

        if (principal.GetUserId()?.ToString() == room.LeaderUserId)
        {
            return room;
        }

        if (principal.GetParticipantId() is { } participantId)
        {
            var p = await repo.GetParticipantAsync(room.Id, participantId.ToString(), ct);
            if (p is not null && RoomRedisData.ParseParticipantStatus(p.Status) != ParticipantStatus.Rejected)
            {
                return room;
            }
        }

        throw RoomNotFound();
    }

    private static ApiException RoomNotFound()
        => new(StatusCodes.Status404NotFound, ErrorCodes.RoomNotFound, "Sala nao encontrada.");
}
