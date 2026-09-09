using Codex.Api.Domain;

namespace Codex.Api.Services.OAuth;

public interface IOAuthProviderClient
{
    OAuthProvider Provider { get; }

    bool IsConfigured { get; }

    /// <summary>Monta a URL de consentimento. <paramref name="codeChallenge"/> e ignorado por quem nao faz PKCE (GitHub).</summary>
    string BuildAuthorizeUrl(string redirectUri, string state, string codeChallenge);

    /// <summary>Troca o <c>code</c> pelo token e le o perfil. Lanca ApiException OAUTH_EXCHANGE_FAILED em qualquer falha do provedor.</summary>
    Task<OAuthProfile> FetchProfileAsync(string code, string redirectUri, string codeVerifier, CancellationToken ct);
}
