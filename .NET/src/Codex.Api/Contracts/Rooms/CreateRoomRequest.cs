namespace Codex.Api.Contracts.Rooms;

/// <summary>
/// POST /rooms (api-rest.md secao 4).
///
/// "setId e opcional. Quando vem, o servidor ja enfileira as fases daquele conjunto na sala
/// recem-criada — numa chamada so, para o lobby nao abrir vazio e a fila aparecer meio segundo
/// depois." O corpo do botao "Criar sala" e literalmente <c>{}</c>; o do "Iniciar" no card de um
/// conjunto e <c>{ "setId": "..." }</c>.
/// </summary>
public record CreateRoomRequest(Guid? SetId);
