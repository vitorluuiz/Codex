using System.Text.Json;
using Codex.Api.Domain;

namespace Codex.Api.Services.OAuth;

/// <summary>
/// Endpoint <c>common</c>: aceita conta pessoal (@outlook.com) e conta corporativa/escolar do
/// Entra ID. O registro do aplicativo precisa estar em "contas em qualquer diretorio
/// organizacional e contas pessoais da Microsoft" ou o proprio login recusa.
/// </summary>
public class MicrosoftOAuthClient(OAuthProviderOptions options, IHttpClientFactory httpClientFactory)
    : OpenIdConnectClient(options, httpClientFactory)
{
    public override OAuthProvider Provider => OAuthProvider.Microsoft;

    protected override string AuthorizeEndpoint => "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
    protected override string TokenEndpoint => "https://login.microsoftonline.com/common/oauth2/v2.0/token";
    protected override string Scope => "openid email profile";

    protected override IEnumerable<KeyValuePair<string, string?>> ExtraAuthorizeParameters()
        => [new("prompt", "select_account")];

    /// <summary>
    /// A Microsoft nao emite <c>email_verified</c>. Tratamos como verificado porque ela controla
    /// tanto o dominio da conta pessoal quanto o tenant da corporativa — ninguem cadastra um
    /// endereco de terceiro ali. Quando <c>email</c> falta (acontece em conta pessoal sem email
    /// no perfil), cai para <c>preferred_username</c>, que no v2 e o proprio endereco de login.
    /// </summary>
    protected internal override OAuthProfile ReadProfile(JsonElement claims)
    {
        var email = claims.String("email") ?? claims.String("preferred_username");

        return new OAuthProfile(
            Subject: claims.String("sub") ?? throw OAuthErrors.ExchangeFailed("Microsoft: id_token sem sub."),
            Email: email,
            EmailVerified: email is not null,
            Name: claims.String("name"));
    }
}
