namespace Codex.Api.Services.Realtime;

/// <summary>
/// Secao <c>CodexApi:Realtime</c> do appsettings. Sem <c>RedisConnectionString</c> a API sobe
/// sem publicar nada (ver <c>NullRealtimeEventPublisher</c>) — que e exatamente o estado em que
/// o projeto estava antes desta leva, e continua sendo um estado valido para rodar testes e
/// telas que nao dependem de tempo real.
/// </summary>
public class RealtimeOptions
{
    public const string SectionName = "CodexApi:Realtime";

    public string? RedisConnectionString { get; init; }

    /// <summary>Tem que bater com <c>REDIS_CHANNEL_PREFIX</c> do servico Node.</summary>
    public string ChannelPrefix { get; init; } = "codex:rt:";

    /// <summary>
    /// Validade do ticket de <c>POST /realtime-ticket</c>. O contrato (secao 2) fixa 30 s: e o
    /// tempo entre o Server Component montar a pagina e o browser abrir o socket, nao mais.
    /// </summary>
    public int TicketLifetimeSeconds { get; init; } = 30;

    public bool IsRedisConfigured => !string.IsNullOrWhiteSpace(RedisConnectionString);
}
