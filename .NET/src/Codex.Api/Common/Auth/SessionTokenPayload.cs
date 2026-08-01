namespace Codex.Api.Common.Auth;

/// <summary>
/// api-rest.md secao 1: "o token de sessao cobre dois sujeitos diferentes" — usuario
/// autenticado (UserId) e participante (ParticipantId + RoomCode).
///
/// O doc apresenta os dois como alternativos, mas eles se acumulam: quando alguem com conta
/// entra numa sala (secao 3), o token passa a carregar os dois, porque continuar sendo "a
/// Marina" e ser "o participante p_9 da sala 482913" sao fatos simultaneos. Emitir so o
/// participante deslogaria a pessoa da propria conta ao entrar numa sala.
/// </summary>
public record SessionTokenPayload(Guid? UserId, Guid? ParticipantId, string? RoomCode, DateTimeOffset ExpiresAt)
{
    public bool IsExpired => DateTimeOffset.UtcNow >= ExpiresAt;
}
