using System.Text.Json;
using Codex.Api.Domain;

namespace Codex.Api.Services.OAuth;

public class GoogleOAuthClient(OAuthProviderOptions options, IHttpClientFactory httpClientFactory)
    : OpenIdConnectClient(options, httpClientFactory)
{
    public override OAuthProvider Provider => OAuthProvider.Google;

    protected override string AuthorizeEndpoint => "https://accounts.google.com/o/oauth2/v2/auth";
    protected override string TokenEndpoint => "https://oauth2.googleapis.com/token";
    protected override string Scope => "openid email profile";

    /// <summary>
    /// <c>prompt=select_account</c> para que trocar de conta nao exija deslogar do Google — o
    /// caso do professor com a conta pessoal e a da escola no mesmo navegador. Sem
    /// <c>access_type=offline</c>: nao ha refresh token a guardar, a sessao e nossa.
    /// </summary>
    protected override IEnumerable<KeyValuePair<string, string?>> ExtraAuthorizeParameters()
        => [new("prompt", "select_account")];

    protected internal override OAuthProfile ReadProfile(JsonElement claims)
        => new(
            Subject: claims.String("sub") ?? throw OAuthErrors.ExchangeFailed("Google: id_token sem sub."),
            Email: claims.String("email"),
            EmailVerified: claims.Bool("email_verified"),
            Name: claims.String("name"));
}
