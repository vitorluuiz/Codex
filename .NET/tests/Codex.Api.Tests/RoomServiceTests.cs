using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Domain;
using Microsoft.AspNetCore.Http;

namespace Codex.Api.Tests;

/// <summary>api-rest.md secao 3 (availability) e secao 4 (GET/PATCH /rooms/{code}).</summary>
public class RoomServiceTests
{
    [Fact]
    public async Task Availability_returns_the_three_fields_of_the_contract()
    {
        var ctx = new RoomTestContext();

        var response = await ctx.Rooms.GetAvailabilityAsync("482913", ctx.Anonymous, CancellationToken.None);

        Assert.Equal(new RoomAvailabilityResponse("482913", 20, false), response);
    }

    [Fact]
    public async Task Availability_rejects_unknown_code()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.GetAvailabilityAsync("000000", ctx.Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.RoomNotFound, exception.Code);
        Assert.Equal(StatusCodes.Status404NotFound, exception.StatusCode);
    }

    [Theory]
    [InlineData("48291")]
    [InlineData("4829133")]
    [InlineData("abcdef")]
    public async Task Availability_treats_malformed_code_as_not_found(string code)
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.GetAvailabilityAsync(code, ctx.Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.RoomNotFound, exception.Code);
    }

    [Fact]
    public async Task Availability_rejects_locked_room()
    {
        var ctx = new RoomTestContext(room => room.Locked = true);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.GetAvailabilityAsync("482913", ctx.Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.RoomLocked, exception.Code);
        Assert.Equal(StatusCodes.Status423Locked, exception.StatusCode);
    }

    [Fact]
    public async Task Availability_rejects_finished_room()
    {
        var ctx = new RoomTestContext(room => room.Status = RoomStatus.Finished);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.GetAvailabilityAsync("482913", ctx.Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.RoomLocked, exception.Code);
    }

    [Fact]
    public async Task Availability_allows_running_room()
    {
        var ctx = new RoomTestContext(room => room.Status = RoomStatus.Running);

        var response = await ctx.Rooms.GetAvailabilityAsync("482913", ctx.Anonymous, CancellationToken.None);

        Assert.Equal("482913", response.Code);
    }

    [Fact]
    public async Task Availability_requires_account_only_for_anonymous_callers()
    {
        var ctx = new RoomTestContext(room => room.RequireAccount = true);
        var guest = ctx.AddUser("Ana Silva", "ana@escola.br");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.GetAvailabilityAsync("482913", ctx.Anonymous, CancellationToken.None));
        Assert.Equal(ErrorCodes.AccountRequired, exception.Code);
        Assert.Equal(StatusCodes.Status403Forbidden, exception.StatusCode);

        var allowed = await ctx.Rooms.GetAvailabilityAsync("482913", RoomTestContext.AsUser(guest.Id), CancellationToken.None);
        Assert.True(allowed.RequireAccount);
    }

    [Fact]
    public async Task Availability_counts_pending_participants_towards_capacity()
    {
        var ctx = new RoomTestContext(room => room.Capacity = 2);
        ctx.AddParticipant("Ana Silva");
        ctx.AddParticipant("Bruno Costa", ParticipantStatus.Pending);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.GetAvailabilityAsync("482913", ctx.Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.RoomFull, exception.Code);
        Assert.Equal(StatusCodes.Status409Conflict, exception.StatusCode);
    }

    [Fact]
    public async Task Availability_frees_the_slot_of_a_rejected_participant()
    {
        var ctx = new RoomTestContext(room => room.Capacity = 1);
        ctx.AddParticipant("Ana Silva", ParticipantStatus.Rejected);

        var response = await ctx.Rooms.GetAvailabilityAsync("482913", ctx.Anonymous, CancellationToken.None);

        Assert.Equal(1, response.Capacity);
    }

    [Fact]
    public async Task GetRoom_is_visible_to_the_leader_and_to_members()
    {
        var ctx = new RoomTestContext();
        var pending = ctx.AddParticipant("Ana Silva", ParticipantStatus.Pending);

        var asLeader = await ctx.Rooms.GetRoomAsync("482913", ctx.AsLeader, CancellationToken.None);
        Assert.Equal(ctx.Leader.Id, asLeader.Leader.Id);
        Assert.Equal("Marina Duarte", asLeader.Leader.Name);
        Assert.Equal(RoomStatus.Lobby, asLeader.Status);
        Assert.Null(asLeader.MatchMode);

        // Pendente enxerga a sala: e dela que vem o nome do lider na tela de espera.
        var asPending = await ctx.Rooms.GetRoomAsync("482913", ctx.AsParticipant(pending.Id), CancellationToken.None);
        Assert.Equal(ctx.Room.Id, asPending.Id);
    }

    [Fact]
    public async Task GetRoom_hides_the_room_from_non_members()
    {
        var ctx = new RoomTestContext();
        var stranger = ctx.AddUser("Estranho", "estranho@escola.br");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.GetRoomAsync("482913", RoomTestContext.AsUser(stranger.Id), CancellationToken.None));

        Assert.Equal(ErrorCodes.RoomNotFound, exception.Code);
    }

    [Fact]
    public async Task Update_applies_only_the_fields_that_were_sent()
    {
        var ctx = new RoomTestContext(room => room.RequireAccount = true);

        var updated = await ctx.Rooms.UpdateAsync("482913", new UpdateRoomRequest(Locked: true, RequireAccount: null, Capacity: null), ctx.AsLeader, CancellationToken.None);

        Assert.True(updated.Locked);
        Assert.True(updated.RequireAccount);
        Assert.Equal(20, updated.Capacity);
    }

    [Fact]
    public async Task Update_rejects_a_non_leader()
    {
        var ctx = new RoomTestContext();
        var stranger = ctx.AddUser("Estranho", "estranho@escola.br");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.UpdateAsync("482913", new UpdateRoomRequest(true, null, null), RoomTestContext.AsUser(stranger.Id), CancellationToken.None));

        Assert.Equal(ErrorCodes.NotRoomLeader, exception.Code);
        Assert.Equal(StatusCodes.Status403Forbidden, exception.StatusCode);
    }

    [Fact]
    public async Task Update_rejects_a_participant_token_even_for_the_leaders_own_room()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.UpdateAsync("482913", new UpdateRoomRequest(true, null, null), ctx.AsParticipant(participant.Id), CancellationToken.None));

        Assert.Equal(ErrorCodes.NotRoomLeader, exception.Code);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(501)]
    public async Task Update_rejects_capacity_outside_the_allowed_range(int capacity)
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.UpdateAsync("482913", new UpdateRoomRequest(null, null, capacity), ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task GetActiveRoom_ignores_an_expired_room_that_recycled_the_code()
    {
        var ctx = new RoomTestContext(room => room.ExpiresAt = DateTimeOffset.UtcNow.AddHours(-1));

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Rooms.GetAvailabilityAsync("482913", ctx.Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.RoomNotFound, exception.Code);
    }
}
