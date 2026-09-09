namespace Codex.Api.Contracts.Auth;

/// <summary>api-rest.md secao 2. <c>redirectTo</c> ausente cai no destino padrao do login.</summary>
public record OAuthAuthorizeRequest(string? RedirectTo);

/// <summary>
/// O contrato previa so <c>authorizeUrl</c>. O <c>state</c> vai junto para o Next guardar num
/// cookie e conferir no callback: sem essa amarra ao browser, qualquer um poderia iniciar um
/// fluxo e induzir outra pessoa a completa-lo, logando-a na conta do atacante.
/// </summary>
public record OAuthAuthorizeResponse(string AuthorizeUrl, string State);

public record OAuthCallbackRequest(string Code, string State);

/// <summary>Mesmo formato do <see cref="AuthResponse"/> mais o destino, que veio dentro do state e o Next nao consegue abrir.</summary>
public record OAuthCallbackResponse(string Token, int ExpiresIn, UserDto User, string RedirectTo);
