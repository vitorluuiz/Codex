using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Codex.Api.Services.Ai;

namespace Codex.Api.Tests;

public class OpenAiCompatibleChatClientTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    [Fact]
    public async Task Sends_json_schema_response_format_when_supported_and_parses_usage()
    {
        string? capturedBody = null;
        string? capturedAuth = null;
        Uri? capturedUri = null;

        var handler = new StubHttpMessageHandler((req, _) =>
        {
            capturedUri = req.RequestUri;
            capturedAuth = req.Headers.Authorization?.ToString();
            capturedBody = req.Content!.ReadAsStringAsync(Ct).GetAwaiter().GetResult();

            var responseJson = """
            {
              "choices": [
                {
                  "message": {
                    "content": "```json\n{\"name\":\"Quiz 1\",\"question\":\"Quanto e 2+2?\"}\n```"
                  }
                }
              ],
              "usage": {
                "prompt_tokens": 120,
                "completion_tokens": 45
              }
            }
            """;

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(responseJson, Encoding.UTF8, "application/json"),
            });
        });

        var client = new OpenAiCompatibleChatClient(new StubHttpClientFactory(handler));
        var provider = new AiProviderOptions
        {
            BaseUrl = "https://example.ai/v1/",
            ApiKey = "secret-key",
            Model = "gemini-2.5-flash",
            SupportsJsonSchema = true,
            Temperature = 0.5,
            TimeoutSeconds = 30,
        };

        var schema = new JsonObject { ["type"] = "object" };
        var result = await client.CompleteJsonAsync(provider, "System rule", "User topic", schema, Ct);

        Assert.Equal("https://example.ai/v1/chat/completions", capturedUri?.ToString());
        Assert.Equal("Bearer secret-key", capturedAuth);
        Assert.Equal("{\"name\":\"Quiz 1\",\"question\":\"Quanto e 2+2?\"}", result.Json);
        Assert.Equal(120, result.PromptTokens);
        Assert.Equal(45, result.CompletionTokens);

        using var doc = JsonDocument.Parse(capturedBody!);
        var root = doc.RootElement;
        Assert.Equal("gemini-2.5-flash", root.GetProperty("model").GetString());
        Assert.Equal("json_schema", root.GetProperty("response_format").GetProperty("type").GetString());
    }

    [Fact]
    public async Task Falls_back_to_json_object_and_embeds_schema_in_system_prompt_when_SupportsJsonSchema_is_false()
    {
        string? capturedBody = null;

        var handler = new StubHttpMessageHandler((req, _) =>
        {
            capturedBody = req.Content!.ReadAsStringAsync(Ct).GetAwaiter().GetResult();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{"choices":[{"message":{"content":"{\"ok\":true}"}}]}""", Encoding.UTF8, "application/json"),
            });
        });

        var client = new OpenAiCompatibleChatClient(new StubHttpClientFactory(handler));
        var provider = new AiProviderOptions
        {
            BaseUrl = "http://localhost:1234/v1",
            ApiKey = "lm-studio",
            Model = "qwen2.5-7b-instruct",
            SupportsJsonSchema = false,
        };

        var schema = new JsonObject { ["type"] = "object", ["title"] = "CustomPhaseSchema" };
        await client.CompleteJsonAsync(provider, "Base system", "User prompt", schema, Ct);

        using var doc = JsonDocument.Parse(capturedBody!);
        var root = doc.RootElement;
        Assert.Equal("json_object", root.GetProperty("response_format").GetProperty("type").GetString());
        var sysContent = root.GetProperty("messages")[0].GetProperty("content").GetString();
        Assert.Contains("CustomPhaseSchema", sysContent);
    }

    [Fact]
    public async Task Maps_http_429_to_AiProviderBusyException_and_5xx_to_AiProviderUnavailableException()
    {
        var busyHandler = new StubHttpMessageHandler((_, _) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.TooManyRequests)));
        var busyClient = new OpenAiCompatibleChatClient(new StubHttpClientFactory(busyHandler));

        var provider = new AiProviderOptions
        {
            BaseUrl = "https://example.ai/v1",
            ApiKey = "key",
            Model = "m",
        };

        await Assert.ThrowsAsync<AiProviderBusyException>(() =>
            busyClient.CompleteJsonAsync(provider, "sys", "usr", new JsonObject(), Ct));

        var downHandler = new StubHttpMessageHandler((_, _) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadGateway)));
        var downClient = new OpenAiCompatibleChatClient(new StubHttpClientFactory(downHandler));

        await Assert.ThrowsAsync<AiProviderUnavailableException>(() =>
            downClient.CompleteJsonAsync(provider, "sys", "usr", new JsonObject(), Ct));
    }

    private sealed class StubHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class StubHttpMessageHandler(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responder) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => responder(request, cancellationToken);
    }
}
