namespace Codex.Api.Contracts;

/// <summary>GET /session (api-rest.md secao 2). Sem sessao valida: os tres campos vem null com 200, nunca 401.</summary>
public record SessionResponse(UserDto? User, Guid? ParticipantId, string? RoomCode);
