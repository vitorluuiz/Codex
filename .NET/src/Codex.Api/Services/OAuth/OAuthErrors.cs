using Codex.Api.Common.Errors;

namespace Codex.Api.Services.OAuth;

public static class OAuthErrors
{
    /// <summary>502 e nao 500: quem falhou foi o provedor, nao esta API.</summary>
    public static ApiException ExchangeFailed(string detail)
        => new(StatusCodes.Status502BadGateway, ErrorCodes.OAuthExchangeFailed, $"Nao foi possivel concluir o login com o provedor. {detail}");
}
