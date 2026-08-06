using StackExchange.Redis;

namespace Codex.Api.Services.Realtime;

/// <summary>
/// Conexao unica e preguicosa com o Redis. Preguicosa de proposito: conectar no startup faria a
/// API deixar de subir quando o Redis estivesse fora do ar, trocando uma degradacao (tempo real
/// parado) por uma indisponibilidade (API inteira parada) — o inverso do que o contrato pede.
/// </summary>
public interface IRealtimeConnection
{
    Task<IConnectionMultiplexer> GetAsync(CancellationToken ct);
}

public class RedisRealtimeConnection(RealtimeOptions options, ILogger<RedisRealtimeConnection> logger)
    : IRealtimeConnection, IAsyncDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IConnectionMultiplexer? _multiplexer;

    public async Task<IConnectionMultiplexer> GetAsync(CancellationToken ct)
    {
        if (_multiplexer is { IsConnected: true })
        {
            return _multiplexer;
        }

        await _gate.WaitAsync(ct);
        try
        {
            if (_multiplexer is not null)
            {
                return _multiplexer;
            }

            var configuration = RedisConfigurationParser.Parse(options.RedisConnectionString!);

            // AbortOnConnectFail = false: o multiplexer nasce mesmo com o Redis fora do ar e
            // reconecta sozinho depois. Com true, a primeira publicacao com Redis caido
            // lancaria e toda publicacao seguinte tentaria conectar de novo do zero.
            configuration.AbortOnConnectFail = false;
            configuration.ClientName = "codex-api";

            _multiplexer = await ConnectionMultiplexer.ConnectAsync(configuration);
            logger.LogInformation("Conexao de realtime com o Redis estabelecida.");
            return _multiplexer;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_multiplexer is not null)
        {
            await _multiplexer.CloseAsync();
            _multiplexer.Dispose();
        }

        _gate.Dispose();
        GC.SuppressFinalize(this);
    }
}
