using System.Security.Claims;
using Codex.Api.Contracts.Users;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

/// <summary>
/// api-rest.md secao 2, a parte de perfil: PATCH /users/me e GET /users/{userId}/profile.
///
/// Como nas rotas de sala, nenhuma usa RequireAuthorization(): quando falta sessao o contrato
/// pede ACCOUNT_REQUIRED (403), que um 401 vazio do pipeline nao produziria.
/// </summary>
public static class UserEndpoints
{
    public static void MapUserEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/users");

        group.MapPatch("/me", async (UpdateUserRequest request, ClaimsPrincipal principal, UserProfileService users, CancellationToken ct)
            => Results.Ok(await users.UpdateMeAsync(request, principal, ct)));

        // {userId} e string e nao Guid: o contrato diz que a rota aceita o literal "me", e uma
        // restricao :guid faria esse caso virar 404 do roteador antes de chegar no servico.
        group.MapGet("/{userId}/profile", async (string userId, ClaimsPrincipal principal, UserProfileService users, CancellationToken ct)
            => Results.Ok(await users.GetProfileAsync(userId, principal, ct)));
    }
}
