namespace Codex.Api.Common.Auth;

/// <summary>
/// api-rest.md secao 1: "o token de sessao cobre dois sujeitos diferentes" — usuario
/// autenticado (UserId) ou participante convidado (ParticipantId + RoomCode). Nunca os dois
/// de uma vez nem nenhum dos dois.
/// </summary>
public record SessionTokenPayload(Guid? UserId, Guid? ParticipantId, string? RoomCode, DateTimeOffset ExpiresAt)
{
    public bool IsExpired => DateTimeOffset.UtcNow >= ExpiresAt;
}
