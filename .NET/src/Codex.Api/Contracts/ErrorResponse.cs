using System.Text.Json.Serialization;
using Codex.Api.Contracts.Ai;

namespace Codex.Api.Contracts;

/// <summary>Corpo de erro exato descrito em api-rest.md secao 1 (com usage opcional em AI_QUOTA_EXCEEDED).</summary>
public record ErrorResponse(
    string Code,
    string Message,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    AiUsageDto? Usage = null);
