using Codex.Api.Common.Auth;

namespace Codex.Api.Services.Reports;

public static class ReportServiceCollectionExtensions
{
    public static IServiceCollection AddCodexReports(this IServiceCollection services, IConfiguration configuration)
    {
        var options = new ReportOptions();
        configuration.GetSection(ReportOptions.SectionName).Bind(options);

        if (string.IsNullOrWhiteSpace(options.ServiceToken))
        {
            options.ServiceToken = configuration["CodexApi:ServiceToken"] ?? string.Empty;
        }

        services.AddSingleton(options);
        services.AddHttpClient<ReportService>(client =>
        {
            client.Timeout = TimeSpan.FromSeconds(15);
        });
        services.AddScoped<IReportJobDispatcher>(sp => sp.GetRequiredService<ReportService>());

        return services;
    }
}
