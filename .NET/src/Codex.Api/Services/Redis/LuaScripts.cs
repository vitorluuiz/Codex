using StackExchange.Redis;

namespace Codex.Api.Services.Redis;

/// <summary>
/// Scripts Lua atomicos obrigatorios — redis.md §4.
///
/// Cada script e carregado uma vez no Redis (SCRIPT LOAD) e invocado por hash (EVALSHA), o que
/// evita reenviar o corpo a cada chamada. O carregamento e lazy e thread-safe via
/// <see cref="SemaphoreSlim"/>: o primeiro chamador carrega, os demais reutilizam.
///
/// Retornos: convencionamos inteiros como codigo de resultado:
///   1  = sucesso
///   0  = condicao de erro nao excecional (sala cheia, etc.)
///  -1  = nome ja em uso
/// </summary>
public static class LuaScripts
{
    // ── Script room_claim_code (redis.md §4.1) ────────────────────────────────────────────────
    //
    // Garante que um codigo de sala e reservado atomicamente:
    // se o codigo ja estiver em uso, nenhuma chave e criada.

    public const string RoomClaimCode = """
        -- Retorna 1 = codigo livre e sala criada; 0 = codigo ja em uso
        local ok = redis.call('SET', @code, @roomId, 'NX', 'EX', tonumber(@ttl))
        if not ok then return 0 end
        redis.call('SET', @room, @json, 'EX', tonumber(@ttl))
        redis.call('SADD', @led, @roomId)
        redis.call('EXPIRE', @led, tonumber(@ttl))
        return 1
        """;

    public const string ParticipantJoin = """
        -- Retorna 1=ok, 0=sala_cheia, -1=nome_em_uso
        local count = redis.call('HLEN', @parts)
        if tonumber(count) >= tonumber(@cap) then return 0 end
        local added = redis.call('SADD', @names, @lower)
        if tonumber(added) == 0 then return -1 end
        redis.call('HSET', @parts, @id, @json)
        redis.call('ZADD', @idx, tonumber(@ms), @id)
        return 1
        """;

    public const string ParticipantReject = """
        -- Retorna 1=ok, 0=nao_encontrado
        local existing = redis.call('HGET', @parts, @id)
        if not existing then return 0 end
        redis.call('HSET', @parts, @id, @json)
        redis.call('SREM', @names, @lower)
        return 1
        """;

    public const string ParticipantRemove = """
        -- Retorna 1=ok, 0=nao_encontrado
        local existing = redis.call('HGET', @parts, @id)
        if not existing then return 0 end
        redis.call('HDEL', @parts, @id)
        redis.call('ZREM', @idx, @id)
        redis.call('SREM', @names, @lower)
        return 1
        """;

    public const string SubmissionPut = """
        -- stub
        return 1
        """;

    public const string PhaseRestart = """
        -- stub
        return 1
        """;
}

/// <summary>
/// Executor dos scripts Lua com carregamento lazy e cache de <see cref="LoadedLuaScript"/>.
/// </summary>
public class RedisLuaRunner
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private LoadedLuaScript? _claimCode;
    private LoadedLuaScript? _participantJoin;
    private LoadedLuaScript? _participantReject;
    private LoadedLuaScript? _participantRemove;

    private async Task<LoadedLuaScript> GetOrLoadAsync(
        string source,
        IServer server,
        Func<LoadedLuaScript?> getCached,
        Action<LoadedLuaScript> setCached,
        CancellationToken ct)
    {
        var cached = getCached();
        if (cached is not null) return cached;
        await _gate.WaitAsync(ct);
        try
        {
            cached = getCached();
            if (cached is not null) return cached;
            var prepared = LuaScript.Prepare(source);
            cached = await prepared.LoadAsync(server);
            setCached(cached);
            return cached;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Reserva o codigo e cria a sala atomicamente.
    /// Retorna <c>true</c> se o codigo estava livre; <c>false</c> se ja estava em uso.
    /// </summary>
    public async Task<bool> ClaimCodeAsync(
        IDatabase db,
        IServer server,
        string code,
        string roomId,
        long ttlSeconds,
        string roomJson,
        string leaderUserId,
        CancellationToken ct)
    {
        var script = await GetOrLoadAsync(
            LuaScripts.RoomClaimCode, server, 
            () => _claimCode, s => _claimCode = s, ct);
        var result = (int)await script.EvaluateAsync(db, new {
            code = (RedisKey)RedisKeys.Code(code),
            room = (RedisKey)RedisKeys.Room(roomId),
            led = (RedisKey)RedisKeys.UserLed(leaderUserId),
            roomId = roomId,
            ttl = ttlSeconds,
            json = roomJson
        });
        return result == 1;
    }

    public async Task<ParticipantJoinResult> JoinParticipantAsync(
        IDatabase db,
        IServer server,
        string roomId,
        int capacity,
        string participantId,
        string lowerDisplayName,
        string participantJson,
        long joinedAtMs,
        CancellationToken ct)
    {
        var script = await GetOrLoadAsync(
            LuaScripts.ParticipantJoin, server,
            () => _participantJoin, s => _participantJoin = s, ct);
        var result = (int)await script.EvaluateAsync(db, new {
            parts = (RedisKey)RedisKeys.RoomParts(roomId),
            names = (RedisKey)RedisKeys.RoomNames(roomId),
            idx = (RedisKey)RedisKeys.RoomPartsIdx(roomId),
            cap = capacity,
            id = participantId,
            lower = lowerDisplayName,
            json = participantJson,
            ms = (double)joinedAtMs
        });

        return result switch
        {
            1 => ParticipantJoinResult.Ok,
            0 => ParticipantJoinResult.RoomFull,
            _ => ParticipantJoinResult.NameTaken,
        };
    }

    public async Task<bool> RejectParticipantAsync(
        IDatabase db,
        IServer server,
        string roomId,
        string participantId,
        string lowerDisplayName,
        string updatedJson,
        CancellationToken ct)
    {
        var script = await GetOrLoadAsync(
            LuaScripts.ParticipantReject, server,
            () => _participantReject, s => _participantReject = s, ct);
        var result = (int)await script.EvaluateAsync(db, new {
            parts = (RedisKey)RedisKeys.RoomParts(roomId),
            names = (RedisKey)RedisKeys.RoomNames(roomId),
            id = participantId,
            lower = lowerDisplayName,
            json = updatedJson
        });
        return result == 1;
    }

    public async Task<bool> RemoveParticipantAsync(
        IDatabase db,
        IServer server,
        string roomId,
        string participantId,
        string lowerDisplayName,
        CancellationToken ct)
    {
        var script = await GetOrLoadAsync(
            LuaScripts.ParticipantRemove, server,
            () => _participantRemove, s => _participantRemove = s, ct);
        var result = (int)await script.EvaluateAsync(db, new {
            parts = (RedisKey)RedisKeys.RoomParts(roomId),
            idx = (RedisKey)RedisKeys.RoomPartsIdx(roomId),
            names = (RedisKey)RedisKeys.RoomNames(roomId),
            id = participantId,
            lower = lowerDisplayName
        });
        return result == 1;
    }
}

/// <summary>Resultado do script <c>participant_join</c>.</summary>
public enum ParticipantJoinResult
{
    Ok,
    RoomFull,
    NameTaken,
}
