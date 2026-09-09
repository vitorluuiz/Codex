namespace Codex.Api.Services.OAuth;

/// <summary>
/// Secao <c>CodexApi:OAuth</c>. Os segredos ficam vazios no appsettings versionado, como o
/// <c>CodexApi:ServiceToken</c>: em desenvolvimento vem de user-secrets, em producao das
/// variaveis <c>CodexApi__OAuth__Google__ClientId</c> e afins.
/// </summary>
public class OAuthOptions
{
    public const string SectionName = "CodexApi:OAuth";

    /// <summary>
    /// Origem do Next, nao da API: o <c>redirect_uri</c> registrado nos provedores aponta para
    /// <c>{RedirectBaseUrl}/auth/callback/{provider}</c>, porque um redirect de browser nunca
    /// carregaria o <c>x-service-token</c> exigido pelo ServiceTokenMiddleware.
    /// </summary>
    public string RedirectBaseUrl { get; set; } = string.Empty;

    public OAuthProviderOptions Google { get; set; } = new();
    public OAuthProviderOptions Microsoft { get; set; } = new();
    public OAuthProviderOptions GitHub { get; set; } = new();
}

public class OAuthProviderOptions
{
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}
