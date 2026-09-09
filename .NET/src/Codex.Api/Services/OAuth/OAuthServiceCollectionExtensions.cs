namespace Codex.Api.Services.OAuth;

/// <summary>
/// Composicao do login social. Os tres clientes sao sempre registrados, mesmo sem credenciais:
/// quem responde "este provedor nao esta configurado" e o OAuthService, por provedor, para que
/// ligar um de cada vez seja possivel sem redeploy de codigo.
/// </summary>
public static class OAuthServiceCollectionExtensions
{
    public static IServiceCollection AddCodexOAuth(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(OAuthOptions.SectionName).Get<OAuthOptions>() ?? new OAuthOptions();
        services.AddSingleton(options);

        // Timeout curto: as duas rotas de OAuth ficam bloqueadas esperando o provedor, e do outro
        // lado ha um browser parado numa tela branca.
        services.AddHttpClient(OAuthHttpClients.Name, client =>
        {
            client.Timeout = TimeSpan.FromSeconds(10);
            // A API do GitHub recusa requisicao sem User-Agent.
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Codex-Api");
        });

        services.AddSingleton<IOAuthProviderClient>(sp => new GoogleOAuthClient(options.Google, sp.GetRequiredService<IHttpClientFactory>()));
        services.AddSingleton<IOAuthProviderClient>(sp => new MicrosoftOAuthClient(options.Microsoft, sp.GetRequiredService<IHttpClientFactory>()));
        services.AddSingleton<IOAuthProviderClient>(sp => new GitHubOAuthClient(options.GitHub, sp.GetRequiredService<IHttpClientFactory>()));

        services.AddScoped<OAuthService>();
        return services;
    }
}
