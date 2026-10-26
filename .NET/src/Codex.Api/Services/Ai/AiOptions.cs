using Codex.Api.Domain;

namespace Codex.Api.Services.Ai;

/// <summary>
/// Secao <c>CodexApi:Ai</c>. Um perfil sem <c>BaseUrl</c>, <c>ApiKey</c> ou <c>Model</c> e tratado
/// como nao configurado (501 AI_NOT_CONFIGURED), no mesmo padrao do OAuth.
/// </summary>
public class AiOptions
{
    public const string SectionName = "CodexApi:Ai";

    public bool Enabled { get; set; } = true;
    public string DefaultProvider { get; set; } = "local";
    public string? FallbackProvider { get; set; }

    public Dictionary<string, AiProviderOptions> Providers { get; set; } = new(StringComparer.OrdinalIgnoreCase)
    {
        ["local"] = new()
        {
            BaseUrl = "http://localhost:1234/v1",
            ApiKey = "lm-studio",
            Model = "qwen2.5-7b-instruct",
            TimeoutSeconds = 120,
            MaxConcurrency = 1,
            SupportsJsonSchema = true,
            Temperature = 0.7,
        },
        ["cloud"] = new()
        {
            BaseUrl = "https://generativelanguage.googleapis.com/v1beta/openai",
            ApiKey = string.Empty,
            Model = "gemini-2.5-flash",
            TimeoutSeconds = 45,
            MaxConcurrency = 16,
            SupportsJsonSchema = true,
            Temperature = 0.7,
        },
    };

    public Dictionary<string, string> PlanProviders { get; set; } = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Free"] = "local",
        ["Intermediate"] = "local",
        ["Pro"] = "cloud",
    };

    public AiQuotasOptions Quotas { get; set; } = new();
    public AiCostsOptions Costs { get; set; } = new();
    public int MaxVariationsPerRequest { get; set; } = 5;
    public int InflightLockSeconds { get; set; } = 180;

    public AiPlanQuotaOptions GetQuotaFor(UserPlan plan) => plan switch
    {
        UserPlan.Intermediate => Quotas.Intermediate,
        UserPlan.Pro => Quotas.Pro,
        _ => Quotas.Free,
    };

    public string GetProviderNameFor(UserPlan plan)
    {
        foreach (var (key, value) in PlanProviders)
        {
            if (string.Equals(key, plan.ToString(), StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return DefaultProvider;
    }
}

public class AiProviderOptions
{
    public string BaseUrl { get; set; } = string.Empty;
    public string ApiKey { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public int TimeoutSeconds { get; set; } = 60;
    public int MaxConcurrency { get; set; } = 1;
    public bool SupportsJsonSchema { get; set; } = true;
    public double Temperature { get; set; } = 0.7;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(BaseUrl) &&
        !string.IsNullOrWhiteSpace(ApiKey) &&
        !string.IsNullOrWhiteSpace(Model);
}

public class AiQuotasOptions
{
    public string Period { get; set; } = "Monthly";
    public AiPlanQuotaOptions Free { get; set; } = new() { Credits = 20, DailySuggestions = 30 };
    public AiPlanQuotaOptions Intermediate { get; set; } = new() { Credits = 150, DailySuggestions = 200 };
    public AiPlanQuotaOptions Pro { get; set; } = new() { Credits = 600, DailySuggestions = 1000 };
}

public class AiPlanQuotaOptions
{
    public int Credits { get; set; } = 20;
    public int DailySuggestions { get; set; } = 30;
}

public class AiCostsOptions
{
    public int Phase { get; set; } = 1;
    public int Variation { get; set; } = 1;
    public int QuizOptions { get; set; } = 0;
}
