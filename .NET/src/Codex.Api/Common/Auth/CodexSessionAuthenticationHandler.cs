using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Codex.Api.Common.Auth;

/// <summary>
/// Resolve o cookie/token de sessao (api-rest.md secao 1) num ClaimsPrincipal com claims de
/// usuario OU participante. Token ausente ou invalido vira NoResult (nao Fail): GET /session
/// precisa responder 200 com tudo nulo em vez de 401 quando nao ha sessao valida — quem exige
/// autenticacao e o endpoint especifico via RequireAuthorization(), nao este handler.
/// </summary>
public class CodexSessionAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    ISessionTokenService tokenService)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "CodexSession";
    private const string BearerPrefix = "Bearer ";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(HeaderNames.Authorization, out var headerValue))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var raw = headerValue.ToString();
        if (!raw.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var token = raw[BearerPrefix.Length..].Trim();
        if (!tokenService.TryValidate(token, out var payload))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var claims = new List<Claim>();
        if (payload.UserId is { } userId)
        {
            claims.Add(new Claim(CodexClaimTypes.UserId, userId.ToString()));
        }

        if (payload.ParticipantId is { } participantId)
        {
            claims.Add(new Claim(CodexClaimTypes.ParticipantId, participantId.ToString()));
        }

        if (payload.RoomCode is { } roomCode)
        {
            claims.Add(new Claim(CodexClaimTypes.RoomCode, roomCode));
        }

        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
