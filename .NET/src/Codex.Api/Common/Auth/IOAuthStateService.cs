using System.Diagnostics.CodeAnalysis;

namespace Codex.Api.Common.Auth;

public interface IOAuthStateService
{
    string Issue(OAuthStatePayload payload);
    bool TryValidate(string state, [NotNullWhen(true)] out OAuthStatePayload? payload);
}
