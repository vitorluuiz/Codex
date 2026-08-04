using System.Security.Claims;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

/// <summary>
/// api-rest.md secao 6 — a fila de fases da sala.
///
/// Arquivo proprio, e nao mais uma rota no RoomEndpoints, porque a secao inteira mora sob
/// /rooms/{code}/queue: as mutacoes que faltam (sets, phases, order) entram todas neste grupo.
///
/// Como nas outras rotas de sala, sem RequireAuthorization(): quem decide o erro e o
/// RoomAccessService, que distingue NOT_ROOM_LEADER de ROOM_NOT_FOUND — um 401 vazio do
/// pipeline nao saberia escolher.
/// </summary>
public static class RoomQueueEndpoints
{
    public static void MapRoomQueueEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/rooms/{code}/queue");

        group.MapGet("", async (string code, ClaimsPrincipal principal, RoomQueueService queue, CancellationToken ct)
            => Results.Ok(await queue.GetQueueAsync(code, principal, ct)));
    }
}
