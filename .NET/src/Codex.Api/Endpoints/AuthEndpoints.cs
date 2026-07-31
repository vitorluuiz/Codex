using Codex.Api.Contracts.Auth;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

/// <summary>api-rest.md secao 2. OAuth (POST /auth/oauth/{provider}/authorize) fica fora desta base — ver api-init.md.</summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/auth");

        group.MapPost("/login", async (LoginRequest request, AuthService authService, CancellationToken ct)
            => Results.Ok(await authService.LoginAsync(request, ct)));

        group.MapPost("/signup", async (SignupRequest request, AuthService authService, CancellationToken ct)
            => Results.Ok(await authService.SignupAsync(request, ct)));

        // Token opaco e sem estado no servidor: nao ha deny-list para revogar antes do
        // expiresIn. "Invalida o token" (secao 2) hoje significa "o cliente descarta o
        // cookie". Ver api-init.md para o trade-off e o caminho para invalidacao real.
        group.MapPost("/logout", () => Results.NoContent());
    }
}
