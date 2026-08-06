using Codex.Api.Services.Realtime;

namespace Codex.Api.Tests;

/// <summary>
/// Publicador de teste: guarda o que seria mandado ao broker, em ordem. Nao ha Redis nos testes
/// (mesma politica do EF InMemory) — o que se verifica aqui e o contrato de publicacao: canal,
/// tipo de evento e payload.
/// </summary>
public class RecordingRealtimePublisher : IRealtimeEventPublisher
{
    public List<PublishedEvent> Published { get; } = [];

    public Task PublishAsync(string roomCode, string channel, object payload, CancellationToken ct)
    {
        Published.Add(new PublishedEvent(roomCode, channel, payload));
        return Task.CompletedTask;
    }

    public IEnumerable<PublishedEvent> OfType<T>() => Published.Where(e => e.Payload is T);

    public PublishedEvent? Single<T>() => Published.SingleOrDefault(e => e.Payload is T);
}

public record PublishedEvent(string RoomCode, string Channel, object Payload)
{
    public T As<T>() => (T)Payload;
}
