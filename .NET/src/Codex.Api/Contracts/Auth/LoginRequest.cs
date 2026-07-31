namespace Codex.Api.Contracts.Auth;

public record LoginRequest(string Email, string Password, bool RememberMe);
