namespace Codex.Api.Contracts.Auth;

/// <summary>A confirmacao de email/senha (campos "Confirmar...") e validada no cliente; o backend recebe so o valor final (api-rest.md secao 2).</summary>
public record SignupRequest(string Name, string Email, string Password);
