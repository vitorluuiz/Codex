namespace Codex.Api.Services.Realtime;

/// <summary>
/// Composicao do realtime. E aqui — e so aqui — que "existe broker configurado?" e respondido:
/// o resto do codigo publica sempre, sem perguntar.
/// </summary>
public static class RealtimeServiceCollectionExtensions
{
    public static IServiceCollection AddCodexRealtime(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(RealtimeOptions.SectionName).Get<RealtimeOptions>() ?? new RealtimeOptions();
        services.AddSingleton(options);
        services.AddScoped<RealtimeSessionService>();

        if (options.IsRedisConfigured)
        {
            services.AddSingleton<IRealtimeConnection, RedisRealtimeConnection>();
            services.AddSingleton<IRealtimeEventPublisher, RedisRealtimeEventPublisher>();
            services.AddSingleton<IRealtimeTicketStore, RedisRealtimeTicketStore>();
            return services;
        }

        // Sem Redis a API sobe e funciona: nenhum evento sai, e os tickets valem so na instancia
        // que os emitiu. E o modo em que os testes rodam. Diferente do ServiceToken (que falha
        // fechado), aqui a ausencia degrada em vez de quebrar — nao ha risco de seguranca em nao
        // publicar um evento.
        services.AddSingleton<IRealtimeEventPublisher, NullRealtimeEventPublisher>();
        services.AddSingleton<IRealtimeTicketStore, InMemoryRealtimeTicketStore>();
        return services;
    }
}
