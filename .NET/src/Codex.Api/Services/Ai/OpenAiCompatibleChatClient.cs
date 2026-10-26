using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Codex.Api.Services.Ai;

public static class AiHttpClients
{
    public const string Name = "ai";
}

/// <summary>
/// Cliente unico para qualquer provedor que exponha <c>/v1/chat/completions</c> no formato da
/// OpenAI (LM Studio local, Gemini <c>/v1beta/openai</c>, OpenRouter, Groq, OpenAI).
/// </summary>
public class OpenAiCompatibleChatClient(IHttpClientFactory httpClientFactory) : IAiChatClient
{
    public async Task<AiChatResult> CompleteJsonAsync(
        AiProviderOptions provider,
        string systemPrompt,
        string userPrompt,
        JsonObject jsonSchema,
        CancellationToken ct)
    {
        var effectiveSystemPrompt = provider.SupportsJsonSchema
            ? systemPrompt
            : $"{systemPrompt}\n\nResponda APENAS com um objeto JSON valido seguindo exatamente este JSON Schema:\n{jsonSchema.ToJsonString()}";

        var responseFormat = provider.SupportsJsonSchema
            ? new JsonObject
            {
                ["type"] = "json_schema",
                ["json_schema"] = new JsonObject
                {
                    ["name"] = "codex_output",
                    ["strict"] = true,
                    ["schema"] = jsonSchema.DeepClone(),
                },
            }
            : new JsonObject
            {
                ["type"] = "json_object",
            };

        var payload = new JsonObject
        {
            ["model"] = provider.Model,
            ["temperature"] = provider.Temperature,
            ["messages"] = new JsonArray
            {
                new JsonObject { ["role"] = "system", ["content"] = effectiveSystemPrompt },
                new JsonObject { ["role"] = "user", ["content"] = userPrompt },
            },
            ["response_format"] = responseFormat,
        };

        var endpoint = $"{provider.BaseUrl.TrimEnd('/')}/chat/completions";
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json"),
        };

        if (!string.IsNullOrWhiteSpace(provider.ApiKey))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", provider.ApiKey.Trim());
        }

        var client = httpClientFactory.CreateClient(AiHttpClients.Name);
        var timeoutSeconds = provider.TimeoutSeconds > 0 ? provider.TimeoutSeconds : 60;
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));

        var stopwatch = Stopwatch.StartNew();
        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, timeoutCts.Token);
        }
        catch (OperationCanceledException ex) when (!ct.IsCancellationRequested)
        {
            throw new AiProviderUnavailableException("Tempo limite esgotado ao aguardar resposta do modelo de IA.", ex);
        }
        catch (HttpRequestException ex)
        {
            throw new AiProviderUnavailableException("Nao foi possivel conectar ao provedor de IA.", ex);
        }

        using (response)
        {
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                throw new AiProviderBusyException("O provedor de IA atingiu o limite de requisicoes.");
            }

            if (!response.IsSuccessStatusCode)
            {
                throw new AiProviderUnavailableException($"O provedor de IA respondeu com HTTP {(int)response.StatusCode}.");
            }

            string body;
            try
            {
                body = await response.Content.ReadAsStringAsync(timeoutCts.Token);
            }
            catch (OperationCanceledException ex) when (!ct.IsCancellationRequested)
            {
                throw new AiProviderUnavailableException("Tempo limite esgotado ao ler resposta do modelo de IA.", ex);
            }

            stopwatch.Stop();
            return ParseCompletionResponse(body, (int)stopwatch.ElapsedMilliseconds);
        }
    }

    public static AiChatResult ParseCompletionResponse(string body, int latencyMs)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(body);
        }
        catch (JsonException ex)
        {
            throw new AiProviderUnavailableException("Resposta do provedor de IA nao e um JSON valido.", ex);
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (!root.TryGetProperty("choices", out var choices) ||
                choices.ValueKind != JsonValueKind.Array ||
                choices.GetArrayLength() == 0)
            {
                throw new AiProviderUnavailableException("Resposta do provedor de IA nao contem choices.");
            }

            var firstChoice = choices[0];
            if (!firstChoice.TryGetProperty("message", out var message) ||
                !message.TryGetProperty("content", out var contentElement) ||
                contentElement.ValueKind != JsonValueKind.String)
            {
                throw new AiProviderUnavailableException("Resposta do provedor de IA nao contem message.content.");
            }

            var rawContent = contentElement.GetString() ?? string.Empty;
            var cleanedJson = StripMarkdownFences(rawContent);

            int? promptTokens = null;
            int? completionTokens = null;
            if (root.TryGetProperty("usage", out var usage) && usage.ValueKind == JsonValueKind.Object)
            {
                if (usage.TryGetProperty("prompt_tokens", out var pt) && pt.TryGetInt32(out var ptVal))
                {
                    promptTokens = ptVal;
                }

                if (usage.TryGetProperty("completion_tokens", out var ct) && ct.TryGetInt32(out var ctVal))
                {
                    completionTokens = ctVal;
                }
            }

            return new AiChatResult(cleanedJson, promptTokens, completionTokens, latencyMs);
        }
    }

    /// <summary>Remove cercas ```json ... ``` que alguns modelos locais adicionam mesmo com json_schema.</summary>
    public static string StripMarkdownFences(string text)
    {
        var trimmed = text.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            return trimmed;
        }

        var firstNewLine = trimmed.IndexOf('\n');
        if (firstNewLine >= 0)
        {
            trimmed = trimmed[(firstNewLine + 1)..];
        }
        else
        {
            trimmed = trimmed[3..];
        }

        trimmed = trimmed.TrimEnd();
        if (trimmed.EndsWith("```", StringComparison.Ordinal))
        {
            trimmed = trimmed[..^3];
        }

        return trimmed.Trim();
    }
}
