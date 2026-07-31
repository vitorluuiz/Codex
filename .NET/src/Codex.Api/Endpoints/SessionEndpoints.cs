using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Contracts;
using Codex.Api.Data;
using Codex.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Endpoints;

/// <summary>api-rest.md secao 2. "E a primeira coisa que todo Server Component chama."</summary>
public static class SessionEndpoints
{
    public static void MapSessionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/session", async (ClaimsPrincipal principal, AppDbContext db, CancellationToken ct) =>
        {
            if (principal.GetUserId() is { } userId)
            {
                var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId, ct);
                if (user is not null)
                {
                    return Results.Ok(new SessionResponse(AuthService.ToDto(user), null, null));
                }
            }

            return Results.Ok(new SessionResponse(null, principal.GetParticipantId(), principal.GetRoomCode()));
        });
    }
}
