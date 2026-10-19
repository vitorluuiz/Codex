using System.Security.Claims;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Ai;
using Codex.Api.Services.Ai;

namespace Codex.Api.Endpoints;

/// <summary>
/// Rotas de geracao assistida por IA para o editor de conjuntos:
/// <list type="bullet">
///   <item><description><c>GET /ai/usage</c></description></item>
///   <item><description><c>POST /ai/phases/generate</c></description></item>
///   <item><description><c>POST /ai/phases/variations</c></description></item>
///   <item><description><c>POST /ai/quiz/options/suggest</c></description></item>
///   <item><description><c>POST /ai/generations/{generationId}/decision</c></description></item>
/// </list>
/// </summary>
public static class AiEndpoints
{
    public static void MapAiEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/ai");

        group.MapGet("/usage", async (ClaimsPrincipal principal, AiService ai, CancellationToken ct)
            => Results.Ok(await ai.GetUsageAsync(principal, ct)));

        group.MapPost("/phases/generate", async (GeneratePhaseRequest request, ClaimsPrincipal principal, AiService ai, CancellationToken ct)
            => Results.Ok(await ai.GeneratePhaseAsync(request, principal, ct)));

        group.MapPost("/phases/variations", async (GenerateVariationsRequest request, ClaimsPrincipal principal, AiService ai, CancellationToken ct)
            => Results.Ok(await ai.GenerateVariationsAsync(request, principal, ct)));

        group.MapPost("/quiz/options/suggest", async (SuggestQuizOptionsRequest request, ClaimsPrincipal principal, AiService ai, CancellationToken ct)
            => Results.Ok(await ai.SuggestQuizOptionsAsync(request, principal, ct)));

        group.MapPost("/generations/{generationId}/decision", async (string generationId, AiDecisionRequest request, ClaimsPrincipal principal, AiService ai, CancellationToken ct) =>
        {
            if (!Guid.TryParse(generationId, out var parsedId))
            {
                throw new ApiException(
                    StatusCodes.Status404NotFound,
                    ErrorCodes.AiGenerationNotFound,
                    "Geracao de IA nao encontrada.");
            }

            await ai.RecordDecisionAsync(parsedId, request, principal, ct);
            return Results.NoContent();
        });
    }
}
