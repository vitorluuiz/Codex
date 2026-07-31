namespace Codex.Api.Contracts.Auth;

public record AuthResponse(string Token, int ExpiresIn, UserDto User);
