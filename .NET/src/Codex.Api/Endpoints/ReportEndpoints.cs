using System.Security.Claims;
using Codex.Api.Services.Reports;

namespace Codex.Api.Endpoints;

public record ExportReportRequest(string? Format);

public static class ReportEndpoints
{
    public static void MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        var matchReport = app.MapGroup("/matches/{matchId}/report");

        matchReport.MapGet("/status", async (
            string matchId,
            ReportService reports,
            CancellationToken ct) => Results.Ok(await reports.GetStatusAsync(matchId, ct)));

        matchReport.MapGet("", async (
            string matchId,
            ClaimsPrincipal principal,
            ReportService reports,
            CancellationToken ct) => Results.Ok(await reports.GetMatchReportAsync(matchId, principal, ct)));

        matchReport.MapGet("/me", async (
            string matchId,
            ClaimsPrincipal principal,
            ReportService reports,
            CancellationToken ct) => Results.Ok(await reports.GetMyIndividualReportAsync(matchId, principal, ct)));

        matchReport.MapPost("/export", async (
            string matchId,
            ExportReportRequest? request,
            ReportService reports,
            CancellationToken ct) =>
        {
            await reports.GetStatusAsync(matchId, ct);
            return Results.Ok(new { jobId = matchId, format = request?.Format ?? "pdf" });
        });

        matchReport.MapGet("/export", async (
            string matchId,
            string? format,
            ReportService reports,
            CancellationToken ct) =>
        {
            var (bytes, contentType, fileName) = await reports.ExportByMatchIdAsync(matchId, format ?? "pdf", ct);
            return Results.File(bytes, contentType, fileName);
        });

        app.MapGet("/rooms/{code}/report/resolve", async (
            string code,
            ClaimsPrincipal principal,
            ReportService reports,
            CancellationToken ct) => Results.Ok(await reports.ResolveRoomReportAsync(code, principal, ct)));

        var share = app.MapGroup("/reports");

        share.MapGet("/share/{shareToken}", async (
            string shareToken,
            ReportService reports,
            CancellationToken ct) => Results.Ok(await reports.GetReportByShareTokenAsync(shareToken, ct)));

        share.MapGet("/share/{shareToken}/export", async (
            string shareToken,
            string? format,
            ReportService reports,
            CancellationToken ct) =>
        {
            var (bytes, contentType, fileName) = await reports.ExportByShareTokenAsync(shareToken, format ?? "pdf", ct);
            return Results.File(bytes, contentType, fileName);
        });

        share.MapGet("/individual/{accessToken}", async (
            string accessToken,
            ReportService reports,
            CancellationToken ct) => Results.Ok(await reports.GetIndividualByAccessTokenAsync(accessToken, ct)));

        share.MapGet("/individual/{accessToken}/export", async (
            string accessToken,
            ReportService reports,
            CancellationToken ct) =>
        {
            var (bytes, contentType, fileName) = await reports.ExportIndividualPdfAsync(accessToken, ct);
            return Results.File(bytes, contentType, fileName);
        });

        app.MapGet("/users/{userId}/reports", async (
            string userId,
            ReportService reports,
            CancellationToken ct) => Results.Ok(await reports.GetUserHistoryAsync(userId, ct)));
    }
}
