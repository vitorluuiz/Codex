using Codex.Api.Services.Realtime;

namespace Codex.Api.Services.Ai;

/// <summary>
/// Composicao da camada de IA (cliente OpenAI-compativel, roteador por plano, semaforo, lock
/// in-flight no Redis, servico de cota e <see cref="AiService"/>).
/// </summary>
public static class AiServiceCollectionExtensions
{
    public static IServiceCollection AddCodexAi(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(AiOptions.SectionName).Get<AiOptions>() ?? new AiOptions();
        services.AddSingleton(options);

        services.AddHttpClient(AiHttpClients.Name, client =>
        {
            // O timeout efetivo e controlado por perfil (AiProviderOptions.TimeoutSeconds) via CancellationTokenSource.
            client.Timeout = Timeout.InfiniteTimeSpan;
        });

        services.AddSingleton<IAiChatClient, OpenAiCompatibleChatClient>();
        services.AddSingleton<AiProviderRouter>();

        var realtimeOptions = configuration.GetSection(RealtimeOptions.SectionName).Get<RealtimeOptions>() ?? new RealtimeOptions();
        if (realtimeOptions.IsRedisConfigured)
        {
            services.AddSingleton<IAiInflightLock, RedisAiInflightLock>();
        }
        else
        {
            services.AddSingleton<IAiInflightLock, InMemoryAiInflightLock>();
        }

        services.AddScoped<AiQuotaService>();
        services.AddScoped<AiService>();

        return services;
    }
}
