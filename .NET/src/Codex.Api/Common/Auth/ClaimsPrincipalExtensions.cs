using System.Security.Claims;

namespace Codex.Api.Common.Auth;

public static class ClaimsPrincipalExtensions
{
    public static Guid? GetUserId(this ClaimsPrincipal user)
        => Guid.TryParse(user.FindFirstValue(CodexClaimTypes.UserId), out var id) ? id : null;

    public static Guid? GetParticipantId(this ClaimsPrincipal user)
        => Guid.TryParse(user.FindFirstValue(CodexClaimTypes.ParticipantId), out var id) ? id : null;

    public static string? GetRoomCode(this ClaimsPrincipal user)
        => user.FindFirstValue(CodexClaimTypes.RoomCode);
}
