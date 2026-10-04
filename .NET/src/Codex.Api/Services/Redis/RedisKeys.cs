namespace Codex.Api.Services.Redis;

/// <summary>
/// Padroes de chave do Redis — redis.md §2. Toda chave do sistema passa por aqui: nenhum
/// servico monta string de chave sozinho. Mudanca de prefixo ou formato e mudanca em um lugar so.
/// </summary>
public static class RedisKeys
{
    /// <summary>
    /// TTL padrao de sala. Renovado a cada interacao (redis.md §5).
    /// Igual ao <c>RoomLifetimeAfterMatch</c> do <c>MatchService</c> por especificacao.
    /// </summary>
    public static readonly TimeSpan RoomTtl = TimeSpan.FromHours(24);

    // ── Reserva de codigo ──────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>code:{code}</c> → STRING com o <c>roomId</c>.
    /// Reserva atomica de codigo de 6 digitos via <c>SET NX EX</c>.
    /// </summary>
    public static string Code(string code) => $"code:{code}";

    // ── Sala ───────────────────────────────────────────────────────────────────────────────────

    /// <summary><c>room:{roomId}</c> → STRING com JSON de <see cref="RoomRedisData.RoomData"/>.</summary>
    public static string Room(string roomId) => $"room:{roomId}";

    /// <summary>
    /// <c>room:{roomId}:names</c> → SET com apelidos normalizados (<c>lower(displayName)</c>)
    /// de participantes nao rejeitados. Garante unicidade antes do HSET.
    /// </summary>
    public static string RoomNames(string roomId) => $"room:{roomId}:names";

    /// <summary>
    /// <c>room:{roomId}:parts</c> → HASH participantId → JSON do participante.
    /// </summary>
    public static string RoomParts(string roomId) => $"room:{roomId}:parts";

    /// <summary>
    /// <c>room:{roomId}:parts:idx</c> → ZSET score=joinedAtMs membro=participantId.
    /// Permite listar participantes em ordem de entrada.
    /// </summary>
    public static string RoomPartsIdx(string roomId) => $"room:{roomId}:parts:idx";

    // ── Fila de conjuntos ──────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>room:{roomId}:queue:sets</c> → ZSET score=orderIndex membro=queueSetId.
    /// </summary>
    public static string QueueSets(string roomId) => $"room:{roomId}:queue:sets";

    /// <summary>
    /// <c>room:{roomId}:qset:{setId}</c> → STRING com JSON de <see cref="RoomRedisData.QueueSetData"/>.
    /// </summary>
    public static string QueueSet(string roomId, string setId) => $"room:{roomId}:qset:{setId}";

    // ── Fila de fases ──────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>room:{roomId}:queue:phases</c> → ZSET score=orderIndex membro=queuePhaseId.
    /// </summary>
    public static string QueuePhases(string roomId) => $"room:{roomId}:queue:phases";

    /// <summary>
    /// <c>room:{roomId}:qphase:{phaseId}</c> → STRING com JSON de <see cref="RoomRedisData.QueuePhaseData"/>.
    /// </summary>
    public static string QueuePhase(string roomId, string phaseId) => $"room:{roomId}:qphase:{phaseId}";

    // ── Índices de usuário ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>user:{userId}:led</c> → SET de roomIds liderados pelo usuário.
    /// Sustenta <c>GET /rooms/active</c> sem varrer todas as salas.
    /// </summary>
    public static string UserLed(string userId) => $"user:{userId}:led";

    /// <summary>
    /// <c>user:{userId}:joined</c> → SET de roomIds em que o usuário entrou como participante.
    /// </summary>
    public static string UserJoined(string userId) => $"user:{userId}:joined";

    // ── Partida ────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>match:{matchId}</c> → HASH com estado de execução da partida.
    /// </summary>
    public static string Match(string matchId) => $"match:{matchId}";

    /// <summary>
    /// <c>match:{matchId}:subs</c> → HASH de submissões da partida: `{queuePhaseId}:{participantId}` → JSON
    /// </summary>
    public static string MatchSubs(string matchId) => $"match:{matchId}:subs";

    /// <summary>
    /// <c>match:{matchId}:agg:{queuePhaseId}</c> → HASH com contadores da fase
    /// </summary>
    public static string MatchAgg(string matchId, string queuePhaseId) => $"match:{matchId}:agg:{queuePhaseId}";

    /// <summary>
    /// <c>commit:pending</c> → SET com IDs de partidas finalizadas aguardando confirmação no MongoDB.
    /// </summary>
    public static string CommitPending() => "commit:pending";
}
