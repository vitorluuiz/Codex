using Codex.Api.Common.Auth;
using Codex.Api.Domain;
using Microsoft.AspNetCore.DataProtection;

namespace Codex.Api.Tests;

public class OAuthStateServiceTests
{
    private static OAuthStateService CreateService()
        => new(new EphemeralDataProtectionProvider());

    private static OAuthStatePayload Payload(DateTimeOffset? expiresAt = null)
        => new(OAuthProvider.Google, "/perfil", "verifier", expiresAt ?? DateTimeOffset.UtcNow.AddMinutes(10));

    [Fact]
    public void Round_trips_the_pending_flow()
    {
        var service = CreateService();
        var issued = Payload();

        Assert.True(service.TryValidate(service.Issue(issued), out var decoded));
        Assert.Equal(issued.Provider, decoded.Provider);
        Assert.Equal(issued.RedirectTo, decoded.RedirectTo);
        Assert.Equal(issued.CodeVerifier, decoded.CodeVerifier);
    }

    [Fact]
    public void Rejects_an_expired_state()
    {
        var service = CreateService();

        var state = service.Issue(Payload(DateTimeOffset.UtcNow.AddSeconds(-1)));

        Assert.False(service.TryValidate(state, out _));
    }

    [Fact]
    public void Rejects_a_tampered_state()
    {
        var service = CreateService();
        var state = service.Issue(Payload());

        Assert.False(service.TryValidate(state[..^4] + "AAAA", out _));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("nao-e-um-state")]
    public void Rejects_garbage(string state)
        => Assert.False(CreateService().TryValidate(state, out _));

    [Fact]
    public void Rejects_a_state_from_another_key_ring()
    {
        // Duas instalacoes diferentes nao compartilham chaves de Data Protection.
        var state = CreateService().Issue(Payload());

        Assert.False(CreateService().TryValidate(state, out _));
    }

    [Fact]
    public void Does_not_share_the_purpose_with_the_session_token()
    {
        var protection = new EphemeralDataProtectionProvider();
        var state = new OAuthStateService(protection).Issue(Payload());

        // O mesmo key ring, outro Purpose: um state nunca vira um token de sessao valido.
        Assert.False(new SessionTokenService(protection).TryValidate(state, out _));
    }
}
