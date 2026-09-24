namespace Codex.Api.Services.OAuth;

/// <summary>
/// Perfil normalizado. Cada provedor fala um dialeto diferente (o Google e o Microsoft
/// entregam claims num id_token, o GitHub exige duas chamadas de API); a regra de vinculo em
/// <c>OAuthService</c> so ve este formato.
/// </summary>
/// <param name="Subject">Identificador estavel no provedor.</param>
/// <param name="Email">Pode ser nulo: conta Microsoft pessoal nem sempre expoe email, e o GitHub permite email privado.</param>
/// <param name="EmailVerified">Decide se da para vincular a uma conta existente sem abrir tomada de conta.</param>
/// <param name="Name">Usado so na criacao da conta; cai para a parte local do email quando ausente.</param>
public record OAuthProfile(string Subject, string? Email, bool EmailVerified, string? Name);
