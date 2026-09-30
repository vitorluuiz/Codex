using Codex.Api.Services.Realtime;
using StackExchange.Redis;

namespace Codex.Api.Services.Redis;

public class RoomRedisRepository(IRealtimeConnection connection, RedisLuaRunner luaRunner) : IRoomRepository
{
    private static readonly TimeSpan Ttl = RedisKeys.RoomTtl;

    private async Task<IDatabase> GetDbAsync(CancellationToken ct)
    {
        var mux = await connection.GetAsync(ct);
        return mux.GetDatabase();
    }

    private async Task<IServer> GetServerAsync(CancellationToken ct)
    {
        var mux = await connection.GetAsync(ct);
        // Retorna o primeiro server disponivel para fazer SCRIPT LOAD
        return mux.GetServer(mux.GetEndPoints().First());
    }

    // ── Salas ──────────────────────────────────────────────────────────────────────────────────

    public async Task<bool> ClaimCodeAndCreateAsync(string code, RoomRedisData.RoomData data, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var server = await GetServerAsync(ct);
        var json = RoomRedisData.Serialize(data);
        return await luaRunner.ClaimCodeAsync(db, server, code, data.Id, (long)Ttl.TotalSeconds, json, data.LeaderUserId, ct);
    }

    public async Task<string?> GetRoomIdByCodeAsync(string code, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var codeKey = RedisKeys.Code(code);
        
        var roomId = (string?)await db.StringGetAsync(codeKey);
        if (roomId is null) return null;

        await db.KeyExpireAsync(codeKey, Ttl);
        await RenewTtlAsync(roomId, ct);
        return roomId;
    }

    public async Task<RoomRedisData.RoomData?> GetRoomAsync(string roomId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var json = (string?)await db.StringGetAsync(RedisKeys.Room(roomId));
        return RoomRedisData.Deserialize<RoomRedisData.RoomData>(json);
    }

    public async Task SaveRoomAsync(string roomId, RoomRedisData.RoomData data, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var json = RoomRedisData.Serialize(data);
        await db.StringSetAsync(RedisKeys.Room(roomId), json, Ttl);
        await RenewTtlAsync(roomId, ct);
    }

    public async Task<bool> RenewTtlAsync(string roomId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var batch = db.CreateBatch();
        var t1 = batch.KeyExpireAsync(RedisKeys.Room(roomId), Ttl);
        var t2 = batch.KeyExpireAsync(RedisKeys.RoomNames(roomId), Ttl);
        var t3 = batch.KeyExpireAsync(RedisKeys.RoomParts(roomId), Ttl);
        var t4 = batch.KeyExpireAsync(RedisKeys.RoomPartsIdx(roomId), Ttl);
        var t5 = batch.KeyExpireAsync(RedisKeys.QueueSets(roomId), Ttl);
        var t6 = batch.KeyExpireAsync(RedisKeys.QueuePhases(roomId), Ttl);
        batch.Execute();
        await Task.WhenAll(t1, t2, t3, t4, t5, t6);
        return t1.Result;
    }

    // ── Participantes ──────────────────────────────────────────────────────────────────────────

    public async Task<ParticipantJoinResult> JoinParticipantAsync(string roomId, int capacity, RoomRedisData.ParticipantData data, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var server = await GetServerAsync(ct);
        var json = RoomRedisData.Serialize(data);
        var lowerName = data.DisplayName.ToLowerInvariant();
        return await luaRunner.JoinParticipantAsync(db, server, roomId, capacity, data.Id, lowerName, json, data.JoinedAtMs, ct);
    }

    public async Task<RoomRedisData.ParticipantData?> GetParticipantAsync(string roomId, string participantId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var json = (string?)await db.HashGetAsync(RedisKeys.RoomParts(roomId), participantId);
        return RoomRedisData.Deserialize<RoomRedisData.ParticipantData>(json);
    }

