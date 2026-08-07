namespace Codex.Api.Contracts.Rooms;

/// <summary>
/// Corpos das mutacoes da fila (api-rest.md secao 6). Todas elas devolvem
/// <see cref="RoomQueueResponse"/> — "todas as mutacoes desta secao devolvem a fila inteira
/// recalculada", para nao haver um refetch por clique.
/// </summary>
/// <remarks>
/// <c>SetId</c> e string, e nao Guid, pelo mesmo motivo que <c>{setId}</c> e string na rota da
/// secao 5: um id malformado desserializado como Guid estoura no pipeline e vira 500 com corpo
/// fora do contrato, enquanto passando reto o servico responde o 404 PHASE_SET_NOT_FOUND que a UI
/// sabe tratar. Aqui ele e o id do <b>PhaseSet de origem</b> — o unico lugar da secao 6 em que
/// "setId" nao e o id da linha da fila, porque a linha da fila e o que esta rota cria.
/// </remarks>
public record AddQueueSetRequest(string? SetId);

/// <summary>
/// <c>PATCH /rooms/{code}/queue/sets/{setId}</c> — "aplica os tres valores a todas as fases daquele
/// conjunto de uma vez".
///
/// Os tres sao anulaveis mesmo o contrato mostrando os tres juntos no exemplo: o campo ausente e o
/// campo inalterado, igual ao PATCH de fase logo abaixo. Um PATCH em que omitir um campo o zera
/// seria um PUT com outro nome.
/// </summary>
public record UpdateQueueSetRequest(
    int? BasePoints,
    decimal? PointsMultiplier,
    int? TimeSeconds);

/// <summary>
/// <c>PATCH /rooms/{code}/queue/phases/{phaseId}</c> — "todos os campos sao opcionais".
///
/// <c>ExpectedAnswer</c> "so vale para fases text/code e e o gabarito que alimenta a correcao por
/// IA": mandado para um quiz ou um fill e VALIDATION_ERROR, e nao um campo ignorado em silencio —
/// quem o mandou acha que gravou um gabarito.
/// </summary>
public record UpdateQueuePhaseRequest(
    string? Name,
    int? BasePoints,
    decimal? PointsMultiplier,
    int? TimeSeconds,
    string? ExpectedAnswer);

/// <summary>
/// <c>PUT /rooms/{code}/queue/order</c> — a fila inteira na ordem nova, "exatamente os ids atuais".
///
/// Lista de string, e nao de Guid: um id malformado no meio da lista <i>e</i> um id que nao esta na
/// fila, entao ele merece o mesmo <c>409 QUEUE_MISMATCH</c> dos outros divergentes — e nao o 500
/// que o desserializador daria antes de qualquer regra do app rodar.
/// </summary>
public record ReorderQueueRequest(IReadOnlyList<string>? PhaseIds);
