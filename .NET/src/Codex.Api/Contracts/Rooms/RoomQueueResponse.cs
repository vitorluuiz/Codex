using Codex.Api.Domain;

namespace Codex.Api.Contracts.Rooms;

/// <summary>
/// Formato exato de GET /rooms/{code}/queue (api-rest.md secao 6).
///
/// Duas listas paralelas, e nao fases aninhadas dentro do conjunto, porque a ordem que importa e
/// a da fila inteira: a partida executa "phases" de cima a baixo, atravessando conjuntos. Os
/// conjuntos existem no payload so para dar titulo e cor a cada fase — e por isso que o front
/// consegue reordenar por arrastar-e-soltar sem nunca mexer em "sets".
///
/// Este mesmo tipo e o retorno de todas as mutacoes da secao 6 quando elas existirem ("todas as
/// mutacoes desta secao devolvem a fila inteira recalculada").
/// </summary>
public record RoomQueueResponse(
    IReadOnlyList<RoomQueueSetDto> Sets,
    IReadOnlyList<RoomQueuePhaseDto> Phases);

/// <summary>
/// O conjunto <b>como copiado para esta sala</b>, nao o PhaseSet de origem: <c>SetId</c> e o id da
/// linha da fila (<c>RoomQueueSet.Id</c>), que e o que as rotas
/// <c>/queue/sets/{setId}</c> recebem de volta. Mandar o <c>SourcePhaseSetId</c> aqui faria o
/// mesmo conjunto adicionado duas vezes na sala virar dois itens com o mesmo id.
/// </summary>
public record RoomQueueSetDto(
    Guid SetId,
    string Title,
    string Color,
    int PhaseCount);

/// <summary>
/// Visao de fila da fase: nome, tipo e os tres numeros que o lider ajusta no lobby. <b>Sem
/// gabarito e sem enunciado</b> — o contrato tem uma rota propria para isso
/// (<c>GET /rooms/{code}/queue/phases/{phaseId}</c>, o modal "Ver desafio"), e o payload da fila
/// e o que a tela do lobby ja carrega inteiro.
/// </summary>
public record RoomQueuePhaseDto(
    Guid Id,
    Guid SetId,
    string Name,
    PhaseKind Kind,
    int BasePoints,
    decimal PointsMultiplier,
    int TimeSeconds);
