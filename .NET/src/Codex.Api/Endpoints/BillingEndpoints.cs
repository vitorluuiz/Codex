using System.Security.Claims;
using Codex.Api.Contracts.Billing;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

/// <summary>
/// Endpoints da seção provisória "Pagamentos e plano" (/billing/plan-intent).
///
/// Sem RequireAuthorization() pelo mesmo motivo das demais rotas autenticadas: ausência de sessão
/// responde ACCOUNT_REQUIRED (403) no formato de erro do contrato.
/// </summary>
public static class BillingEndpoints
{
    public static void MapBillingEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/billing");

        group.MapGet("/plan-intent", async (ClaimsPrincipal principal, PlanIntentService intents, CancellationToken ct)
            => Results.Ok(await intents.GetMineAsync(principal, ct)));

        group.MapPut("/plan-intent", async (SavePlanIntentRequest request, ClaimsPrincipal principal, PlanIntentService intents, CancellationToken ct)
            => Results.Ok(await intents.SaveMineAsync(request, principal, ct)));
    }
}
