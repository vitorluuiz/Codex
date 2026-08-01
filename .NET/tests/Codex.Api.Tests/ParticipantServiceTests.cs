using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Domain;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Tests;

/// <summary>api-rest.md secao 3 (POST /rooms/{code}/participants) e participantes da secao 4.</summary>
public class ParticipantServiceTests
{
    private static JoinRoomRequest Join(string name = "Ana Silva", int avatar = 0) => new(name, avatar);

    [Fact]
    public async Task Join_creates_a_pending_participant_and_a_session_token()
    {
        var ctx = new RoomTestContext();

        var response = await ctx.Participants.JoinAsync("482913", Join(), ctx.Anonymous, CancellationToken.None);

        Assert.Equal("Ana Silva", response.Participant.DisplayName);
        Assert.Equal(ParticipantStatus.Pending, response.Participant.Status);
        Assert.False(response.Participant.LoggedIn);
        Assert.Null(response.Participant.UserId);
        Assert.Equal(ctx.Room.Id, response.Participant.RoomId);
        Assert.Equal(14400, response.ExpiresIn);

        Assert.True(ctx.Tokens.TryValidate(response.Token, out var payload));
        Assert.Equal(response.Participant.Id, payload.ParticipantId);
        Assert.Equal("482913", payload.RoomCode);
        Assert.Null(payload.UserId);
    }

    [Fact]
    public async Task Join_keeps_the_account_in_the_token_when_the_caller_is_logged_in()
    {
        var ctx = new RoomTestContext();
        var user = ctx.AddUser("Ana Silva", "ana@escola.br");

        var response = await ctx.Participants.JoinAsync("482913", Join(), RoomTestContext.AsUser(user.Id), CancellationToken.None);

        Assert.True(response.Participant.LoggedIn);
        Assert.Equal(user.Id, response.Participant.UserId);

        Assert.True(ctx.Tokens.TryValidate(response.Token, out var payload));
        Assert.Equal(user.Id, payload.UserId);
        Assert.Equal(response.Participant.Id, payload.ParticipantId);
    }

    [Fact]
    public async Task Join_enforces_the_availability_rules_again()
    {
        var ctx = new RoomTestContext(room => room.Locked = true);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Participants.JoinAsync("482913", Join(), ctx.Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.RoomLocked, exception.Code);
    }

    [Fact]
    public async Task Join_rejects_a_name_already_used_in_the_room_ignoring_case()
    {
        var ctx = new RoomTestContext();
        await ctx.Participants.JoinAsync("482913", Join("Ana Silva"), ctx.Anonymous, CancellationToken.None);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Participants.JoinAsync("482913", Join("ana silva"), ctx.Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.UsernameTaken, exception.Code);
        Assert.Equal(StatusCodes.Status409Conflict, exception.StatusCode);
    }

    [Fact]
    public async Task Join_frees_the_name_of_a_rejected_participant()
    {
        var ctx = new RoomTestContext();
        ctx.AddParticipant("Ana Silva", ParticipantStatus.Rejected);

        var response = await ctx.Participants.JoinAsync("482913", Join("Ana Silva"), ctx.Anonymous, CancellationToken.None);

        Assert.Equal("Ana Silva", response.Participant.DisplayName);
    }

    [Fact]
    public async Task Join_twice_with_the_same_account_reuses_the_participant()
    {
        var ctx = new RoomTestContext();
        var user = ctx.AddUser("Ana Silva", "ana@escola.br");
        var principal = RoomTestContext.AsUser(user.Id);

        var first = await ctx.Participants.JoinAsync("482913", Join("Ana Silva", 0), principal, CancellationToken.None);
        var second = await ctx.Participants.JoinAsync("482913", Join("Ana S.", 3), principal, CancellationToken.None);

        Assert.Equal(first.Participant.Id, second.Participant.Id);
        Assert.Equal("Ana S.", second.Participant.DisplayName);
        Assert.Equal(3, second.Participant.AvatarIndex);
        Assert.Equal(1, await ctx.Db.Participants.CountAsync());
    }

    [Fact]
    public async Task Join_twice_as_a_guest_creates_two_participants()
    {
        var ctx = new RoomTestContext();

        await ctx.Participants.JoinAsync("482913", Join("Ana Silva"), ctx.Anonymous, CancellationToken.None);
        await ctx.Participants.JoinAsync("482913", Join("Bruno Costa"), ctx.Anonymous, CancellationToken.None);

        Assert.Equal(2, await ctx.Db.Participants.CountAsync());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Join_rejects_an_empty_display_name(string name)
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Participants.JoinAsync("482913", Join(name), ctx.Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
        Assert.Equal(StatusCodes.Status400BadRequest, exception.StatusCode);
    }

    [Fact]
    public async Task List_defaults_to_approved_and_sorts_by_join_time()
    {
        var ctx = new RoomTestContext();
        ctx.AddParticipant("Ana Silva");
        ctx.AddParticipant("Bruno Costa");
        ctx.AddParticipant("Carla Souza", ParticipantStatus.Pending);

        var participants = await ctx.Participants.ListAsync("482913", null, ctx.AsLeader, CancellationToken.None);

        Assert.Equal(["Ana Silva", "Bruno Costa"], participants.Select(p => p.DisplayName));
    }

    [Fact]
    public async Task List_pending_is_leader_only()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Participants.ListAsync("482913", "pending", ctx.AsParticipant(participant.Id), CancellationToken.None));

