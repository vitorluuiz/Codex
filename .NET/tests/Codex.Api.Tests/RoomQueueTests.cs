using Codex.Api.Common.Errors;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Tests;

/// <summary>api-rest.md secao 6, GET /rooms/{code}/queue.</summary>
public class RoomQueueTests
{
    [Fact]
    public async Task Leader_reads_the_sets_with_color_and_phase_count()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações & Funções Básicas", phaseCount: 3);
        await ctx.Queue.AppendSetAsync(ctx.Room.Id, set, CancellationToken.None);
        await ctx.Db.SaveChangesAsync();

        var queue = await ctx.Queue.GetQueueAsync(ctx.Room.Code, ctx.AsLeader, CancellationToken.None);

        var only = Assert.Single(queue.Sets);
        Assert.Equal("Frações & Funções Básicas", only.Title);
        Assert.Equal(RoomQueueService.Palette[0], only.Color);
        Assert.Equal(3, only.PhaseCount);
        // setId e o id da linha da fila, nao o do PhaseSet de origem: e ele que /queue/sets/{setId}
        // recebe de volta, e o mesmo conjunto pode ser adicionado duas vezes na sala.
        Assert.NotEqual(set.Id, only.SetId);
    }

    [Fact]
    public async Task Each_phase_points_back_to_its_set()
    {
        var ctx = new RoomTestContext();
        var first = ctx.AddPhaseSet(ctx.Leader, "Primeiro", phaseCount: 2);
        var second = ctx.AddPhaseSet(ctx.Leader, "Segundo", phaseCount: 1);
        await ctx.Queue.AppendSetAsync(ctx.Room.Id, first, CancellationToken.None);
        await ctx.Queue.AppendSetAsync(ctx.Room.Id, second, CancellationToken.None);
        await ctx.Db.SaveChangesAsync();

        var queue = await ctx.Queue.GetQueueAsync(ctx.Room.Code, ctx.AsLeader, CancellationToken.None);

        Assert.Equal([2, 1], queue.Sets.Select(s => s.PhaseCount));
        Assert.All(queue.Phases, phase => Assert.Contains(queue.Sets, s => s.SetId == phase.SetId));
        Assert.Equal(3, queue.Phases.Count);
    }

    [Fact]
    public async Task Phase_fields_come_from_the_copy_in_the_queue()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 1);
        await ctx.Queue.AppendSetAsync(ctx.Room.Id, set, CancellationToken.None);
        await ctx.Db.SaveChangesAsync();

        // O lider ajustou a fase dentro da fila; o conjunto de origem continua com 100/45.
        var queued = await ctx.Db.RoomQueuePhases.SingleAsync(p => p.RoomId == ctx.Room.Id);
        queued.BasePoints = 150;
        queued.PointsMultiplier = 1.5m;
        queued.TimeSeconds = 60;
        await ctx.Db.SaveChangesAsync();

        var phase = Assert.Single((await ctx.Queue.GetQueueAsync(ctx.Room.Code, ctx.AsLeader, CancellationToken.None)).Phases);

        Assert.Equal("Fase 1", phase.Name);
        Assert.Equal(PhaseKind.Quiz, phase.Kind);
        Assert.Equal(150, phase.BasePoints);
        Assert.Equal(1.5m, phase.PointsMultiplier);
        Assert.Equal(60, phase.TimeSeconds);
    }

    [Fact]
    public async Task Phases_come_in_queue_order_even_when_sets_interleave()
    {
        var ctx = new RoomTestContext();
        var first = ctx.AddPhaseSet(ctx.Leader, "Primeiro", phaseCount: 2);
        var second = ctx.AddPhaseSet(ctx.Leader, "Segundo", phaseCount: 2);
        await ctx.Queue.AppendSetAsync(ctx.Room.Id, first, CancellationToken.None);
        await ctx.Queue.AppendSetAsync(ctx.Room.Id, second, CancellationToken.None);
        await ctx.Db.SaveChangesAsync();

        // Simula o que PUT /queue/order vai fazer: inverte a fila. A partir daqui, agrupar por
        // conjunto daria a resposta errada — a ordem que vale e a da fila inteira.
        var phases = await ctx.Db.RoomQueuePhases.Where(p => p.RoomId == ctx.Room.Id).OrderBy(p => p.OrderIndex).ToListAsync();
        for (var index = 0; index < phases.Count; index++)
        {
            phases[index].OrderIndex = phases.Count - 1 - index;
        }
        await ctx.Db.SaveChangesAsync();

        var queue = await ctx.Queue.GetQueueAsync(ctx.Room.Code, ctx.AsLeader, CancellationToken.None);

        Assert.Equal(phases.AsEnumerable().Reverse().Select(p => p.Id), queue.Phases.Select(p => p.Id));
    }

    [Fact]
    public async Task Empty_queue_is_two_empty_lists_and_not_a_404()
    {
        var ctx = new RoomTestContext();

        var queue = await ctx.Queue.GetQueueAsync(ctx.Room.Code, ctx.AsLeader, CancellationToken.None);

        Assert.Empty(queue.Sets);
        Assert.Empty(queue.Phases);
    }

    [Fact]
    public async Task Queue_of_another_room_does_not_leak()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 2);
        await ctx.Queue.AppendSetAsync(ctx.Room.Id, set, CancellationToken.None);

        var otherRoom = new Room
        {
            Code = "100200",
            Capacity = 20,
            LeaderUserId = ctx.Leader.Id,
            Leader = ctx.Leader,
        };
        ctx.Db.Rooms.Add(otherRoom);
        await ctx.Db.SaveChangesAsync();

        var queue = await ctx.Queue.GetQueueAsync(otherRoom.Code, ctx.AsLeader, CancellationToken.None);

        Assert.Empty(queue.Sets);
        Assert.Empty(queue.Phases);
    }

    [Fact]
    public async Task Approved_participant_cannot_read_the_queue()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.GetQueueAsync(ctx.Room.Code, ctx.AsParticipant(participant.Id), CancellationToken.None));

        Assert.Equal(ErrorCodes.NotRoomLeader, exception.Code);
        Assert.Equal(StatusCodes.Status403Forbidden, exception.StatusCode);
    }

    [Fact]
    public async Task Another_user_cannot_read_the_queue()
    {
        var ctx = new RoomTestContext();
        var other = ctx.AddUser("Prof. Marcos", "marcos@escola.br");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.GetQueueAsync(ctx.Room.Code, RoomTestContext.AsUser(other.Id), CancellationToken.None));

        Assert.Equal(ErrorCodes.NotRoomLeader, exception.Code);
    }

    [Fact]
    public async Task Anonymous_cannot_read_the_queue()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.GetQueueAsync(ctx.Room.Code, ctx.Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.NotRoomLeader, exception.Code);
    }

    [Fact]
    public async Task Unknown_code_is_ROOM_NOT_FOUND()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.GetQueueAsync("999999", ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.RoomNotFound, exception.Code);
        Assert.Equal(StatusCodes.Status404NotFound, exception.StatusCode);
    }
}
