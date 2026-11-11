using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Json;
using Codex.Api.Contracts.Ai;
using Codex.Api.Documents;
using Codex.Api.Services.Ai;
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

    public async Task<AiReportReviewResponse> RunAiReviewAsync(
        string matchId,
        ClaimsPrincipal principal,
        AiService ai,
        CancellationToken ct)
    {
        if (!Guid.TryParse(matchId, out var id))
        {
            throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.MatchNotFound, "Partida não encontrada.");
        }

        var userId = principal.GetUserId()
            ?? throw new ApiException(StatusCodes.Status401Unauthorized, ErrorCodes.Unauthenticated, "Autenticação necessária.");

        var doc = await store.FindAsync(id, ct);
        if (doc is not null)
        {
            if (doc.LeaderUserId != userId)
            {
                throw new ApiException(StatusCodes.Status403Forbidden, ErrorCodes.NotRoomLeader, "Apenas o líder da partida pode solicitar a revisão pedagógica por IA.");
            }
            await SyncMatchSnapshotIfAvailableAsync(id, ct);
        }

        var reportJson = await GetJsonFromReportsAsync($"/reports/matches/{id}", ct);
        if (doc is null &&
            reportJson.TryGetProperty("leaderUserId", out var leaderEl) &&
            Guid.TryParse(leaderEl.GetString(), out var reportLeaderId) &&
            reportLeaderId != userId)
        {
            throw new ApiException(StatusCodes.Status403Forbidden, ErrorCodes.NotRoomLeader, "Apenas o líder da partida pode solicitar a revisão pedagógica por IA.");
        }

        var phaseInputs = ExtractPhaseInputItems(reportJson);
        var response = await ai.ReviewReportQuestionsAsync(id.ToString(), phaseInputs, principal, ct);

        await PutJsonToReportsAsync(
            $"/internal/reports/matches/{id}/ai-review",
            response.AiReview,
            ct);

        return response;
    }

    private static IReadOnlyList<ReportPhaseInputItem> ExtractPhaseInputItems(JsonElement reportJson)
    {
        var hintByPhaseId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (reportJson.TryGetProperty("insights", out var insightsEl) &&
            insightsEl.ValueKind == JsonValueKind.Object &&
            insightsEl.TryGetProperty("questions", out var questionsEl) &&
            questionsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var q in questionsEl.EnumerateArray())
            {
                var pId = q.TryGetProperty("phaseId", out var pidEl) ? pidEl.GetString() : null;
                if (string.IsNullOrWhiteSpace(pId)) continue;

                var hints = new List<string>();
                if (q.TryGetProperty("flags", out var flagsEl) && flagsEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var fl in flagsEl.EnumerateArray())
                    {
                        var flagStr = fl.GetString();
                        if (!string.IsNullOrWhiteSpace(flagStr)) hints.Add(flagStr);
                    }
                }
                if (q.TryGetProperty("topDistractor", out var tdEl) && tdEl.ValueKind == JsonValueKind.Object)
                {
                    var lbl = tdEl.TryGetProperty("label", out var lEl) ? lEl.GetString() : null;
                    var pct = tdEl.TryGetProperty("percentage", out var pEl) && pEl.TryGetInt32(out var pv) ? pv : 0;
                    var upPct = tdEl.TryGetProperty("upperGroupPercentage", out var uEl) && uEl.TryGetInt32(out var uv) ? uv : 0;
                    if (!string.IsNullOrWhiteSpace(lbl))
                    {
                        hints.Add($"distrator mais escolhido: \"{lbl}\" ({pct}% da turma, {upPct}% dos melhores alunos)");
                    }
                }

                if (hints.Count > 0)
                {
                    hintByPhaseId[pId] = string.Join("; ", hints);
                }
            }
        }

        var items = new List<ReportPhaseInputItem>();
        if (reportJson.TryGetProperty("phases", out var phasesEl) && phasesEl.ValueKind == JsonValueKind.Array)
        {
            var idx = 1;
            foreach (var ph in phasesEl.EnumerateArray())
            {
                var phaseId = ph.TryGetProperty("phaseId", out var idEl) ? idEl.GetString() ?? $"phase-{idx}" : $"phase-{idx}";
                var phaseNumber = ph.TryGetProperty("phaseNumber", out var numEl) && numEl.TryGetInt32(out var nv) ? nv : idx;
                var kind = ph.TryGetProperty("kind", out var kEl) ? kEl.GetString() ?? "quiz" : "quiz";
                var name = ph.TryGetProperty("name", out var nEl) ? nEl.GetString() ?? $"Fase {phaseNumber}" : $"Fase {phaseNumber}";
                var question = ph.TryGetProperty("question", out var qEl) ? qEl.GetString() ?? name : name;
                var correctAnswerText = ph.TryGetProperty("correctAnswerText", out var cEl) ? cEl.GetString() ?? "—" : "—";
                var accuracyRate = ph.TryGetProperty("accuracyRate", out var aEl) && aEl.TryGetInt32(out var av) ? av : 0;

                var optionsList = new List<string>();
                if (ph.TryGetProperty("optionDistribution", out var optDistEl) && optDistEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var opt in optDistEl.EnumerateArray())
                    {
                        var label = opt.TryGetProperty("label", out var lEl) ? lEl.GetString() : null;
                        var isCorrect = opt.TryGetProperty("isCorrect", out var icEl) && icEl.ValueKind == JsonValueKind.True;
                        if (!string.IsNullOrWhiteSpace(label))
                        {
                            optionsList.Add(isCorrect ? $"[CORRETA] {label}" : $"[DISTRATOR] {label}");
                        }
                    }
                }

                hintByPhaseId.TryGetValue(phaseId, out var hint);
                items.Add(new ReportPhaseInputItem(
                    PhaseId: phaseId,
                    PhaseNumber: phaseNumber,
                    Kind: kind,
                    Name: name,
                    Question: question,
                    CorrectAnswerText: correctAnswerText,
                    AccuracyRate: accuracyRate,
                    Options: optionsList,
                    StatisticalHint: hint));

                idx++;
            }
        }

        return items;
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

    public Task<JsonElement> GetUserHistoryAsync(string userId, CancellationToken ct)
        => GetJsonFromReportsAsync($"/reports/users/{Uri.EscapeDataString(userId)}/history", ct);

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

    private async Task PutJsonToReportsAsync<T>(string path, T payload, CancellationToken ct)
    {
        try
        {
            using var req = CreateRequest(HttpMethod.Put, path);
            req.Content = JsonContent.Create(payload, options: JsonOptions);
            using var res = await http.SendAsync(req, ct);
            if (res.StatusCode == HttpStatusCode.NotFound)
            {
                throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.MatchNotFound, "Relatório não encontrado.");
            }
            res.EnsureSuccessStatusCode();
        }
        catch (ApiException)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao gravar no servico de relatorios em {Path}", path);
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
