using System.Security.Claims;
using Codex.Api.Common.RateLimiting;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

/// <summary>
/// api-rest.md secao 3 (availability) e secao 4 (criar, ler e editar a sala).
///
/// Nenhuma das rotas usa RequireAuthorization(): sessao ausente e um estado valido aqui
/// (convidado consultando um codigo). Quem decide se falta credencial e o RoomAccessService,
/// que precisa da sala em maos para responder ACCOUNT_REQUIRED, NOT_ROOM_LEADER ou
/// ROOM_NOT_FOUND — codes do contrato que um 401 vazio do pipeline nao saberia escolher. Vale
/// tambem para o POST: falta de conta ali e ACCOUNT_REQUIRED, decidido no RoomService.
/// </summary>
public static class RoomEndpoints
{
    public static void MapRoomEndpoints(this IEndpointRouteBuilder app)
    {
        // Fora do grupo abaixo de proposito: e /rooms, sem {code} — o codigo e o que esta rota
        // devolve, nao o que ela recebe.
        // O corpo e opcional (CreateRoomRequest?) porque "Criar sala" manda {} e um cliente
        // razoavel mandaria nada: sem isso, corpo vazio viraria um 400 do proprio pipeline, fora
        // do formato {code, message} do contrato.
        app.MapPost("/rooms", async (CreateRoomRequest? request, ClaimsPrincipal principal, RoomService rooms, CancellationToken ct) =>
        {
            var room = await rooms.CreateAsync(request ?? new CreateRoomRequest(null), principal, ct);
            return Results.Created($"/rooms/{room.Code}", room);
        });

        // Tambem fora do grupo, e pelo mesmo motivo: "active" ocupa a posicao do {code} mas nao e
        // um. Nao ha ambiguidade de roteamento — segmento literal ganha de parametro no ASP.NET —,
        // e um codigo de sala e sempre 6 digitos, entao nenhuma sala real pode se chamar assim.
        //
        // Sem RequireAuthorization(), como as demais: sessao ausente aqui responde 200 [] (ver
        // RoomService.ListActiveAsync), porque quem chama e a tela de entrar, onde nao ter sessao
        // e o estado normal.
        app.MapGet("/rooms/active", async (ClaimsPrincipal principal, RoomService rooms, CancellationToken ct)
            => Results.Ok(await rooms.ListActiveAsync(principal, ct)));

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
