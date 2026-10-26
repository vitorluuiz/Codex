using Codex.Api.Contracts.Ai;

namespace Codex.Api.Common.Errors;

/// <summary>
/// Excecao de dominio que carrega o {code, message} exigido pelo contrato de erro
/// (api-rest.md secao 1). Servicos lancam isto; <c>ApiExceptionHandler</c> traduz para JSON.
/// </summary>
public class ApiException(int statusCode, string code, string message, AiUsageDto? usage = null) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public string Code { get; } = code;
    public AiUsageDto? Usage { get; } = usage;
}
