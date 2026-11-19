using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Realtime;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Services.Realtime;
using Codex.Api.Services.Redis;

namespace Codex.Api.Services;

/// <summary>
/// api-rest.md secao 3 (POST /rooms/{code}/participants) e a parte de participantes da secao 4
/// (listar, aprovar, recusar, remover).
/// </summary>
public class ParticipantService(
    IRoomRepository repo,
    RoomAccessService roomAccess,
    RoomService roomService,
    ISessionTokenService tokenService,
    IRealtimeEventPublisher realtime,
    IConfiguration configuration)
{
    private const int MaxDisplayNameLength = 80;

    public async Task<JoinRoomResponse> JoinAsync(string code, JoinRoomRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var displayName = (request.DisplayName ?? string.Empty).Trim();
        if (displayName.Length is 0 or > MaxDisplayNameLength)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, $"displayName deve ter entre 1 e {MaxDisplayNameLength} caracteres.");
        }

        if (request.AvatarIndex < 0)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "avatarIndex deve ser maior ou igual a zero.");
        }

        var room = await roomAccess.GetActiveRoomAsync(code, ct);
        var userId = principal.GetUserId()?.ToString();

        RoomRedisData.ParticipantData? existing = null;
        if (userId is not null)
        {
            var parts = await repo.GetParticipantsAsync(room.Id, ct);
            existing = parts.FirstOrDefault(p => p.UserId == userId && p.Status != "rejected");
        }

        if (existing is null)
        {
            await roomService.EnsureJoinableAsync(room, principal, ct);
        }

        var participantId = existing?.Id ?? Guid.NewGuid().ToString();
        var participant = new RoomRedisData.ParticipantData(
            participantId,
            displayName,
            request.AvatarIndex,
            userId is not null,
            userId,
            existing?.Status ?? "pending",
            existing?.JoinedAtMs ?? RoomRedisData.ToMs(DateTimeOffset.UtcNow),
            existing?.InResultsSinceMs
        );

        var result = await repo.JoinParticipantAsync(room.Id, room.Capacity, participant, ct);
        
        if (result == ParticipantJoinResult.NameTaken)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.UsernameTaken, "Ja existe alguem com este nome na sala.");
        }
        if (result == ParticipantJoinResult.RoomFull)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.RoomFull, "A sala atingiu a capacidade maxima.");
        }

        var lifetime = TimeSpan.FromHours(configuration.GetValue("CodexApi:GuestParticipantLifetimeHours", 4));
        var expiresAt = DateTimeOffset.UtcNow.Add(lifetime);
        var token = tokenService.Issue(new SessionTokenPayload(principal.GetUserId(), Guid.Parse(participant.Id), room.Code, expiresAt));

        var dto = ToDto(room.Id, participant);
        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Room(room.Code),
            existing is null ? new ParticipantJoinedEvent(dto) : (object)new ParticipantUpdatedEvent(dto),
            ct);

        return new JoinRoomResponse(dto, token, (int)lifetime.TotalSeconds);
    }

    public async Task<IReadOnlyList<ParticipantDto>> ListAsync(string code, string? status, ClaimsPrincipal principal, CancellationToken ct)
    {
        var requested = string.IsNullOrWhiteSpace(status) ? "approved" : status.Trim().ToLowerInvariant();

        var parsed = requested switch
        {
            "approved" => "approved",
            "pending" => "pending",
            _ => throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "status deve ser 'approved' ou 'pending'."),
        };

        var room = parsed == "pending"
            ? await roomAccess.GetRoomAsLeaderAsync(code, principal, ct)
            : await roomAccess.GetRoomAsMemberAsync(code, principal, ct);

        var participants = await repo.GetParticipantsAsync(room.Id, ct);

        return participants
            .Where(p => p.Status == parsed)
            .OrderBy(p => p.JoinedAtMs)
            .Select(p => ToDto(room.Id, p))
            .ToList();
    }

    public async Task ApproveAsync(string code, Guid participantId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);
        var participant = await repo.GetParticipantAsync(room.Id, participantId.ToString(), ct)
                          ?? throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.ParticipantNotFound, "Participante nao encontrado nesta sala.");

        if (room.RequireAccount && !participant.LoggedIn)
        {
            throw new ApiException(StatusCodes.Status403Forbidden, ErrorCodes.AccountRequired, "Esta sala exige uma conta; este participante entrou sem conta.");
        }

        if (participant.Status == "rejected"
            && await roomService.CountOccupancyAsync(room.Id, ct) >= room.Capacity)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.RoomFull, "A sala atingiu a capacidade maxima.");
        }

        participant = participant with { Status = "approved" };
        await repo.UpdateParticipantAsync(room.Id, participant, ct);

        await PublishDecisionAsync(room.Code, room.Id, participant, ct);
    }

    public async Task RejectAsync(string code, Guid participantId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);
        var participant = await repo.GetParticipantAsync(room.Id, participantId.ToString(), ct)
                          ?? throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.ParticipantNotFound, "Participante nao encontrado nesta sala.");

        participant = participant with { Status = "rejected" };
        await repo.RejectParticipantAsync(room.Id, participantId.ToString(), participant.DisplayName.ToLowerInvariant(), participant, ct);

        await PublishDecisionAsync(room.Code, room.Id, participant, ct);
    }

    private async Task PublishDecisionAsync(string roomCode, string roomId, RoomRedisData.ParticipantData participant, CancellationToken ct)
    {
        var dto = ToDto(roomId, participant);
        await realtime.PublishAsync(roomCode, RealtimeChannels.Room(roomCode), new ParticipantUpdatedEvent(dto), ct);
        await realtime.PublishAsync(roomCode, RealtimeChannels.Participant(Guid.Parse(participant.Id)), new ParticipantUpdatedEvent(dto), ct);
    }

    public async Task RemoveAsync(string code, Guid participantId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);
        var participant = await repo.GetParticipantAsync(room.Id, participantId.ToString(), ct)
                          ?? throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.ParticipantNotFound, "Participante nao encontrado nesta sala.");

        await repo.RemoveParticipantAsync(room.Id, participantId.ToString(), participant.DisplayName.ToLowerInvariant(), ct);

        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Room(room.Code),
            new ParticipantLeftEvent(Guid.Parse(participant.Id)),
            ct);

        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Participant(Guid.Parse(participant.Id)),
            new ParticipantRemovedEvent("removed_by_leader"),
            ct);
    }

    public static ParticipantDto ToDto(string roomId, RoomRedisData.ParticipantData participant) => new(
        Guid.Parse(participant.Id),
        Guid.Parse(roomId),
        participant.DisplayName,
        participant.AvatarIndex,
        participant.LoggedIn,
        participant.UserId is not null ? Guid.Parse(participant.UserId) : null,
        RoomRedisData.ParseParticipantStatus(participant.Status),
        RoomRedisData.ToDateTimeOffset(participant.JoinedAtMs),
        participant.InResultsSinceMs is not null);

    public async Task ReturnToLobbyAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetActiveRoomAsync(code, ct);

        if (principal.GetParticipantId() is not { } participantId)
        {
            throw new ApiException(
                StatusCodes.Status403Forbidden,
                ErrorCodes.AccountRequired,
                "Esta acao e do participante da sala.");
        }

        var participant = await repo.GetParticipantAsync(room.Id, participantId.ToString(), ct)
                          ?? throw new ApiException(
                              StatusCodes.Status404NotFound,
                              ErrorCodes.ParticipantNotFound,
                              "Participante nao encontrado nesta sala.");

        if (participant.InResultsSinceMs is null)
        {
            return;
        }

        participant = participant with { InResultsSinceMs = null };
        await repo.UpdateParticipantAsync(room.Id, participant, ct);

        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Room(room.Code),
            new ParticipantUpdatedEvent(ToDto(room.Id, participant)),
            ct);
    }
}