    public async Task<IReadOnlyList<RoomRedisData.ParticipantData>> GetParticipantsAsync(string roomId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        // Le o ZSET em ordem
        var ids = await db.SortedSetRangeByRankAsync(RedisKeys.RoomPartsIdx(roomId));
        if (ids.Length == 0) return [];

        // HGET de cada ID
        var batch = db.CreateBatch();
        var tasks = new Task<RedisValue>[ids.Length];
        var partsKey = RedisKeys.RoomParts(roomId);
        for (int i = 0; i < ids.Length; i++)
        {
            tasks[i] = batch.HashGetAsync(partsKey, ids[i]);
        }
        batch.Execute();
        await Task.WhenAll(tasks);

        var result = new List<RoomRedisData.ParticipantData>(ids.Length);
        foreach (var task in tasks)
        {
            var json = (string?)task.Result;
            if (json is not null)
            {
                var p = RoomRedisData.Deserialize<RoomRedisData.ParticipantData>(json);
                if (p is not null) result.Add(p);
            }
        }
        return result;
    }

    public async Task<int> CountParticipantsAsync(string roomId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        return (int)await db.HashLengthAsync(RedisKeys.RoomParts(roomId));
    }

    public async Task<bool> UpdateParticipantAsync(string roomId, RoomRedisData.ParticipantData data, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var json = RoomRedisData.Serialize(data);
        var ok = await db.HashSetAsync(RedisKeys.RoomParts(roomId), data.Id, json);
        return !ok; // HashSetAsync retorna true se foi inserido (novo), false se atualizou.
    }

    public async Task<bool> RejectParticipantAsync(string roomId, string participantId, string lowerDisplayName, RoomRedisData.ParticipantData updatedData, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var server = await GetServerAsync(ct);
        var json = RoomRedisData.Serialize(updatedData);
        return await luaRunner.RejectParticipantAsync(db, server, roomId, participantId, lowerDisplayName, json, ct);
    }

    public async Task<bool> RemoveParticipantAsync(string roomId, string participantId, string lowerDisplayName, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var server = await GetServerAsync(ct);
        return await luaRunner.RemoveParticipantAsync(db, server, roomId, participantId, lowerDisplayName, ct);
    }

    // ── Fila de Conjuntos ──────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<RoomRedisData.QueueSetData>> GetQueueSetsAsync(string roomId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var ids = await db.SortedSetRangeByRankAsync(RedisKeys.QueueSets(roomId));
        if (ids.Length == 0) return [];

        var batch = db.CreateBatch();
        var tasks = new Task<RedisValue>[ids.Length];
        for (int i = 0; i < ids.Length; i++)
        {
            tasks[i] = batch.StringGetAsync(RedisKeys.QueueSet(roomId, ids[i].ToString()));
        }
        batch.Execute();
        await Task.WhenAll(tasks);

