namespace Codex.Api.Contracts.Rooms;

/// <summary>
/// GET /rooms/{code}/availability (api-rest.md secao 3). Deliberadamente magro: valida o codigo
/// antes de pedir nome e avatar e nao cria nada, entao nao expoe nem o id da sala nem o lider —
/// quem chama ainda nao provou ter direito a nada alem de "existe e da pra entrar".
/// </summary>
public record RoomAvailabilityResponse(string Code, int Capacity, bool RequireAccount);