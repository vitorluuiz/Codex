namespace Codex.Api.Services.Reports;

public sealed class ReportOptions
{
    public const string SectionName = "CodexApi:Reports";

    /// <summary>URL interna do servico Node.js de relatorios.</summary>
    public string BaseUrl { get; set; } = "http://localhost:4002";

    public string ServiceToken { get; set; } = string.Empty;
}
