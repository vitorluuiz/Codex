using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Json;
using Codex.Api.Documents;
using Codex.Api.Services.Realtime;
using StackExchange.Redis;

namespace Codex.Api.Services.Reports;

public sealed class ReportService(
    HttpClient http,
    ReportOptions options,
    IMatchDocumentStore store,
    IRealtimeConnection realtimeConnection,
    ILogger<ReportService> logger) : IReportJobDispatcher
{
    private const string RedisQueueKey = "codex:reports:queue";
    private const string RedisChannelName = "codex:reports:jobs";
    private static readonly JsonSerializerOptions JsonOptions = CodexJsonOptions.Create();

    public async Task EnqueueReportGenerationAsync(MatchDocument document, CancellationToken ct)
    {
        var payloadObj = new
        {
            matchId = document.Id,
            roomCode = document.RoomCode,
            matchSnapshot = document,
        };

        // 1. Publica na fila/canal Redis para processamento assincrono pelo servico Node.js
        try
        {
            var mux = await realtimeConnection.GetAsync(ct);
            var db = mux.GetDatabase();
            var sub = mux.GetSubscriber();
            var smallJob = JsonSerializer.Serialize(new { matchId = document.Id, roomCode = document.RoomCode }, JsonOptions);
            await db.ListRightPushAsync(RedisQueueKey, smallJob);
            await sub.PublishAsync(RedisChannel.Literal(RedisChannelName), smallJob);
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Redis indisponivel ao enfileirar relatorio {MatchId}; usando HTTP direto.", document.Id);
        }

        // 2. Dispara chamada HTTP para /internal/jobs (garante entrega mesmo sem Mongo/Redis em dev)
        _ = Task.Run(async () =>
        {
            try
            {
                using var req = CreateRequest(HttpMethod.Post, "/internal/jobs");
                req.Content = JsonContent.Create(payloadObj, options: JsonOptions);
                using var res = await http.SendAsync(req, CancellationToken.None);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Nao foi possivel contatar o servico de relatorios para a partida {MatchId}.", document.Id);
            }
        }, CancellationToken.None);
    }

    private async Task SyncMatchSnapshotIfAvailableAsync(Guid matchId, CancellationToken ct)
    {
        var doc = await store.FindAsync(matchId, ct);
        if (doc is null) return;

        try
        {
            using var req = CreateRequest(HttpMethod.Post, "/internal/jobs");
            req.Content = JsonContent.Create(new
            {
                matchId = doc.Id,
                roomCode = doc.RoomCode,
                matchSnapshot = doc,
            }, options: JsonOptions);
            using var res = await http.SendAsync(req, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Falha ao sincronizar snapshot {MatchId} com o servico de relatorios.", matchId);
        }
    }

    public async Task<JsonElement> GetStatusAsync(string matchId, CancellationToken ct)
    {
        if (Guid.TryParse(matchId, out var id))
        {
            await SyncMatchSnapshotIfAvailableAsync(id, ct);
        }

        return await GetJsonFromReportsAsync($"/reports/matches/{Uri.EscapeDataString(matchId)}/status", ct);
    }

    public async Task<JsonElement> GetMatchReportAsync(string matchId, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (!Guid.TryParse(matchId, out var id))
        {
            throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.MatchNotFound, "Partida não encontrada.");
        }

        var doc = await store.FindAsync(id, ct);
        if (doc is not null)
        {
            var userId = principal.GetUserId();
            if (userId is null || doc.LeaderUserId != userId.Value)
            {
                throw new ApiException(StatusCodes.Status403Forbidden, ErrorCodes.NotRoomLeader, "Apenas o líder da partida pode acessar o relatório consolidado por ID.");
            }
            await SyncMatchSnapshotIfAvailableAsync(id, ct);
        }

        return await GetJsonFromReportsAsync($"/reports/matches/{id}", ct);
    }

    public async Task<JsonElement> GetMyIndividualReportAsync(string matchId, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (!Guid.TryParse(matchId, out var id))
        {
            throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.MatchNotFound, "Partida não encontrada.");
        }

        await SyncMatchSnapshotIfAvailableAsync(id, ct);

        var targetId = principal.GetParticipantId() ?? principal.GetUserId();
        if (targetId is null)
        {
            throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.ParticipantNotFound, "Participante não identificado na sessão.");
        }

        return await GetJsonFromReportsAsync($"/reports/matches/{id}/participants/{targetId.Value}", ct);
    }

    public async Task<object> ResolveRoomReportAsync(string roomCode, ClaimsPrincipal principal, CancellationToken ct)
    {
        var doc = await store.FindLatestByRoomCodeAsync(roomCode, ct)
            ?? throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.MatchNotFound, "Nenhuma partida finalizada encontrada para esta sala.");

        await SyncMatchSnapshotIfAvailableAsync(doc.Id, ct);

        var userId = principal.GetUserId();
        var participantId = principal.GetParticipantId();

        if (userId is not null && doc.LeaderUserId == userId.Value)
        {
            var reportJson = await GetJsonFromReportsAsync($"/reports/matches/{doc.Id}", ct);
            var shareToken = reportJson.TryGetProperty("shareToken", out var st) ? st.GetString() : null;
            return new
            {
                matchId = doc.Id,
                role = "leader",
                shareToken,
                accessToken = (string?)null,
            };
        }

        var targetId = participantId ?? userId;
        if (targetId is not null)
        {
            var indivJson = await GetJsonFromReportsAsync($"/reports/matches/{doc.Id}/participants/{targetId.Value}", ct);
            string? accessToken = null;
            if (indivJson.TryGetProperty("participant", out var partEl) &&
                partEl.TryGetProperty("accessToken", out var atEl))
            {
                accessToken = atEl.GetString();
            }

            return new
            {
                matchId = doc.Id,
                role = "participant",
                shareToken = (string?)null,
                accessToken,
            };
        }

        throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.MatchNotFound, "Você não participou desta partida.");
    }

    public Task<JsonElement> GetReportByShareTokenAsync(string shareToken, CancellationToken ct)
        => GetJsonFromReportsAsync($"/reports/share/{Uri.EscapeDataString(shareToken)}", ct);

    public Task<JsonElement> GetIndividualByAccessTokenAsync(string accessToken, CancellationToken ct)
        => GetJsonFromReportsAsync($"/reports/individual/{Uri.EscapeDataString(accessToken)}", ct);

    public async Task<JsonElement> GetUserHistoryAsync(string userId, CancellationToken ct)
    {
        if (Guid.TryParse(userId, out var id))
        {
            var userMatches = await store.ListByUserAsync(id, 30, ct);
            foreach (var m in userMatches)
            {
                await SyncMatchSnapshotIfAvailableAsync(m.Id, ct);
            }
        }

        return await GetJsonFromReportsAsync($"/reports/users/{Uri.EscapeDataString(userId)}/history", ct);
    }

    public async Task<(byte[] Bytes, string ContentType, string FileName)> ExportByMatchIdAsync(
        string matchId,
        string format,
        CancellationToken ct)
    {
        if (Guid.TryParse(matchId, out var id))
        {
            await SyncMatchSnapshotIfAvailableAsync(id, ct);
        }

        var fmt = string.Equals(format, "xlsx", StringComparison.OrdinalIgnoreCase) ? "xlsx" : "pdf";
        return await GetBinaryFromReportsAsync($"/reports/matches/{Uri.EscapeDataString(matchId)}/export/{fmt}", fmt, ct);
    }

    public Task<(byte[] Bytes, string ContentType, string FileName)> ExportByShareTokenAsync(
        string shareToken,
        string format,
        CancellationToken ct)
    {
        var fmt = string.Equals(format, "xlsx", StringComparison.OrdinalIgnoreCase) ? "xlsx" : "pdf";
        return GetBinaryFromReportsAsync($"/reports/share/{Uri.EscapeDataString(shareToken)}/export/{fmt}", fmt, ct);
    }

    public Task<(byte[] Bytes, string ContentType, string FileName)> ExportIndividualPdfAsync(
        string accessToken,
        CancellationToken ct)
        => GetBinaryFromReportsAsync($"/reports/individual/{Uri.EscapeDataString(accessToken)}/export/pdf", "pdf", ct);

    private HttpRequestMessage CreateRequest(HttpMethod method, string path)
    {
        var baseUrl = options.BaseUrl.TrimEnd('/');
        var req = new HttpRequestMessage(method, $"{baseUrl}{path}");
        if (!string.IsNullOrWhiteSpace(options.ServiceToken))
        {
            req.Headers.TryAddWithoutValidation("x-service-token", options.ServiceToken);
        }
        return req;
    }

    private async Task<JsonElement> GetJsonFromReportsAsync(string path, CancellationToken ct)
    {
        try
        {
            using var req = CreateRequest(HttpMethod.Get, path);
            using var res = await http.SendAsync(req, ct);

            if (res.StatusCode == HttpStatusCode.NotFound)
            {
                throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.MatchNotFound, "Relatório não encontrado.");
            }

            res.EnsureSuccessStatusCode();
            var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            return doc.RootElement.Clone();
        }
        catch (ApiException)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao consultar servico de relatorios em {Path}", path);
            throw new ApiException(StatusCodes.Status503ServiceUnavailable, "REPORTS_UNAVAILABLE", "O serviço de relatórios está temporariamente indisponível.");
        }
    }

    private async Task<(byte[] Bytes, string ContentType, string FileName)> GetBinaryFromReportsAsync(
        string path,
        string ext,
        CancellationToken ct)
    {
        try
        {
            using var req = CreateRequest(HttpMethod.Get, path);
            using var res = await http.SendAsync(req, ct);

            if (res.StatusCode == HttpStatusCode.NotFound)
            {
                throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.MatchNotFound, "Relatório não encontrado para exportação.");
            }

            res.EnsureSuccessStatusCode();
            var bytes = await res.Content.ReadAsByteArrayAsync(ct);
            var contentType = res.Content.Headers.ContentType?.ToString()
                ?? (ext == "xlsx"
                    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    : "application/pdf");
            var fileName = res.Content.Headers.ContentDisposition?.FileName?.Trim('"')
                ?? $"relatorio.{ext}";

            return (bytes, contentType, fileName);
        }
        catch (ApiException)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao exportar arquivo no servico de relatorios em {Path}", path);
            throw new ApiException(StatusCodes.Status503ServiceUnavailable, "REPORTS_UNAVAILABLE", "O serviço de relatórios está temporariamente indisponível.");
        }
    }
}