        var result = new List<RoomRedisData.QueueSetData>(ids.Length);
        foreach (var task in tasks)
        {
            if (((string?)task.Result) is string json && RoomRedisData.Deserialize<RoomRedisData.QueueSetData>(json) is { } set)
                result.Add(set);
        }
        return result;
    }

    public async Task SaveQueueSetAsync(string roomId, RoomRedisData.QueueSetData data, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var json = RoomRedisData.Serialize(data);
        var batch = db.CreateBatch();
        _ = batch.SortedSetAddAsync(RedisKeys.QueueSets(roomId), data.Id, data.OrderIndex);
        _ = batch.StringSetAsync(RedisKeys.QueueSet(roomId, data.Id), json, Ttl);
        batch.Execute();
    }

    public async Task DeleteQueueSetAsync(string roomId, string setId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var batch = db.CreateBatch();
        _ = batch.SortedSetRemoveAsync(RedisKeys.QueueSets(roomId), setId);
        _ = batch.KeyDeleteAsync(RedisKeys.QueueSet(roomId, setId));
        batch.Execute();
    }

    // ── Fila de Fases ──────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<RoomRedisData.QueuePhaseData>> GetQueuePhasesAsync(string roomId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var ids = await db.SortedSetRangeByRankAsync(RedisKeys.QueuePhases(roomId));
        if (ids.Length == 0) return [];

        var batch = db.CreateBatch();
        var tasks = new Task<RedisValue>[ids.Length];
        for (int i = 0; i < ids.Length; i++)
        {
            tasks[i] = batch.StringGetAsync(RedisKeys.QueuePhase(roomId, ids[i].ToString()));
        }
        batch.Execute();
        await Task.WhenAll(tasks);

        var result = new List<RoomRedisData.QueuePhaseData>(ids.Length);
        foreach (var task in tasks)
        {
            if (((string?)task.Result) is string json && RoomRedisData.Deserialize<RoomRedisData.QueuePhaseData>(json) is { } phase)
                result.Add(phase);
        }
        return result;
    }

    public async Task<RoomRedisData.QueuePhaseData?> GetQueuePhaseAsync(string roomId, string phaseId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var json = (string?)await db.StringGetAsync(RedisKeys.QueuePhase(roomId, phaseId));
        return RoomRedisData.Deserialize<RoomRedisData.QueuePhaseData>(json);
    }

    public async Task SaveQueuePhaseAsync(string roomId, RoomRedisData.QueuePhaseData data, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var json = RoomRedisData.Serialize(data);
        var batch = db.CreateBatch();
        _ = batch.SortedSetAddAsync(RedisKeys.QueuePhases(roomId), data.Id, data.OrderIndex);
        _ = batch.StringSetAsync(RedisKeys.QueuePhase(roomId, data.Id), json, Ttl);
        batch.Execute();
    }

    public async Task DeleteQueuePhaseAsync(string roomId, string phaseId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var batch = db.CreateBatch();
        _ = batch.SortedSetRemoveAsync(RedisKeys.QueuePhases(roomId), phaseId);
        _ = batch.KeyDeleteAsync(RedisKeys.QueuePhase(roomId, phaseId));
        batch.Execute();
    }

    public async Task SaveQueueOrderAsync(
        string roomId,
        IReadOnlyList<RoomRedisData.QueuePhaseData> phases,
        IReadOnlyList<RoomRedisData.QueueSetData> sets,
        CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var batch = db.CreateBatch();
        
        var phasesKey = RedisKeys.QueuePhases(roomId);
        foreach (var phase in phases)
        {
            _ = batch.SortedSetAddAsync(phasesKey, phase.Id, phase.OrderIndex);
            _ = batch.StringSetAsync(RedisKeys.QueuePhase(roomId, phase.Id), RoomRedisData.Serialize(phase), Ttl);
        }

        var setsKey = RedisKeys.QueueSets(roomId);
        foreach (var set in sets)
        {
            _ = batch.SortedSetAddAsync(setsKey, set.Id, set.OrderIndex);
            _ = batch.StringSetAsync(RedisKeys.QueueSet(roomId, set.Id), RoomRedisData.Serialize(set), Ttl);
        }

        batch.Execute();
    }

    // ── Indices de Usuario ─────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<string>> GetLedRoomIdsAsync(string userId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var values = await db.SetMembersAsync(RedisKeys.UserLed(userId));
        return values.Select(v => v.ToString()).ToList();
    }

    public async Task<IReadOnlyList<string>> GetJoinedRoomIdsAsync(string userId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var values = await db.SetMembersAsync(RedisKeys.UserJoined(userId));
        return values.Select(v => v.ToString()).ToList();
    }

    public async Task AddToJoinedAsync(string userId, string roomId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        var key = RedisKeys.UserJoined(userId);
        await db.SetAddAsync(key, roomId);
        await db.KeyExpireAsync(key, Ttl);
    }

    public async Task RemoveFromJoinedAsync(string userId, string roomId, CancellationToken ct)
    {
        var db = await GetDbAsync(ct);
        await db.SetRemoveAsync(RedisKeys.UserJoined(userId), roomId);
    }
}
