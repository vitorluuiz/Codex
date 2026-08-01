namespace Codex.Api.Contracts.Rooms;

/// <summary>POST /rooms/{code}/participants (api-rest.md secao 3).</summary>
public record JoinRoomRequest(string DisplayName, int AvatarIndex);

/// <summary>
/// Resposta de POST /rooms/{code}/participants. "token"/"expiresIn" tem o mesmo papel do
/// AuthResponse do login: o servidor do Next grava no cookie codex_session.
/// </summary>
public record JoinRoomResponse(ParticipantDto Participant, string Token, int ExpiresIn);