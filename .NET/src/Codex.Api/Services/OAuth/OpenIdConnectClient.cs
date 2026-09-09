using System.Text.Json;
using Codex.Api.Common.Errors;
using Codex.Api.Domain;

namespace Codex.Api.Services.OAuth;

/// <summary>
/// Base do Google e do Microsoft, que sao os dois OpenID Connect: fluxo de codigo com PKCE
/// S256 e perfil lido das claims do <c>id_token</c>.
///
/// A assinatura do id_token nao e validada de proposito. Ele chega como resposta direta do
/// endpoint de token, sobre TLS, num canal em que ja provamos ser o cliente ao mandar o
/// client_secret — o caminho em que a propria especificacao (OIDC Core 3.1.3.7) dispensa a
/// verificacao. Evita cachear e rotacionar JWKS por nada. Se um dia a API passar a aceitar
/// id_token vindo do browser (fluxo implicito ou One Tap), a validacao volta a ser obrigatoria.
/// </summary>
public abstract class OpenIdConnectClient(OAuthProviderOptions options, IHttpClientFactory httpClientFactory) : IOAuthProviderClient
{
    public abstract OAuthProvider Provider { get; }

    protected abstract string AuthorizeEndpoint { get; }
    protected abstract string TokenEndpoint { get; }
    protected abstract string Scope { get; }

    public bool IsConfigured => options.IsConfigured;

    public string BuildAuthorizeUrl(string redirectUri, string state, string codeChallenge)
    {
        var query = new Dictionary<string, string?>
        {
            ["client_id"] = options.ClientId,
            ["response_type"] = "code",
            ["redirect_uri"] = redirectUri,
            ["scope"] = Scope,
            ["state"] = state,
            ["code_challenge"] = codeChallenge,
            ["code_challenge_method"] = "S256",
        };

        foreach (var extra in ExtraAuthorizeParameters())
        {
            query[extra.Key] = extra.Value;
        }

        return Microsoft.AspNetCore.WebUtilities.QueryHelpers.AddQueryString(AuthorizeEndpoint, query);
    }

    protected virtual IEnumerable<KeyValuePair<string, string?>> ExtraAuthorizeParameters() => [];

    public async Task<OAuthProfile> FetchProfileAsync(string code, string redirectUri, string codeVerifier, CancellationToken ct)
    {
        var http = httpClientFactory.CreateClient(OAuthHttpClients.Name);

        using var request = new HttpRequestMessage(HttpMethod.Post, TokenEndpoint)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = options.ClientId,
                ["client_secret"] = options.ClientSecret,
                ["code"] = code,
                ["redirect_uri"] = redirectUri,
                ["grant_type"] = "authorization_code",
                ["code_verifier"] = codeVerifier,
            }),
        };
        request.Headers.Accept.Add(new("application/json"));

        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw OAuthErrors.ExchangeFailed($"{Provider}: endpoint de token respondeu {(int)response.StatusCode}.");
        }

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        if (!document.RootElement.TryGetProperty("id_token", out var idToken) || idToken.GetString() is not { } raw)
        {
            throw OAuthErrors.ExchangeFailed($"{Provider}: resposta de token sem id_token.");
        }

        using var claims = IdToken.ReadClaims(raw);
        return ReadProfile(claims.RootElement);
    }

    protected internal abstract OAuthProfile ReadProfile(JsonElement claims);
}
