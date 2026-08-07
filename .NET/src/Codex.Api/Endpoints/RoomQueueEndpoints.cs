using System.Security.Claims;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

/// <summary>
/// api-rest.md secao 6 — a fila de fases da sala.
///
/// Arquivo proprio, e nao uma rota no RoomEndpoints, porque a secao inteira mora sob
/// /rooms/{code}/queue.
///
/// Como nas outras rotas de sala, sem RequireAuthorization(): quem decide o erro e o
/// RoomAccessService, que distingue NOT_ROOM_LEADER de ROOM_NOT_FOUND — um 401 vazio do
/// pipeline nao saberia escolher.
///
/// <c>{setId}</c> e <c>{phaseId}</c> sao string e nao <c>:guid</c>, como o <c>{setId}</c> da secao
/// 5: com a restricao de rota, um id malformado viraria 404 do roteador com corpo vazio; passando
/// reto, o servico responde o mesmo 404 no formato {code, message} do contrato.
///
/// <b>Toda mutacao aqui devolve 200 com a fila inteira</b> — inclusive os DELETE, que por isso nao
/// respondem 204. E o contrato pedindo ("todas as mutacoes desta secao devolvem a fila inteira
/// recalculada"): a tela do lobby redesenha a fila e os conjuntos com a resposta do clique, sem um
/// GET a mais e sem recalcular no cliente cor ou indice, que sao decisao do servidor.
/// </summary>
public static class RoomQueueEndpoints
{
    public static void MapRoomQueueEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/rooms/{code}/queue");

        group.MapGet("", async (string code, ClaimsPrincipal principal, RoomQueueService queue, CancellationToken ct)
            => Results.Ok(await queue.GetQueueAsync(code, principal, ct)));

        group.MapPost("/sets", async (string code, AddQueueSetRequest request, ClaimsPrincipal principal, RoomQueueService queue, CancellationToken ct)
            => Results.Ok(await queue.AddSetAsync(code, request, principal, ct)));

        group.MapDelete("/sets/{setId}", async (string code, string setId, ClaimsPrincipal principal, RoomQueueService queue, CancellationToken ct)
            => Results.Ok(await queue.RemoveSetAsync(code, setId, principal, ct)));

        group.MapPatch("/sets/{setId}", async (string code, string setId, UpdateQueueSetRequest request, ClaimsPrincipal principal, RoomQueueService queue, CancellationToken ct)
            => Results.Ok(await queue.UpdateSetAsync(code, setId, request, principal, ct)));

        group.MapPatch("/phases/{phaseId}", async (string code, string phaseId, UpdateQueuePhaseRequest request, ClaimsPrincipal principal, RoomQueueService queue, CancellationToken ct)
            => Results.Ok(await queue.UpdatePhaseAsync(code, phaseId, request, principal, ct)));

        group.MapDelete("/phases/{phaseId}", async (string code, string phaseId, ClaimsPrincipal principal, RoomQueueService queue, CancellationToken ct)
            => Results.Ok(await queue.RemovePhaseAsync(code, phaseId, principal, ct)));

        // Registrado antes de nenhuma rota concorrente, mas vale a nota: "order" nao colide com
        // "/phases/{phaseId}" nem com "/sets/{setId}" porque esta um segmento acima dos dois.
        group.MapPut("/order", async (string code, ReorderQueueRequest request, ClaimsPrincipal principal, RoomQueueService queue, CancellationToken ct)
            => Results.Ok(await queue.ReorderAsync(code, request, principal, ct)));

        // A unica rota da secao que nao devolve a fila: e leitura, e devolve a fase com gabarito.
        group.MapGet("/phases/{phaseId}", async (string code, string phaseId, ClaimsPrincipal principal, RoomQueueService queue, CancellationToken ct)
            => Results.Ok(await queue.GetPhaseDetailAsync(code, phaseId, principal, ct)));
    }
}
