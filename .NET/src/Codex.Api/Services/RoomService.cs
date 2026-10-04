using System.Security.Claims;
using System.Security.Cryptography;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Formatting;
using Codex.Api.Common.Realtime;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.Realtime;
using Codex.Api.Services.Redis;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

public class RoomService(
    AppDbContext db,
    IRoomRepository repo,
    RoomAccessService roomAccess,
    RoomQueueService queue,
    LabelFormatter labels,
    IRealtimeEventPublisher realtime)
{
    private const int MaxCapacity = 500;
    private const int DefaultCapacity = 20;
    private const int CodeGenerationAttempts = 8;
    private const int MaxActiveRooms = 10;

    public async Task<RoomDto> CreateAsync(CreateRoomRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var userIdStr = principal.GetUserId()?.ToString() ?? throw AccountRequired();
        var userId = principal.GetUserId() ?? throw AccountRequired();
        var leader = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw AccountRequired();

        PhaseSet? phaseSet = null;
        if (request.SetId is { } setId)
        {
            phaseSet = await db.PhaseSets
                           .FirstOrDefaultAsync(
                               s => s.Id == setId && (s.OwnerId == userId || s.Visibility == PhaseSetVisibility.Community), ct)
                       ?? throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.PhaseSetNotFound, "Conjunto de fases nao encontrado.");
        }

        var roomId = Guid.NewGuid().ToString();
        var roomData = new RoomRedisData.RoomData(
            roomId,
            "",
            RoomRedisData.ToRedis(RoomStatus.Lobby),
            null,
            DefaultCapacity,
            false,
            false,
            userIdStr,
            leader.Name,
            RoomRedisData.ToMs(DateTimeOffset.UtcNow),
            null,
            0);

        string? finalCode = null;
        for (var attempt = 0; attempt < CodeGenerationAttempts; attempt++)
        {
            var attemptCode = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
            var attemptData = roomData with { Code = attemptCode };
            if (await repo.ClaimCodeAndCreateAsync(attemptCode, attemptData, ct))
            {
                finalCode = attemptCode;
                roomData = attemptData;
                break;
            }
        }

        if (finalCode is null)
        {
            throw new InvalidOperationException($"Nao foi possivel gerar um codigo livre em {CodeGenerationAttempts} tentativas.");
        }

        if (phaseSet is not null)
        {
            await queue.AppendSetAsync(roomId, phaseSet, ct);
        }

        return ToDto(roomData);
    }

    private static ApiException AccountRequired()
        => new(StatusCodes.Status403Forbidden, ErrorCodes.AccountRequired, "E preciso ter uma conta para criar uma sala.");

    public async Task<IReadOnlyList<ActiveRoomDto>> ListActiveAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = principal.GetUserId()?.ToString();
        var participantId = principal.GetParticipantId()?.ToString();

        if (userId is null && participantId is null) return [];

        var roomIds = new HashSet<string>();

        if (userId is not null)
        {
            foreach (var r in await repo.GetLedRoomIdsAsync(userId, ct)) roomIds.Add(r);
            foreach (var r in await repo.GetJoinedRoomIdsAsync(userId, ct)) roomIds.Add(r);
        }
        else if (principal.GetRoomCode() is { } code)
        {
            var rId = await repo.GetRoomIdByCodeAsync(code, ct);
            if (rId is not null && participantId is not null)
            {
                var p = await repo.GetParticipantAsync(rId, participantId, ct);
                if (p is not null && p.Status != "rejected") roomIds.Add(rId);
            }
        }

        var nowMs = RoomRedisData.ToMs(DateTimeOffset.UtcNow);
        var loadedRooms = new List<RoomRedisData.RoomData>();

        foreach (var rId in roomIds)
        {
            var r = await repo.GetRoomAsync(rId, ct);
            if (r is not null && r.Status != "finished" && (r.ExpiresAtMs == null || r.ExpiresAtMs > nowMs))
            {
                loadedRooms.Add(r);
            }
        }

        var results = new List<ActiveRoomDto>();
        foreach (var r in loadedRooms.OrderByDescending(r => r.CreatedAtMs).Take(MaxActiveRooms))
        {
            var isLeader = userId is not null && r.LeaderUserId == userId;
            var sets = await repo.GetQueueSetsAsync(r.Id, ct);
            var phases = await repo.GetQueuePhasesAsync(r.Id, ct);
            var parts = await repo.GetParticipantsAsync(r.Id, ct);

            results.Add(new ActiveRoomDto(
                r.Code,
                RoomRedisData.ParseRoomStatus(r.Status),
                RoomRedisData.ParseMatchMode(r.MatchMode),
                isLeader ? RoomMembershipRole.Leader : RoomMembershipRole.Participant,
                r.LeaderName,
                isLeader ? LabelFormatter.SetTitleLabel(sets.OrderBy(s => s.OrderIndex).Select(s => s.Title).ToList()) : null,
                isLeader ? phases.Count : null,
                parts.Count(p => p.Status == "approved"),
                labels.DateTimeLabel(RoomRedisData.ToDateTimeOffset(r.CreatedAtMs))));
        }

        return results;
    }

    public async Task<RoomAvailabilityResponse> GetAvailabilityAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetActiveRoomAsync(code, ct);
        await EnsureJoinableAsync(room, principal, ct);
        return new RoomAvailabilityResponse(room.Code, room.Capacity, room.RequireAccount);
    }

    public async Task<RoomDto> GetRoomAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        return ToDto(await roomAccess.GetRoomAsMemberAsync(code, principal, ct));
    }

    public async Task<RoomDto> UpdateAsync(string code, UpdateRoomRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);

        if (request.Capacity is { } capacity)
        {
            if (capacity is < 1 or > MaxCapacity) throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, $"capacity deve estar entre 1 e {MaxCapacity}.");
            room = room with { Capacity = capacity };
        }

        if (request.Locked is { } locked) room = room with { Locked = locked };
        if (request.RequireAccount is { } requireAccount) room = room with { RequireAccount = requireAccount };

        await repo.SaveRoomAsync(room.Id, room, ct);
        await realtime.PublishAsync(room.Code, RealtimeChannels.Room(room.Code), new RoomSettingsEvent(room.Locked, room.RequireAccount, room.Capacity), ct);

        return ToDto(room);
    }

    public async Task DeleteAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);

        // Coleta os ids dos conjuntos e fases da fila para limpar as chaves individuais
        var sets = await repo.GetQueueSetsAsync(room.Id, ct);
        var phases = await repo.GetQueuePhasesAsync(room.Id, ct);

        // Notifica todos os participantes da sala sobre o encerramento
        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Room(room.Code),
            new RoomClosedEvent(),
            ct);

        // Também publica nos canais privados de cada participante (alcança inclusive quem ainda aguarda aprovação)
        var participants = await repo.GetParticipantsAsync(room.Id, ct);
        foreach (var p in participants)
        {
            if (Guid.TryParse(p.Id, out var pId))
            {
                await realtime.PublishAsync(
                    room.Code,
                    RealtimeChannels.Participant(pId),
                    new RoomClosedEvent(),
                    ct);
            }
        }

        await repo.DeleteRoomAsync(
            room.Id,
            room.Code,
            room.LeaderUserId,
            sets.Select(s => s.Id).ToList(),
            phases.Select(p => p.Id).ToList(),
            ct);
    }

    public async Task EnsureJoinableAsync(RoomRedisData.RoomData room, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (room.Locked || room.Status == "finished") throw new ApiException(StatusCodes.Status423Locked, ErrorCodes.RoomLocked, "O apresentador travou a entrada.");
        if (room.RequireAccount && principal.GetUserId() is null) throw new ApiException(StatusCodes.Status403Forbidden, ErrorCodes.AccountRequired, "Esta sala exige uma conta para entrar.");
        if (await CountOccupancyAsync(room.Id, ct) >= room.Capacity) throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.RoomFull, "A sala atingiu a capacidade maxima.");
    }

    public async Task<int> CountOccupancyAsync(string roomId, CancellationToken ct)
    {
        return (await repo.GetParticipantsAsync(roomId, ct)).Count(p => p.Status != "rejected");
    }

    public static RoomDto ToDto(RoomRedisData.RoomData room) => new(
        Guid.Parse(room.Id),
        room.Code,
        RoomRedisData.ParseRoomStatus(room.Status),
        RoomRedisData.ParseMatchMode(room.MatchMode),
        room.Capacity,
        room.Locked,
        room.RequireAccount,
        new RoomLeaderDto(Guid.Parse(room.LeaderUserId), room.LeaderName),
        RoomRedisData.ToDateTimeOffset(room.CreatedAtMs));
}


