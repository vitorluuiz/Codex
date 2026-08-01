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
            UserDto? user = null;
            if (principal.GetUserId() is { } userId)
            {
                var entity = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId, ct);
                user = entity is null ? null : AuthService.ToDto(entity);
            }

            // Os tres campos sao independentes: o exemplo do doc mostra "user" preenchido com
            // participantId null, mas quem tem conta e entrou numa sala (secao 3) tem os dois —
            // e o lobby precisa do participantId para saber qual card e o "voce".
            return Results.Ok(new SessionResponse(user, principal.GetParticipantId(), principal.GetRoomCode()));
        });
    }
}
