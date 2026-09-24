using Codex.Api.Domain;

namespace Codex.Api.Common.Auth;

/// <summary>
/// Conteudo do parametro <c>state</c> do fluxo OAuth. Vai e volta pelo browser protegido por
/// Data Protection, entao o callback nao precisa consultar nenhum armazenamento para saber de
/// que provedor veio, para onde redirecionar e qual e o <c>code_verifier</c> do PKCE.
/// </summary>
public record OAuthStatePayload(OAuthProvider Provider, string RedirectTo, string CodeVerifier, DateTimeOffset ExpiresAt)
{
    public bool IsExpired => DateTimeOffset.UtcNow >= ExpiresAt;
}
