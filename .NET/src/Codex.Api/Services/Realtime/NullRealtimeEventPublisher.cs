namespace Codex.Api.Services.Realtime;

/// <summary>
/// Publicador de quando nao ha broker configurado. Nao lanca: o codigo de dominio publica
/// incondicionalmente, e e a composicao (Program.cs) que decide se ha para onde publicar. O
/// alternativo — <c>IRealtimeEventPublisher?</c> injetado e um <c>if</c> em cada ponto de
/// publicacao — espalharia a mesma decisao por todos os servicos.
/// </summary>
public class NullRealtimeEventPublisher(ILogger<NullRealtimeEventPublisher> logger) : IRealtimeEventPublisher
{
    public Task PublishAsync(string roomCode, string channel, object payload, CancellationToken ct)
    {
        logger.LogDebug("Realtime desligado: evento para {Channel} descartado.", channel);
        return Task.CompletedTask;
    }
}
