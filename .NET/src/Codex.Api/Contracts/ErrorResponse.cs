namespace Codex.Api.Contracts;

/// <summary>Corpo de erro exato descrito em api-rest.md secao 1.</summary>
public record ErrorResponse(string Code, string Message);
