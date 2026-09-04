using System.Security.Cryptography;
using System.Text;
using Codex.Api.Common.Errors;

namespace Codex.Api.Common.Auth;

/// <summary>
/// api-rest.md secao 1: "x-service-token prova que a chamada veio do servidor do Next, nao de
/// um cliente". Roda antes da autenticacao de sessao e recusa qualquer chamada sem o segredo
/// compartilhado, exceto /health e /metrics (usados por infra/orquestrador e Prometheus,
/// sem contexto de sessao).
/// Falha fechado se o segredo nao estiver configurado — preferimos quebrar em dev sem
/// user-secrets configurado a rodar em prod aceitando qualquer chamada.
/// </summary>
public class ServiceTokenMiddleware(RequestDelegate next, IConfiguration configuration, ILogger<ServiceTokenMiddleware> logger)
{
    private const string HeaderName = "x-service-token";
    private static readonly string[] ExemptPaths = ["/health", "/metrics"];

    public async Task InvokeAsync(HttpContext context)
    {
        if (ExemptPaths.Contains(context.Request.Path.Value))
        {
            await next(context);
            return;
        }

        var expected = configuration["CodexApi:ServiceToken"];
        if (string.IsNullOrEmpty(expected))
        {
            logger.LogCritical("CodexApi:ServiceToken nao configurado. Use 'dotnet user-secrets set CodexApi:ServiceToken <valor>' em dev ou a variavel de ambiente CodexApi__ServiceToken em producao.");
            throw new ApiException(StatusCodes.Status500InternalServerError, "SERVICE_TOKEN_NOT_CONFIGURED", "Servico nao configurado corretamente.");
        }

        var provided = context.Request.Headers[HeaderName].ToString();
        var providedBytes = Encoding.UTF8.GetBytes(provided);
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        if (!CryptographicOperations.FixedTimeEquals(providedBytes, expectedBytes))
        {
            throw new ApiException(StatusCodes.Status401Unauthorized, "INVALID_SERVICE_TOKEN", "Chamada nao autorizada.");
        }

        await next(context);
    }
}
