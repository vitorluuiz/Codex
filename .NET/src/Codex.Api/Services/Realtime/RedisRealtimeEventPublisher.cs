using System.Text.Json;
using Codex.Api.Common.Json;
using Codex.Api.Common.Realtime;
using Codex.Api.Contracts.Realtime;
using StackExchange.Redis;

namespace Codex.Api.Services.Realtime;

public class RedisRealtimeEventPublisher(
    IRealtimeConnection connection,
    RealtimeOptions options,
    ILogger<RedisRealtimeEventPublisher> logger) : IRealtimeEventPublisher
{
    private static readonly JsonSerializerOptions SerializerOptions = CodexJsonOptions.Create();

    public async Task PublishAsync(string roomCode, string channel, object payload, CancellationToken ct)
    {
        var envelope = new RealtimeEnvelope(channel, payload, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var json = JsonSerializer.Serialize(envelope, SerializerOptions);
        var brokerChannel = RealtimeChannels.BrokerRoom(options.ChannelPrefix, roomCode);

        try
        {
            var subscriber = (await connection.GetAsync(ct)).GetSubscriber();

            // Publish devolve quantas instancias de WS receberam. Zero e normal e nao e erro:
            // uma sala sem ninguem conectado — ou com todo mundo em outra instancia que ainda
            // nao assinou — simplesmente nao tem para quem entregar. Nao ha replay (secao 8):
            // quem chegar depois le o estado pelo REST.
            var receivers = await subscriber.PublishAsync(RedisChannel.Literal(brokerChannel), json);

            logger.LogDebug(
                "Evento {EventChannel} publicado em {BrokerChannel} ({Receivers} instancia(s))",
                channel, brokerChannel, receivers);
        }
        catch (Exception ex)
        {
            // Deliberadamente engolido: a mutacao ja foi gravada e respondida. Perder o evento
            // degrada o tempo real (o outro browser so ve ao recarregar) — propagar a excecao
            // transformaria um Redis fora do ar em erro 500 numa acao que deu certo.
            logger.LogError(ex, "Falha ao publicar {EventChannel} em {BrokerChannel}", channel, brokerChannel);
        }
    }
}
