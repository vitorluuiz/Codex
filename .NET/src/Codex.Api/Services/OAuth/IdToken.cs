using System.Text.Json;
using Codex.Api.Common.Errors;

namespace Codex.Api.Services.OAuth;

/// <summary>Le o payload de um JWT sem verificar a assinatura — ver a justificativa em <see cref="OpenIdConnectClient"/>.</summary>
public static class IdToken
{
    public static JsonDocument ReadClaims(string idToken)
    {
        var segments = idToken.Split('.');
        if (segments.Length < 2)
        {
            throw OAuthErrors.ExchangeFailed("id_token com formato inesperado.");
        }

        try
        {
            return JsonDocument.Parse(Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlDecode(segments[1]));
        }
        catch (Exception exception) when (exception is FormatException or JsonException)
        {
            throw OAuthErrors.ExchangeFailed("id_token ilegivel.");
        }
    }

    public static string? String(this JsonElement claims, string name)
        => claims.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>O <c>email_verified</c> chega como booleano no Google e ja apareceu como string em outros provedores OIDC; aceita os dois.</summary>
    public static bool Bool(this JsonElement claims, string name)
    {
        if (!claims.TryGetProperty(name, out var value))
        {
            return false;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.String => bool.TryParse(value.GetString(), out var parsed) && parsed,
            _ => false,
        };
    }
}