        Assert.Equal(ErrorCodes.NotRoomLeader, exception.Code);

        var asLeader = await ctx.Participants.ListAsync("482913", "pending", ctx.AsLeader, CancellationToken.None);
        Assert.Empty(asLeader);
    }

    [Fact]
    public async Task List_approved_is_visible_to_any_member()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva");

        var participants = await ctx.Participants.ListAsync("482913", "approved", ctx.AsParticipant(participant.Id), CancellationToken.None);

        Assert.Single(participants);
    }

    [Fact]
    public async Task List_rejects_an_unsupported_status()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Participants.ListAsync("482913", "rejected", ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task Approve_moves_the_participant_to_approved()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva", ParticipantStatus.Pending);

        await ctx.Participants.ApproveAsync("482913", participant.Id, ctx.AsLeader, CancellationToken.None);

        Assert.Equal(ParticipantStatus.Approved, ctx.Db.Participants.Single().Status);
    }

    [Fact]
    public async Task Approve_refuses_a_guest_when_the_room_requires_an_account()
    {
        var ctx = new RoomTestContext(room => room.RequireAccount = true);
        var participant = ctx.AddParticipant("Ana Silva", ParticipantStatus.Pending);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Participants.ApproveAsync("482913", participant.Id, ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.AccountRequired, exception.Code);
        Assert.Equal(StatusCodes.Status403Forbidden, exception.StatusCode);
    }

    [Fact]
    public async Task Approve_allows_a_logged_in_participant_when_the_room_requires_an_account()
    {
        var ctx = new RoomTestContext(room => room.RequireAccount = true);
        var user = ctx.AddUser("Ana Silva", "ana@escola.br");
        var participant = ctx.AddParticipant("Ana Silva", ParticipantStatus.Pending, user.Id);

        await ctx.Participants.ApproveAsync("482913", participant.Id, ctx.AsLeader, CancellationToken.None);

        Assert.Equal(ParticipantStatus.Approved, ctx.Db.Participants.Single().Status);
    }

    [Fact]
    public async Task Approve_refuses_to_readmit_someone_into_a_full_room()
    {
        var ctx = new RoomTestContext(room => room.Capacity = 1);
        var rejected = ctx.AddParticipant("Ana Silva", ParticipantStatus.Rejected);
        ctx.AddParticipant("Bruno Costa");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Participants.ApproveAsync("482913", rejected.Id, ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.RoomFull, exception.Code);
    }

    [Fact]
    public async Task Reject_and_remove_are_leader_only()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva");
        var self = ctx.AsParticipant(participant.Id);

        var rejectError = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Participants.RejectAsync("482913", participant.Id, self, CancellationToken.None));
        Assert.Equal(ErrorCodes.NotRoomLeader, rejectError.Code);

        var removeError = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Participants.RemoveAsync("482913", participant.Id, self, CancellationToken.None));
        Assert.Equal(ErrorCodes.NotRoomLeader, removeError.Code);
    }

    [Fact]
    public async Task Reject_keeps_the_row_and_remove_deletes_it()
    {
        var ctx = new RoomTestContext();
        var rejected = ctx.AddParticipant("Ana Silva");
        var removed = ctx.AddParticipant("Bruno Costa");

        await ctx.Participants.RejectAsync("482913", rejected.Id, ctx.AsLeader, CancellationToken.None);
        await ctx.Participants.RemoveAsync("482913", removed.Id, ctx.AsLeader, CancellationToken.None);

        var remaining = ctx.Db.Participants.Single();
        Assert.Equal(rejected.Id, remaining.Id);
        Assert.Equal(ParticipantStatus.Rejected, remaining.Status);
    }

    [Fact]
    public async Task Leader_actions_do_not_reach_a_participant_of_another_room()
    {
        var ctx = new RoomTestContext();
        var other = new RoomTestContext();
        var foreign = other.AddParticipant("Ana Silva");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Participants.ApproveAsync("482913", foreign.Id, ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.ParticipantNotFound, exception.Code);
        Assert.Equal(StatusCodes.Status404NotFound, exception.StatusCode);
    }
}
