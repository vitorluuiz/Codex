using System;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;

namespace Codex.Api.Services.Redis;

public static class RoomRedisMappers
{
    public static Room ToEntity(this RoomRedisData.RoomData data) => new Room
    {
        Id = Guid.Parse(data.Id),
        Code = data.Code,
        Status = RoomRedisData.ParseRoomStatus(data.Status),
        MatchMode = RoomRedisData.ParseMatchMode(data.MatchMode),
        Capacity = data.Capacity,
        Locked = data.Locked,
        RequireAccount = data.RequireAccount,
        LeaderUserId = Guid.Parse(data.LeaderUserId),
        CreatedAt = RoomRedisData.ToDateTimeOffset(data.CreatedAtMs),
        ExpiresAt = RoomRedisData.ToDateTimeOffset(data.ExpiresAtMs),
        QueueRevision = data.QueueRevision
    };

    public static Participant ToEntity(this RoomRedisData.ParticipantData data, string roomId) => new Participant
    {
        Id = Guid.Parse(data.Id),
        RoomId = Guid.Parse(roomId),
        DisplayName = data.DisplayName,
        AvatarIndex = data.AvatarIndex,
        LoggedIn = data.LoggedIn,
        UserId = data.UserId != null ? Guid.Parse(data.UserId) : null,
        Status = RoomRedisData.ParseParticipantStatus(data.Status),
        JoinedAt = RoomRedisData.ToDateTimeOffset(data.JoinedAtMs),
        InResultsSince = RoomRedisData.ToDateTimeOffset(data.InResultsSinceMs)
    };

    public static RoomQueuePhase ToEntity(this RoomRedisData.QueuePhaseData data, string roomId) => new RoomQueuePhase
    {
        Id = Guid.Parse(data.Id),
        RoomId = Guid.Parse(roomId),
        RoomQueueSetId = Guid.Parse(data.QueueSetId),
        SourcePhaseId = Guid.Parse(data.SourcePhaseId),
        Kind = Enum.Parse<PhaseKind>(data.Kind, ignoreCase: true),
        Name = data.Name,
        BasePoints = data.BasePoints,
        PointsMultiplier = data.PointsMultiplier,
        TimeSeconds = data.TimeSeconds,
        OrderIndex = data.OrderIndex,
        ContentJson = data.ContentJson
    };

    public static RoomQueueSet ToEntity(this RoomRedisData.QueueSetData data, string roomId) => new RoomQueueSet
    {
        Id = Guid.Parse(data.Id),
        RoomId = Guid.Parse(roomId),
        SourcePhaseSetId = Guid.Parse(data.SourcePhaseSetId),
        Title = data.Title,
        Color = data.Color,
        OrderIndex = data.OrderIndex
    };

    public static RoomRedisData.QueuePhaseData ToRedisData(this RoomQueuePhase entity) => new RoomRedisData.QueuePhaseData(
        entity.Id.ToString(),
        entity.RoomQueueSetId.ToString(),
        entity.SourcePhaseId.ToString(),
        entity.Kind.ToString().ToLowerInvariant(),
        entity.Name,
        entity.BasePoints,
        entity.PointsMultiplier,
        entity.TimeSeconds,
        entity.OrderIndex,
        entity.ContentJson
    );
}
