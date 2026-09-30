using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Realtime;
using Codex.Api.Contracts.Phases;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.Realtime;
using Codex.Api.Services.Redis;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

public class RoomQueueService(AppDbContext db, IRoomRepository repo, RoomAccessService roomAccess, IRealtimeEventPublisher realtime)
{
    public static readonly IReadOnlyList<string> Palette =
    [
        "var(--blue-500)",
        "var(--pink-500)",
        "var(--amber-500)",
        "var(--green-500)",
        "var(--violet-500)",
        "var(--blue-700)",
        "var(--red-500)",
        "var(--green-600)",
    ];

    public const int MaxSetsPerRoom = 8;

    public async Task<RoomQueueResponse> GetQueueAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);
        return await GetQueueAsync(room.Id, ct);
    }

    public async Task<RoomQueueResponse> GetQueueAsync(string roomId, CancellationToken ct)
    {
        var phasesData = await repo.GetQueuePhasesAsync(roomId, ct);
        var setsData = await repo.GetQueueSetsAsync(roomId, ct);

        var phaseCounts = phasesData
            .GroupBy(p => p.QueueSetId)
            .ToDictionary(group => group.Key, group => group.Count());

        var phases = phasesData
            .OrderBy(p => p.OrderIndex)
            .Select(p => new RoomQueuePhaseDto(
                Guid.Parse(p.Id),
                Guid.Parse(p.QueueSetId),
                p.Name,
                Enum.Parse<PhaseKind>(p.Kind, ignoreCase: true),
                p.BasePoints,
                p.PointsMultiplier,
                p.TimeSeconds))
            .ToList();

        var sets = setsData
            .OrderBy(s => s.OrderIndex)
            .Select(s => new RoomQueueSetDto(
                Guid.Parse(s.Id),
                s.Title,
                s.Color,
                phaseCounts.GetValueOrDefault(s.Id)))
            .ToList();

        return new RoomQueueResponse(sets, phases);
    }

    public async Task AppendSetAsync(string roomId, PhaseSet phaseSet, CancellationToken ct)
    {
        var existingSets = await repo.GetQueueSetsAsync(roomId, ct);
        var existingColors = existingSets.Select(s => s.Color).ToList();

        if (existingColors.Count >= MaxSetsPerRoom)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.TooManySets, $"Uma sala aceita no maximo {MaxSetsPerRoom} conjuntos na fila.");
        }

        var color = Palette.FirstOrDefault(c => !existingColors.Contains(c))
                    ?? Palette[existingColors.Count % Palette.Count];

        var nextSetOrder = existingColors.Count;
        var existingPhases = await repo.GetQueuePhasesAsync(roomId, ct);
        var nextPhaseOrder = existingPhases.Count;

        var queueSetId = Guid.NewGuid().ToString();
        var queueSet = new RoomRedisData.QueueSetData(
            queueSetId,
            phaseSet.Id.ToString(),
            phaseSet.Title,
            color,
            nextSetOrder
        );
        await repo.SaveQueueSetAsync(roomId, queueSet, ct);

        var phases = await db.Phases
            .AsNoTracking()
            .Where(p => p.PhaseSetId == phaseSet.Id)
            .OrderBy(p => p.OrderIndex)
            .ToListAsync(ct);

        foreach (var phase in phases)
        {
            var queuePhase = new RoomRedisData.QueuePhaseData(
                Guid.NewGuid().ToString(),
                queueSet.Id,
                phase.Id.ToString(),
                phase.Kind.ToString().ToLowerInvariant(),
                phase.Name,
                phase.BasePoints,
                phase.PointsMultiplier,
                phase.TimeSeconds,
                nextPhaseOrder++,
                phase.ContentJson
            );
            await repo.SaveQueuePhaseAsync(roomId, queuePhase, ct);
        }
    }

    public async Task<RoomQueueResponse> AddSetAsync(string code, AddQueueSetRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);
        var userId = principal.GetUserId();

        if (!Guid.TryParse(request.SetId, out var setId))
        {
            throw PhaseSetNotFound();
        }

        var phaseSet = await db.PhaseSets
                           .FirstOrDefaultAsync(
                               s => s.Id == setId && (s.OwnerId == userId || s.Visibility == PhaseSetVisibility.Community), ct)
                       ?? throw PhaseSetNotFound();

        await AppendSetAsync(room.Id, phaseSet, ct);

        return await SaveAndPublishAsync(room, ct);
    }

    public async Task<RoomQueueResponse> RemoveSetAsync(string code, string setId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);
        
        var existingSets = await repo.GetQueueSetsAsync(room.Id, ct);
        if (!existingSets.Any(s => s.Id == setId))
        {
            throw PhaseSetNotFound();
        }

        await repo.DeleteQueueSetAsync(room.Id, setId, ct);
        
        var existingPhases = await repo.GetQueuePhasesAsync(room.Id, ct);
        foreach (var phase in existingPhases.Where(p => p.QueueSetId == setId))
        {
            await repo.DeleteQueuePhaseAsync(room.Id, phase.Id, ct);
        }

        await ResequenceAsync(room.Id, ct);

        return await SaveAndPublishAsync(room, ct);
    }

    public async Task<RoomQueueResponse> UpdateSetAsync(
        string code,
        string setId,
        UpdateQueueSetRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);
        
        var existingSets = await repo.GetQueueSetsAsync(room.Id, ct);
        if (!existingSets.Any(s => s.Id == setId))
        {
            throw PhaseSetNotFound();
        }

        var basePoints = ValidateBasePoints(request.BasePoints);
        var multiplier = ValidateMultiplier(request.PointsMultiplier);
        var timeSeconds = ValidateTimeSeconds(request.TimeSeconds);

        var existingPhases = await repo.GetQueuePhasesAsync(room.Id, ct);
        foreach (var phase in existingPhases.Where(p => p.QueueSetId == setId))
        {
            var updatedPhase = phase with
            {
                BasePoints = basePoints ?? phase.BasePoints,
                PointsMultiplier = multiplier ?? phase.PointsMultiplier,
                TimeSeconds = timeSeconds ?? phase.TimeSeconds
            };
            await repo.SaveQueuePhaseAsync(room.Id, updatedPhase, ct);
        }

        return await SaveAndPublishAsync(room, ct);
    }

    public async Task<RoomQueueResponse> UpdatePhaseAsync(
        string code,
        string phaseId,
        UpdateQueuePhaseRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);
        var phase = await repo.GetQueuePhaseAsync(room.Id, phaseId, ct) ?? throw PhaseNotFound();

        var basePoints = ValidateBasePoints(request.BasePoints);
        var multiplier = ValidateMultiplier(request.PointsMultiplier);
        var timeSeconds = ValidateTimeSeconds(request.TimeSeconds);

        var updatedName = phase.Name;
        if (request.Name is { } rawName)
        {
            var name = rawName.Trim();
            if (name.Length is 0 || name.Length > PhaseLimits.MaxNameLength)
            {
                throw Validation($"name deve ter entre 1 e {PhaseLimits.MaxNameLength} caracteres.");
            }
            updatedName = name;
        }

        var updatedContentJson = phase.ContentJson;
        if (request.ExpectedAnswer is { } expectedAnswer)
        {
            var kindEnum = Enum.Parse<PhaseKind>(phase.Kind, ignoreCase: true);
            if (kindEnum is not (PhaseKind.Text or PhaseKind.Code))
            {
                throw Validation("expectedAnswer so vale para fases text e code.");
            }

            if (PhaseLimits.ExceedsLength(expectedAnswer, PhaseLimits.MaxExpectedAnswerLength))
            {
                throw Validation($"expectedAnswer deve ter no maximo {PhaseLimits.MaxExpectedAnswerLength} caracteres.");
            }

            updatedContentJson = (PhaseContent.Parse(phase.ContentJson) with { ExpectedAnswer = expectedAnswer }).ToJson();
        }

        var updatedPhase = phase with
        {
            Name = updatedName,
            BasePoints = basePoints ?? phase.BasePoints,
            PointsMultiplier = multiplier ?? phase.PointsMultiplier,
            TimeSeconds = timeSeconds ?? phase.TimeSeconds,
            ContentJson = updatedContentJson
        };

        await repo.SaveQueuePhaseAsync(room.Id, updatedPhase, ct);

        return await SaveAndPublishAsync(room, ct);
    }

    public async Task<RoomQueueResponse> RemovePhaseAsync(string code, string phaseId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);
        var phase = await repo.GetQueuePhaseAsync(room.Id, phaseId, ct) ?? throw PhaseNotFound();

        await repo.DeleteQueuePhaseAsync(room.Id, phaseId, ct);

        var existingPhases = await repo.GetQueuePhasesAsync(room.Id, ct);
        var siblingsCount = existingPhases.Count(p => p.QueueSetId == phase.QueueSetId && p.Id != phase.Id);

        if (siblingsCount is 0)
        {
            await repo.DeleteQueueSetAsync(room.Id, phase.QueueSetId, ct);
        }

        await ResequenceAsync(room.Id, ct);

        return await SaveAndPublishAsync(room, ct);
    }

    public async Task<RoomQueueResponse> ReorderAsync(
        string code,
        ReorderQueueRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);

        var phases = (await repo.GetQueuePhasesAsync(room.Id, ct)).OrderBy(p => p.OrderIndex).ToList();
        var sets = (await repo.GetQueueSetsAsync(room.Id, ct)).OrderBy(s => s.OrderIndex).ToList();

        var requested = request.PhaseIds ?? [];

        if (requested.Count != phases.Count
            || requested.Any(id => string.IsNullOrWhiteSpace(id))
            || !requested.ToHashSet().SetEquals(phases.Select(p => p.Id)))
        {
            throw new ApiException(
                StatusCodes.Status409Conflict,
                ErrorCodes.QueueMismatch,
                "A fila mudou desde que esta tela foi carregada.");
        }

        var newPhases = new List<RoomRedisData.QueuePhaseData>();
        for (var index = 0; index < requested.Count; index++)
        {
            var p = phases.First(x => x.Id == requested[index]);
            newPhases.Add(p with { OrderIndex = index });
        }

        await repo.SaveQueueOrderAsync(room.Id, newPhases, sets, ct);

        return await SaveAndPublishAsync(room, ct);
    }

    public async Task<PhaseDto> GetPhaseDetailAsync(string code, string phaseId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);
        var phase = await repo.GetQueuePhaseAsync(room.Id, phaseId, ct) ?? throw PhaseNotFound();

        return PhaseProjection.ToPhase(phase, includeAnswers: true);
    }

    private async Task<RoomRedisData.RoomData> GetEditableRoomAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);

        if (RoomRedisData.ParseRoomStatus(room.Status) is not RoomStatus.Lobby)
        {
            throw new ApiException(
                StatusCodes.Status409Conflict,
                ErrorCodes.MatchAlreadyStarted,
                "A fila so pode ser alterada antes de a partida comecar.");
        }

        return room;
    }

    private async Task<RoomQueueResponse> SaveAndPublishAsync(RoomRedisData.RoomData room, CancellationToken ct)
    {
        room = room with { QueueRevision = room.QueueRevision + 1 };
        await repo.SaveRoomAsync(room.Id, room, ct);

        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Room(room.Code),
            new QueueUpdatedEvent(room.QueueRevision),
            ct);

        return await GetQueueAsync(room.Id, ct);
    }

    private async Task ResequenceAsync(string roomId, CancellationToken ct)
    {
        var phases = (await repo.GetQueuePhasesAsync(roomId, ct)).OrderBy(p => p.OrderIndex).ToList();
        var newPhases = new List<RoomRedisData.QueuePhaseData>();
        for (int i = 0; i < phases.Count; i++)
        {
            newPhases.Add(phases[i] with { OrderIndex = i });
        }

        var sets = (await repo.GetQueueSetsAsync(roomId, ct)).OrderBy(s => s.OrderIndex).ToList();
        var newSets = new List<RoomRedisData.QueueSetData>();
        for (int i = 0; i < sets.Count; i++)
        {
            newSets.Add(sets[i] with { OrderIndex = i });
        }

        await repo.SaveQueueOrderAsync(roomId, newPhases, newSets, ct);
    }

    private static int? ValidateBasePoints(int? basePoints)
        => basePoints is null || basePoints is >= 0 and <= PhaseLimits.MaxBasePoints
            ? basePoints
            : throw Validation($"basePoints deve estar entre 0 e {PhaseLimits.MaxBasePoints}.");

    private static int? ValidateTimeSeconds(int? timeSeconds)
        => timeSeconds is null || timeSeconds is >= PhaseLimits.MinTimeSeconds and <= PhaseLimits.MaxTimeSeconds
            ? timeSeconds
            : throw Validation($"timeSeconds deve estar entre {PhaseLimits.MinTimeSeconds} e {PhaseLimits.MaxTimeSeconds}.");

    private static decimal? ValidateMultiplier(decimal? multiplier)
        => multiplier is null
            ? null
            : multiplier >= PhaseLimits.MinPointsMultiplier && multiplier <= PhaseLimits.MaxPointsMultiplier
                ? PhaseLimits.RoundMultiplier(multiplier.Value)
                : throw Validation($"pointsMultiplier deve estar entre {PhaseLimits.MinPointsMultiplier} e {PhaseLimits.MaxPointsMultiplier}.");

    private static ApiException PhaseSetNotFound()
        => new(StatusCodes.Status404NotFound, ErrorCodes.PhaseSetNotFound, "Conjunto de fases nao encontrado nesta fila.");

    private static ApiException PhaseNotFound()
        => new(StatusCodes.Status404NotFound, ErrorCodes.PhaseNotFound, "Fase nao encontrada nesta fila.");

    private static ApiException Validation(string message)
        => new(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, message);
}
