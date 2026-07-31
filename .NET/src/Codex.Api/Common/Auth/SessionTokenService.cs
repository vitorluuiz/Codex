using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace Codex.Api.Common.Auth;

/// <summary>
/// Token de sessao opaco (nao-JWT), protegido via ASP.NET Core Data Protection. Escolhido no
/// lugar de JWT para nao introduzir uma segunda dependencia de assinatura/chave: o token so
/// precisa ser lido por este mesmo backend (o browser nunca fala com a API diretamente —
/// api-rest.md secao 1), entao nao ha necessidade de um formato verificavel por terceiros.
/// Trocar para JWT depois exige mudar somente esta classe.
/// </summary>
public class SessionTokenService : ISessionTokenService
{
    private const string Purpose = "Codex.Api.SessionToken.v1";
    private readonly IDataProtector _protector;

    public SessionTokenService(IDataProtectionProvider provider)
    {
        _protector = provider.CreateProtector(Purpose);
    }

    public string Issue(SessionTokenPayload payload)
    {
        var json = JsonSerializer.Serialize(payload);
        return _protector.Protect(json);
    }

    public bool TryValidate(string token, [NotNullWhen(true)] out SessionTokenPayload? payload)
    {
        payload = null;
        if (string.IsNullOrWhiteSpace(token))
        {
            return false;
        }

        string json;
        try
        {
            json = _protector.Unprotect(token);
        }
        catch (CryptographicException)
        {
            return false;
        }
        catch (FormatException)
        {
            return false;
        }

        var decoded = JsonSerializer.Deserialize<SessionTokenPayload>(json);
        if (decoded is null || decoded.IsExpired)
        {
            return false;
        }

        payload = decoded;
        return true;
    }
}
