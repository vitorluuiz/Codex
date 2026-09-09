using Codex.Api.Contracts.Auth;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

/// <summary>api-rest.md secao 2, incluindo o login social.</summary>
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

        // Login social. Sem RequireAuthorization, como todo o resto da base: quem entra aqui e
        // justamente quem ainda nao tem sessao.
        //
        // O par authorize/callback e chamado pelo servidor do Next, nunca pelo browser. O
        // redirect do provedor aterrissa em /auth/callback/{provider} no Next, que so entao
        // chama o callback abaixo com o x-service-token — ver OAuthService.
        group.MapPost("/oauth/{provider}/authorize", (string provider, OAuthAuthorizeRequest request, OAuthService oauth)
            => Results.Ok(oauth.BuildAuthorizeUrl(provider, request)));

        group.MapPost("/oauth/{provider}/callback", async (string provider, OAuthCallbackRequest request, OAuthService oauth, CancellationToken ct)
            => Results.Ok(await oauth.CompleteAsync(provider, request, ct)));
    }
}
