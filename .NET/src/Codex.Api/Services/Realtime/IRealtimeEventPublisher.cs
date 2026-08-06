namespace Codex.Api.Services.Realtime;

/// <summary>
/// O lado "publica" de websocket-contract.md secao 1: "Toda mutacao passa pela API REST, que
/// grava no banco e <b>depois</b> publica o evento."
///
/// Duas regras que valem para todo chamador:
///
/// 1. <b>Publique depois do SaveChanges.</b> Publicar antes entrega ao cliente um estado que
///    ainda pode desaparecer se a transacao falhar — e o cliente, ao recarregar, veria o estado
///    antigo voltar.
/// 2. <b>Falha aqui nao derruba a requisicao.</b> A implementacao engole e loga. O contrato
///    e explicito: "Se ele cair, a partida nao corrompe: os alunos param de ver atualizacao ao
///    vivo, recarregam, e o REST devolve o estado correto."
/// </summary>
public interface IRealtimeEventPublisher
{
    /// <param name="roomCode">Sala a que o evento pertence — define o canal do broker.</param>
    /// <param name="channel">Canal logico do contrato (ver <c>RealtimeChannels</c>).</param>
    /// <param name="payload">Um dos records de <c>Contracts/Realtime/RealtimeEvents.cs</c>.</param>
    Task PublishAsync(string roomCode, string channel, object payload, CancellationToken ct);
}
