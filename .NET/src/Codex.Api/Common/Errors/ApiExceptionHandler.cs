using Codex.Api.Contracts;
using Microsoft.AspNetCore.Diagnostics;

namespace Codex.Api.Common.Errors;

/// <summary>
/// Handler global de excecoes (api-rest.md secao 1: erros sempre JSON, sempre com "code"
/// estavel). ApiException vira o erro de dominio esperado; qualquer outra excecao vira
/// 500/INTERNAL_ERROR generico e vai pro log — a UI trata isso como falha de rede.
/// </summary>
public class ApiExceptionHandler(ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var (statusCode, response) = exception switch
        {
            ApiException apiException => (apiException.StatusCode, new ErrorResponse(apiException.Code, apiException.Message, apiException.Usage)),
            _ => (StatusCodes.Status500InternalServerError, new ErrorResponse("INTERNAL_ERROR", "Erro interno do servidor.")),
        };

        if (statusCode == StatusCodes.Status500InternalServerError)
        {
            logger.LogError(exception, "Unhandled exception on {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);
        }

        httpContext.Response.StatusCode = statusCode;
        await httpContext.Response.WriteAsJsonAsync(response, cancellationToken);
        return true;
    }
}
