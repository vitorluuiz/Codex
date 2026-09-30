using System.Text.Json;
using System.Text.Json.Serialization;
using Codex.Api.Domain;

namespace Codex.Api.Services.Redis;

/// <summary>
/// Tipos de dados serializados no Redis. Todos usam o mesmo <see cref="Options"/> (camelCase,
/// ignora nulos) para manter o JSON compacto e legivel diretamente no redis-cli.
/// </summary>
public static class RoomRedisData
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

    public static T? Deserialize<T>(string? json)
    {
        if (string.IsNullOrEmpty(json)) return default;
        try { return JsonSerializer.Deserialize<T>(json, Options); }
        catch (JsonException) { return default; }
    }

    // ── Conversores de data ────────────────────────────────────────────────────────────────────

    public static long ToMs(DateTimeOffset dt) => dt.ToUnixTimeMilliseconds();
    public static long? ToMs(DateTimeOffset? dt) => dt?.ToUnixTimeMilliseconds();
    public static DateTimeOffset ToDateTimeOffset(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms);
    public static DateTimeOffset? ToDateTimeOffset(long? ms) => ms is null ? null : DateTimeOffset.FromUnixTimeMilliseconds(ms.Value);

    // ── Helpers de enums ──────────────────────────────────────────────────────────────────────

    public static string ToRedis(RoomStatus s) => s switch
    {
        RoomStatus.Lobby => "lobby",
        RoomStatus.Running => "running",
        RoomStatus.Finished => "finished",
        _ => "lobby",
    };

    public static RoomStatus ParseRoomStatus(string? s) => s switch
    {
        "running" => RoomStatus.Running,
        "finished" => RoomStatus.Finished,
        _ => RoomStatus.Lobby,
    };

    public static string? ToRedis(MatchMode? m) => m switch
    {
        MatchMode.Live => "live",
        MatchMode.SelfPaced => "selfPaced",
        _ => null,
    };

    public static MatchMode? ParseMatchMode(string? s) => s switch
    {
        "live" => MatchMode.Live,
        "selfPaced" => MatchMode.SelfPaced,
        _ => null,
    };

    public static string ToRedis(ParticipantStatus s) => s switch
    {
        ParticipantStatus.Approved => "approved",
        ParticipantStatus.Rejected => "rejected",
        _ => "pending",
    };

    public static ParticipantStatus ParseParticipantStatus(string? s) => s switch
    {
        "approved" => ParticipantStatus.Approved,
        "rejected" => ParticipantStatus.Rejected,
        _ => ParticipantStatus.Pending,
    };

    // ── Payloads ───────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Estado de uma sala — gravado em <c>room:{roomId}</c> como JSON.
    /// </summary>
    public record RoomData(
        string Id,
        string Code,
        string Status,
        string? MatchMode,
        int Capacity,
        bool Locked,
        bool RequireAccount,
        string LeaderUserId,
        string LeaderName,
        long CreatedAtMs,
        long? ExpiresAtMs,
        int QueueRevision,
        string? CurrentMatchId = null);

    /// <summary>
    /// Dados de um participante — gravado no HASH <c>room:{roomId}:parts</c> como JSON.
    /// </summary>
    public record ParticipantData(
        string Id,
        string DisplayName,
        int AvatarIndex,
        bool LoggedIn,
        string? UserId,
        string Status,
        long JoinedAtMs,
        long? InResultsSinceMs);

    /// <summary>
    /// Metadados de um conjunto na fila — gravado em <c>room:{roomId}:qset:{id}</c> como JSON.
    /// </summary>
    public record QueueSetData(
        string Id,
        string SourcePhaseSetId,
        string Title,
        string Color,
        int OrderIndex);

    /// <summary>
    /// Definicao de uma fase na fila — gravado em <c>room:{roomId}:qphase:{id}</c> como JSON.
    /// O <c>ContentJson</c> e o mesmo formato de <c>Phase.ContentJson</c> (jsonb do postgres),
    /// gravado como string dentro do JSON do Redis para evitar dupla serializacao.
    /// </summary>
    public record QueuePhaseData(
        string Id,
        string QueueSetId,
        string SourcePhaseId,
        string Kind,
        string Name,
        int BasePoints,
        decimal PointsMultiplier,
        int TimeSeconds,
        int OrderIndex,
        string ContentJson);
}
