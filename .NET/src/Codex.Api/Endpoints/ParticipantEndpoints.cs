using System.Security.Claims;
using Codex.Api.Common.RateLimiting;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

/// <summary>api-rest.md secao 3 (entrar na sala) e a parte de participantes da secao 4.</summary>
public static class ParticipantEndpoints
{
    public static void MapParticipantEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/rooms/{code}/participants");

        group.MapPost("", async (string code, JoinRoomRequest request, ClaimsPrincipal principal, ParticipantService participants, CancellationToken ct)
                => Results.Created((string?)null, await participants.JoinAsync(code, request, principal, ct)))
            .RequireRateLimiting(RateLimitPolicies.RoomCode);

        group.MapGet("", async (string code, string? status, ClaimsPrincipal principal, ParticipantService participants, CancellationToken ct)
            => Results.Ok(await participants.ListAsync(code, status, principal, ct)));

        group.MapPost("/{id:guid}/approve", async (string code, Guid id, ClaimsPrincipal principal, ParticipantService participants, CancellationToken ct) =>
        {
            await participants.ApproveAsync(code, id, principal, ct);
            return Results.NoContent();
        });

        group.MapPost("/{id:guid}/reject", async (string code, Guid id, ClaimsPrincipal principal, ParticipantService participants, CancellationToken ct) =>
        {
            await participants.RejectAsync(code, id, principal, ct);
            return Results.NoContent();
        });

        group.MapDelete("/{id:guid}", async (string code, Guid id, ClaimsPrincipal principal, ParticipantService participants, CancellationToken ct) =>
        {
            await participants.RemoveAsync(code, id, principal, ct);
            return Results.NoContent();
        });
    }
}
