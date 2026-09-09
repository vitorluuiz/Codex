using System.Security.Cryptography;
using System.Text;

namespace Codex.Api.Services.OAuth;

/// <summary>RFC 7636, metodo S256. O verifier viaja dentro do state protegido; so o challenge vai para o provedor.</summary>
public static class Pkce
{
    public static string CreateVerifier()
        => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string Challenge(string verifier)
        => Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    private static string Base64Url(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
