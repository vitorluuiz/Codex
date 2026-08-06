using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Services.Realtime;
using Microsoft.Net.Http.Headers;

namespace Codex.Api.Endpoints;

/// <summary>
/// As duas rotas que o servico de tempo real precisa (websocket-contract.md secoes 2 e 10).
/// Nenhuma delas esta no contrato REST: elas nao servem a nenhuma tela, servem ao WS.
///
/// As duas ja estao protegidas pelo <c>ServiceTokenMiddleware</c>, que cobre 100% das rotas
/// exceto /health — ou seja, nem o servico de WS nem o servidor do Next falam com elas sem o
/// segredo compartilhado, e um browser nunca fala com elas de jeito nenhum.
/// </summary>
public static class RealtimeEndpoints
{
    private const string BearerPrefix = "Bearer ";

    public static void MapRealtimeEndpoints(this IEndpointRouteBuilder app)
    {
        // Chamada pelo servico de WS, duas vezes por conexao no caminho normal: uma antes do
        // upgrade (so identidade, sem roomCode) e uma no `hello` (com a sala, para o papel). E
        // de novo a cada `subscribe` — a secao 10 exige reler o papel, "nao confie no isLeader
        // que voce mandou no ready cinco minutos atras".
        app.MapPost("/internal/realtime/resolve", async (
            ResolveRealtimeSessionRequest request,
            RealtimeSessionService realtime,
            CancellationToken ct) => Results.Ok(await realtime.ResolveAsync(request, ct)));

        // Chamada pelo servidor do Next, em nome de quem esta abrindo a pagina. O token de
        // sessao vem no Authorization, como em qualquer rota do contrato REST — aqui ele e lido
        // cru (e nao pelo ClaimsPrincipal) porque e o proprio token que precisa ser guardado, e
        // o principal so carrega os claims ja extraidos dele.
        app.MapPost("/realtime-ticket", async (
            HttpContext context,
            RealtimeSessionService realtime,
            RealtimeOptions options,
            CancellationToken ct) =>
        {
            var token = ReadBearerToken(context);
            var lifetime = TimeSpan.FromSeconds(options.TicketLifetimeSeconds);
            return Results.Ok(await realtime.IssueTicketAsync(token, lifetime, ct));
        });
    }

    private static string ReadBearerToken(HttpContext context)
    {
        var raw = context.Request.Headers[HeaderNames.Authorization].ToString();
        if (!raw.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException(StatusCodes.Status401Unauthorized, ErrorCodes.Unauthenticated, "Sessao ausente.");
        }

        return raw[BearerPrefix.Length..].Trim();
    }
}
