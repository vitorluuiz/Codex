using System.Security.Claims;
using Codex.Api.Common.RateLimiting;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

/// <summary>
/// api-rest.md secao 3 (availability) e secao 4 (ler/editar a sala).
///
/// Nenhuma das rotas usa RequireAuthorization(): sessao ausente e um estado valido aqui
/// (convidado consultando um codigo). Quem decide se falta credencial e o RoomAccessService,
/// que precisa da sala em maos para responder ACCOUNT_REQUIRED, NOT_ROOM_LEADER ou
/// ROOM_NOT_FOUND — codes do contrato que um 401 vazio do pipeline nao saberia escolher.
/// </summary>
public static class RoomEndpoints
{
    public static void MapRoomEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/rooms/{code}");

        group.MapGet("/availability", async (string code, ClaimsPrincipal principal, RoomService rooms, CancellationToken ct)
                => Results.Ok(await rooms.GetAvailabilityAsync(code, principal, ct)))
            .RequireRateLimiting(RateLimitPolicies.RoomCode);

        group.MapGet("", async (string code, ClaimsPrincipal principal, RoomService rooms, CancellationToken ct)
            => Results.Ok(await rooms.GetRoomAsync(code, principal, ct)));

        group.MapPatch("", async (string code, UpdateRoomRequest request, ClaimsPrincipal principal, RoomService rooms, CancellationToken ct)
            => Results.Ok(await rooms.UpdateAsync(code, request, principal, ct)));
    }
}
