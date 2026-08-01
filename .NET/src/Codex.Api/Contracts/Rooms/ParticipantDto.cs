using Codex.Api.Domain;

namespace Codex.Api.Contracts.Rooms;

/// <summary>Formato exato de "participant" em api-rest.md secao 3 e do item de GET /rooms/{code}/participants (secao 4).</summary>
public record ParticipantDto(
    Guid Id,
    Guid RoomId,
    string DisplayName,
    int AvatarIndex,
    bool LoggedIn,
    Guid? UserId,
    ParticipantStatus Status,
    DateTimeOffset JoinedAt);