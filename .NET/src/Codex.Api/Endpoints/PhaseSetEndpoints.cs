using System.Security.Claims;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

/// <summary>
/// api-rest.md secao 5 — biblioteca de conjuntos e editor.
///
/// Sem RequireAuthorization(), como nas outras: falta de sessao aqui e ACCOUNT_REQUIRED (403) com
/// corpo {code, message}, decidido no PhaseSetService — um 401 vazio do pipeline nao daria a UI
/// o code que ela usa para escolher o dialogo.
///
/// <c>{setId}</c> e string e nao <c>:guid</c> de proposito: com a restricao de rota, um id
/// malformado viraria 404 do roteador, com corpo vazio. Passando reto, o servico responde o mesmo
/// 404 no formato do contrato (PHASE_SET_NOT_FOUND) — mesmo criterio do {userId} do perfil.
/// </summary>
public static class PhaseSetEndpoints
{
    public static void MapPhaseSetEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/phase-sets");

        group.MapGet("/limits", () => Results.Ok(new PhaseLimitsDto()));

        group.MapGet("", async (string? scope, string? q, ClaimsPrincipal principal, PhaseSetService sets, CancellationToken ct)
            => Results.Ok(await sets.ListAsync(scope, q, principal, ct)));

        group.MapPost("", async (SavePhaseSetRequest request, ClaimsPrincipal principal, PhaseSetService sets, CancellationToken ct) =>
        {
            var draft = await sets.CreateAsync(request, principal, ct);
            return Results.Created($"/phase-sets/{draft.Id}/draft", draft);
        });

        group.MapGet("/{setId}/draft", async (string setId, ClaimsPrincipal principal, PhaseSetService sets, CancellationToken ct)
            => Results.Ok(await sets.GetDraftAsync(setId, principal, ct)));

        group.MapPut("/{setId}/draft", async (string setId, SavePhaseSetRequest request, ClaimsPrincipal principal, PhaseSetService sets, CancellationToken ct)
            => Results.Ok(await sets.ReplaceDraftAsync(setId, request, principal, ct)));

        group.MapPatch("/{setId}", async (string setId, RenamePhaseSetRequest request, ClaimsPrincipal principal, PhaseSetService sets, CancellationToken ct)
            => Results.Ok(await sets.RenameAsync(setId, request, principal, ct)));

        group.MapDelete("/{setId}", async (string setId, ClaimsPrincipal principal, PhaseSetService sets, CancellationToken ct) =>
        {
            await sets.DeleteAsync(setId, principal, ct);
            return Results.NoContent();
        });
    }
}
