namespace Codex.Api.Contracts.Rooms;

/// <summary>
/// PATCH /rooms/{code} (api-rest.md secao 4). Os tres campos sao opcionais: null significa
/// "nao mexe", nao "apaga". O exemplo do doc manda os tres juntos, mas os toggles da UI de
/// lider sao independentes, entao cada um pode vir sozinho.
/// </summary>
public record UpdateRoomRequest(bool? Locked, bool? RequireAccount, int? Capacity);