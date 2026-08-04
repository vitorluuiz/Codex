using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Domain;
using Codex.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Tests;

/// <summary>api-rest.md secao 4, POST /rooms.</summary>
public class RoomCreationTests
{
    [Fact]
    public async Task Creates_a_lobby_led_by_the_caller()
    {
        var ctx = new RoomTestContext();

        var room = await ctx.Rooms.CreateAsync(new CreateRoomRequest(null), ctx.AsLeader, CancellationToken.None);

        Assert.Equal(RoomStatus.Lobby, room.Status);
        Assert.Null(room.MatchMode);
        Assert.False(room.Locked);
        Assert.False(room.RequireAccount);
        Assert.Equal(ctx.Leader.Id, room.Leader.Id);
        Assert.Equal(ctx.Leader.Name, room.Leader.Name);
    }

    [Fact]
    public async Task Code_has_six_digits_and_is_free_among_active_rooms()
    {
        var ctx = new RoomTestContext();

        var room = await ctx.Rooms.CreateAsync(new CreateRoomRequest(null), ctx.AsLeader, CancellationToken.None);

        Assert.Equal(6, room.Code.Length);
        Assert.All(room.Code, character => Assert.True(char.IsAsciiDigit(character)));
        // A sala semeada pelo contexto ja ocupa "482913".
        Assert.NotEqual(ctx.Room.Code, room.Code);
    }

    [Fact]
    public async Task Guest_without_account_cannot_create_a_room()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.CreateAsync(new CreateRoomRequest(null), ctx.AsParticipant(participant.Id), CancellationToken.None));

        Assert.Equal(ErrorCodes.AccountRequired, exception.Code);
        Assert.Equal(StatusCodes.Status403Forbidden, exception.StatusCode);
    }

    [Fact]
    public async Task SetId_fills_the_queue_with_a_copy_of_the_phases()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações & Funções Básicas", phaseCount: 3);

        var room = await ctx.Rooms.CreateAsync(new CreateRoomRequest(set.Id), ctx.AsLeader, CancellationToken.None);

        var queueSet = await ctx.Db.RoomQueueSets.SingleAsync(s => s.RoomId == room.Id);
        Assert.Equal("Frações & Funções Básicas", queueSet.Title);
        Assert.Equal(set.Id, queueSet.SourcePhaseSetId);
        Assert.Equal(RoomQueueService.Palette[0], queueSet.Color);

        var phases = await ctx.Db.RoomQueuePhases
            .Where(p => p.RoomId == room.Id)
            .OrderBy(p => p.OrderIndex)
            .ToListAsync();

        Assert.Equal(["Fase 1", "Fase 2", "Fase 3"], phases.Select(p => p.Name));
        Assert.Equal([0, 1, 2], phases.Select(p => p.OrderIndex));
        // Copia, nao referencia (decisao 1 da secao 13): editar o conjunto depois nao muda a fila.
        Assert.All(phases, phase => Assert.NotEqual(Guid.Empty, phase.SourcePhaseId));
    }

    [Fact]
    public async Task Without_setId_the_room_is_born_with_an_empty_queue()
    {
        var ctx = new RoomTestContext();

        var room = await ctx.Rooms.CreateAsync(new CreateRoomRequest(null), ctx.AsLeader, CancellationToken.None);

        Assert.False(await ctx.Db.RoomQueueSets.AnyAsync(s => s.RoomId == room.Id));
    }

    [Fact]
    public async Task Unknown_setId_creates_no_room_at_all()
    {
        var ctx = new RoomTestContext();
        var roomsBefore = await ctx.Db.Rooms.CountAsync();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.CreateAsync(new CreateRoomRequest(Guid.NewGuid()), ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.PhaseSetNotFound, exception.Code);
        Assert.Equal(StatusCodes.Status404NotFound, exception.StatusCode);
        Assert.Equal(roomsBefore, await ctx.Db.Rooms.CountAsync());
    }

    [Fact]
    public async Task Private_set_of_someone_else_is_not_visible()
    {
        var ctx = new RoomTestContext();
        var other = ctx.AddUser("Prof. Marcos", "marcos@escola.br");
        var set = ctx.AddPhaseSet(other, "Álgebra para o ENEM");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.CreateAsync(new CreateRoomRequest(set.Id), ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.PhaseSetNotFound, exception.Code);
    }

    [Fact]
    public async Task Community_set_of_someone_else_can_start_a_room()
    {
        var ctx = new RoomTestContext();
        var other = ctx.AddUser("Prof. Marcos", "marcos@escola.br");
        var set = ctx.AddPhaseSet(other, "Álgebra para o ENEM", visibility: PhaseSetVisibility.Community);

        var room = await ctx.Rooms.CreateAsync(new CreateRoomRequest(set.Id), ctx.AsLeader, CancellationToken.None);

        Assert.True(await ctx.Db.RoomQueueSets.AnyAsync(s => s.RoomId == room.Id && s.SourcePhaseSetId == set.Id));
    }

    [Fact]
    public async Task Queue_colors_do_not_repeat_inside_a_room()
    {
        var ctx = new RoomTestContext();

        for (var index = 0; index < RoomQueueService.MaxSetsPerRoom; index++)
        {
            var set = ctx.AddPhaseSet(ctx.Leader, $"Conjunto {index}", phaseCount: 1);
            await ctx.Queue.AppendSetAsync(ctx.Room.Id, set, CancellationToken.None);
            await ctx.Db.SaveChangesAsync();
        }

        var colors = await ctx.Db.RoomQueueSets.Where(s => s.RoomId == ctx.Room.Id).Select(s => s.Color).ToListAsync();

        Assert.Equal(RoomQueueService.MaxSetsPerRoom, colors.Count);
        Assert.Equal(colors.Count, colors.Distinct().Count());
    }

    [Fact]
    public async Task Ninth_set_is_rejected_with_TOO_MANY_SETS()
    {
        var ctx = new RoomTestContext();

        for (var index = 0; index < RoomQueueService.MaxSetsPerRoom; index++)
        {
            var seeded = ctx.AddPhaseSet(ctx.Leader, $"Conjunto {index}", phaseCount: 1);
            await ctx.Queue.AppendSetAsync(ctx.Room.Id, seeded, CancellationToken.None);
            await ctx.Db.SaveChangesAsync();
        }

        var extra = ctx.AddPhaseSet(ctx.Leader, "Um a mais", phaseCount: 1);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.AppendSetAsync(ctx.Room.Id, extra, CancellationToken.None));

        Assert.Equal(ErrorCodes.TooManySets, exception.Code);
        Assert.Equal(StatusCodes.Status409Conflict, exception.StatusCode);
    }

    [Fact]
    public async Task Second_set_continues_the_phase_order_of_the_first()
    {
        var ctx = new RoomTestContext();
        var first = ctx.AddPhaseSet(ctx.Leader, "Primeiro", phaseCount: 2);
        var second = ctx.AddPhaseSet(ctx.Leader, "Segundo", phaseCount: 2);

        await ctx.Queue.AppendSetAsync(ctx.Room.Id, first, CancellationToken.None);
        await ctx.Db.SaveChangesAsync();
        await ctx.Queue.AppendSetAsync(ctx.Room.Id, second, CancellationToken.None);
        await ctx.Db.SaveChangesAsync();

        var orders = await ctx.Db.RoomQueuePhases
            .Where(p => p.RoomId == ctx.Room.Id)
            .OrderBy(p => p.OrderIndex)
            .Select(p => p.OrderIndex)
            .ToListAsync();

        Assert.Equal([0, 1, 2, 3], orders);
    }
}
