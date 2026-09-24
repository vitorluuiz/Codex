using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace Codex.Api.Common.Auth;

/// <summary>
/// Mesmo desenho do <see cref="SessionTokenService"/>, com um Purpose proprio: o state e opaco
/// e protegido por Data Protection, cujas chaves ja vivem no Postgres (Program.cs). Escolhido
/// no lugar de guardar o fluxo pendente no Redis porque o Redis e opcional em desenvolvimento
/// e porque assim o state sobrevive a restart e a mais de uma instancia da API sem store novo.
///
/// O preco e nao haver uso unico no servidor: o mesmo state decifra quantas vezes vier. A
/// protecao contra replay fica com o proprio provedor, que invalida o <c>code</c> no primeiro
/// uso, e com o cookie de state que o Next apaga no callback.
/// </summary>
public class OAuthStateService : IOAuthStateService
{
    private const string Purpose = "Codex.Api.OAuthState.v1";
    private readonly IDataProtector _protector;

    public OAuthStateService(IDataProtectionProvider provider)
    {
        _protector = provider.CreateProtector(Purpose);
    }

    public string Issue(OAuthStatePayload payload)
        => _protector.Protect(JsonSerializer.Serialize(payload));

    public bool TryValidate(string state, [NotNullWhen(true)] out OAuthStatePayload? payload)
    {
        payload = null;
        if (string.IsNullOrWhiteSpace(state))
        {
            return false;
        }

        string json;
        try
        {
            json = _protector.Unprotect(state);
        }
        catch (CryptographicException)
        {
            return false;
        }
        catch (FormatException)
        {
            return false;
        }

        var decoded = JsonSerializer.Deserialize<OAuthStatePayload>(json);
        if (decoded is null || decoded.IsExpired)
        {
            return false;
        }

        payload = decoded;
        return true;
    }
}
