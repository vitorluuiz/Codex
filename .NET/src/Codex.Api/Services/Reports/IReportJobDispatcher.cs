using Codex.Api.Documents;

namespace Codex.Api.Services.Reports;

public interface IReportJobDispatcher
{
    Task EnqueueReportGenerationAsync(MatchDocument document, CancellationToken ct);
}
