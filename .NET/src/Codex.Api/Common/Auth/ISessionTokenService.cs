using System.Diagnostics.CodeAnalysis;

namespace Codex.Api.Common.Auth;

public interface ISessionTokenService
{
    string Issue(SessionTokenPayload payload);

    bool TryValidate(string token, [NotNullWhen(true)] out SessionTokenPayload? payload);
}
