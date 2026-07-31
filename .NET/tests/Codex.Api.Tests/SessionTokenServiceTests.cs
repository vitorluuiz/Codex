using Codex.Api.Common.Auth;
using Microsoft.AspNetCore.DataProtection;

namespace Codex.Api.Tests;

public class SessionTokenServiceTests
{
    private static SessionTokenService CreateService() => new(new EphemeralDataProtectionProvider());

    [Fact]
    public void Issue_then_validate_roundtrips_the_payload()
    {
        var service = CreateService();
        var userId = Guid.NewGuid();
        var payload = new SessionTokenPayload(userId, null, null, DateTimeOffset.UtcNow.AddHours(1));

        var token = service.Issue(payload);
        var valid = service.TryValidate(token, out var decoded);

        Assert.True(valid);
        Assert.Equal(userId, decoded!.UserId);
        Assert.Null(decoded.ParticipantId);
    }

    [Fact]
    public void TryValidate_rejects_expired_token()
    {
        var service = CreateService();
        var payload = new SessionTokenPayload(Guid.NewGuid(), null, null, DateTimeOffset.UtcNow.AddMinutes(-1));

        var token = service.Issue(payload);
        var valid = service.TryValidate(token, out _);

        Assert.False(valid);
    }

    [Fact]
    public void TryValidate_rejects_garbage_input()
    {
        var service = CreateService();

        var valid = service.TryValidate("not-a-real-token", out var payload);

        Assert.False(valid);
        Assert.Null(payload);
    }
}
