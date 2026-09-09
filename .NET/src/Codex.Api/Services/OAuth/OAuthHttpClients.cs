namespace Codex.Api.Services.OAuth;

public static class OAuthHttpClients
{
    /// <summary>Nome do HttpClient compartilhado pelos tres provedores (timeout curto e User-Agent proprio; ver Program.cs).</summary>
    public const string Name = "oauth";
}
