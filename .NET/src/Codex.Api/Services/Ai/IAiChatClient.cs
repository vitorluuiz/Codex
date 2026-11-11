using System.Text.Json.Nodes;

namespace Codex.Api.Services.Ai;

public interface IAiChatClient
{
    Task<AiChatResult> CompleteJsonAsync(
        AiProviderOptions provider,
        string systemPrompt,
        string userPrompt,
        JsonObject jsonSchema,
        CancellationToken ct);
}

public sealed record AiChatResult(
    string Json,
    int? PromptTokens,
    int? CompletionTokens,
    int LatencyMs);

public class AiProviderUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

public class AiProviderBusyException(string message, Exception? inner = null) : Exception(message, inner);
