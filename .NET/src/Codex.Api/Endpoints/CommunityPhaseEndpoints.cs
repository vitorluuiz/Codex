using System.Security.Claims;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

public static class CommunityPhaseEndpoints
{
    public static void MapCommunityPhaseEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/community/phases");

        group.MapGet("", async (
                string? q,
                string? subject,
                string? kind,
                string? sort,
                int? limit,
                int? cursor,
                CommunityPhaseService service,
                CancellationToken ct)
            => Results.Ok(await service.SearchAsync(q, subject, kind, sort, limit, cursor, ct)));

        group.MapGet("/{phaseId}", async (string phaseId, CommunityPhaseService service, CancellationToken ct)
            => Results.Ok(await service.GetAsDraftPhaseAsync(phaseId, ct)));

        group.MapPost("", async (
            PublishCommunityPhaseRequest request,
            ClaimsPrincipal principal,
            CommunityPhaseService service,
            CancellationToken ct) =>
        {
            var created = await service.PublishAsync(request, principal, ct);
            return Results.Created($"/community/phases/{created.Id}", created);
        });
    }
}
