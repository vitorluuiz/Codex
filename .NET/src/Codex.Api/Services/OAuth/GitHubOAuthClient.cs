using System.Net.Http.Headers;
using System.Text.Json;
using Codex.Api.Domain;
using Microsoft.AspNetCore.WebUtilities;

namespace Codex.Api.Services.OAuth;

/// <summary>
/// O GitHub nao e OpenID Connect: nao ha id_token, entao o perfil sai de duas chamadas a API
/// com o access token. E OAuth Apps ignoram PKCE (so GitHub Apps o aceitam), entao este fluxo
/// se apoia apenas no <c>state</c> — que aqui e assinado e amarrado a um cookie do browser,
/// nao um valor solto.
///
/// Cada OAuth App aceita uma unica callback URL, logo desenvolvimento e producao precisam de
/// dois aplicativos separados, com pares de credenciais distintos.
/// </summary>
public class GitHubOAuthClient(OAuthProviderOptions options, IHttpClientFactory httpClientFactory) : IOAuthProviderClient
{
    private const string AuthorizeEndpoint = "https://github.com/login/oauth/authorize";
    private const string TokenEndpoint = "https://github.com/login/oauth/access_token";
    private const string UserEndpoint = "https://api.github.com/user";
    private const string EmailsEndpoint = "https://api.github.com/user/emails";

    public OAuthProvider Provider => OAuthProvider.GitHub;

    public bool IsConfigured => options.IsConfigured;

    public string BuildAuthorizeUrl(string redirectUri, string state, string codeChallenge)
        => QueryHelpers.AddQueryString(AuthorizeEndpoint, new Dictionary<string, string?>
        {
            ["client_id"] = options.ClientId,
            ["redirect_uri"] = redirectUri,
            // user:email da acesso aos enderecos privados, sem os quais quem esconde o email no
            // perfil cairia sempre em OAUTH_EMAIL_NOT_VERIFIED.
            ["scope"] = "read:user user:email",
            ["state"] = state,
        });

    public async Task<OAuthProfile> FetchProfileAsync(string code, string redirectUri, string codeVerifier, CancellationToken ct)
    {
        var http = httpClientFactory.CreateClient(OAuthHttpClients.Name);
        var accessToken = await ExchangeCodeAsync(http, code, redirectUri, ct);

        using var user = await GetJsonAsync(http, UserEndpoint, accessToken, ct);
        var subject = user.RootElement.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.Number
            ? id.GetInt64().ToString()
            : throw OAuthErrors.ExchangeFailed("GitHub: /user sem id.");

        using var emails = await GetJsonAsync(http, EmailsEndpoint, accessToken, ct);
        var (email, verified) = PickEmail(emails.RootElement);

        return new OAuthProfile(
            Subject: subject,
            Email: email ?? user.RootElement.String("email"),
            EmailVerified: verified,
            Name: user.RootElement.String("name") ?? user.RootElement.String("login"));
    }

    private async Task<string> ExchangeCodeAsync(HttpClient http, string code, string redirectUri, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, TokenEndpoint)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = options.ClientId,
                ["client_secret"] = options.ClientSecret,
                ["code"] = code,
                ["redirect_uri"] = redirectUri,
            }),
        };
        // Sem este Accept o GitHub responde form-urlencoded, e nao JSON.
        request.Headers.Accept.Add(new("application/json"));

        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw OAuthErrors.ExchangeFailed($"GitHub: endpoint de token respondeu {(int)response.StatusCode}.");
        }

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));

        // O GitHub responde 200 com {"error": "..."} quando o code ja foi usado ou expirou.
        if (document.RootElement.String("access_token") is not { } token)
        {
            throw OAuthErrors.ExchangeFailed($"GitHub: {document.RootElement.String("error") ?? "resposta de token sem access_token"}.");
        }

        return token;
    }

    private static async Task<JsonDocument> GetJsonAsync(HttpClient http, string url, string accessToken, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.Accept.Add(new("application/vnd.github+json"));

        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw OAuthErrors.ExchangeFailed($"GitHub: {url} respondeu {(int)response.StatusCode}.");
        }

        return JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
    }

    /// <summary>
    /// Prefere o email primario e verificado; na falta dele, qualquer verificado. Um email nao
    /// verificado nunca e devolvido como verificado, porque e exatamente ele que permitiria
    /// tomar uma conta alheia cadastrando o endereco de outra pessoa no GitHub.
    /// </summary>
    internal static (string? Email, bool Verified) PickEmail(JsonElement emails)
    {
        if (emails.ValueKind != JsonValueKind.Array)
        {
            return (null, false);
        }

        string? fallback = null;

        foreach (var entry in emails.EnumerateArray())
        {
            var address = entry.String("email");
            if (address is null || !entry.Bool("verified"))
            {
                continue;
            }

            if (entry.Bool("primary"))
            {
                return (address, true);
            }

            fallback ??= address;
        }

        return fallback is null ? (null, false) : (fallback, true);
    }
}
