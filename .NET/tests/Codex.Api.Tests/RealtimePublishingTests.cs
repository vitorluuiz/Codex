using Codex.Api.Common.Realtime;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Domain;

namespace Codex.Api.Tests;

/// <summary>
/// websocket-contract.md secao 1: a mutacao grava e <b>depois</b> publica. Estes testes cobrem
/// os pontos que antes eram <c>// TODO(realtime)</c> no codigo — o que se verifica e o canal
/// (secao 3) e o tipo do evento (secao 5), porque errar qualquer um dos dois produz um evento
/// que simplesmente nunca chega na tela, sem erro nenhum no meio do caminho.
/// </summary>
public class RealtimePublishingTests
{
    private static JoinRoomRequest Join(string name = "Ana Silva") => new(name, 0);

    [Fact]
    public async Task Joining_publishes_participant_joined_on_the_room_channel()
    {
        var ctx = new RoomTestContext();

        var response = await ctx.Participants.JoinAsync("482913", Join(), ctx.Anonymous, CancellationToken.None);

        var published = Assert.Single(ctx.Realtime.Published);
        Assert.Equal("482913", published.RoomCode);
        Assert.Equal(RealtimeChannels.Room("482913"), published.Channel);

        var payload = published.As<ParticipantJoinedEvent>();
        Assert.Equal("participant.joined", payload.Type);
        Assert.Equal(response.Participant.Id, payload.Participant.Id);
        Assert.Equal(ParticipantStatus.Pending, payload.Participant.Status);
    }

    [Fact]
    public async Task Re_entering_publishes_updated_instead_of_joined()
    {
        var ctx = new RoomTestContext();
        var user = ctx.AddUser("Ana Silva", "ana@escola.br");
        var principal = RoomTestContext.AsUser(user.Id);

        await ctx.Participants.JoinAsync("482913", Join(), principal, CancellationToken.None);
        ctx.Realtime.Published.Clear();

        // Mesma pessoa voltando para a mesma sala: o card ja esta na tela do lider.
        await ctx.Participants.JoinAsync("482913", Join(), principal, CancellationToken.None);

        var published = Assert.Single(ctx.Realtime.Published);
        Assert.Equal("participant.updated", published.As<ParticipantUpdatedEvent>().Type);
    }

    [Fact]
    public async Task Approving_publishes_participant_updated_with_the_new_status()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva", ParticipantStatus.Pending);
        ctx.Realtime.Published.Clear();

        await ctx.Participants.ApproveAsync("482913", participant.Id, ctx.AsLeader, CancellationToken.None);

        Assert.Equal(2, ctx.Realtime.Published.Count);

        var room = ctx.Realtime.Published[0];
        Assert.Equal(RealtimeChannels.Room("482913"), room.Channel);

        var payload = room.As<ParticipantUpdatedEvent>();
        Assert.Equal("participant.updated", payload.Type);
        Assert.Equal(ParticipantStatus.Approved, payload.Participant.Status);

        // O canal da sala e so para aprovado (secao 3), entao quem acabou de ser aceito nao
        // estava nele para receber a propria aprovacao: sem esta copia no canal privado, a tela
        // "esperando o lider aceitar" nunca sairia sozinha.
        var privateCopy = ctx.Realtime.Published[1];
        Assert.Equal(RealtimeChannels.Participant(participant.Id), privateCopy.Channel);
        Assert.Equal(ParticipantStatus.Approved, privateCopy.As<ParticipantUpdatedEvent>().Participant.Status);
    }

    [Fact]
    public async Task Rejecting_publishes_participant_updated()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva", ParticipantStatus.Pending);
        ctx.Realtime.Published.Clear();

        await ctx.Participants.RejectAsync("482913", participant.Id, ctx.AsLeader, CancellationToken.None);

        Assert.Equal(2, ctx.Realtime.Published.Count);
        Assert.Equal(RealtimeChannels.Room("482913"), ctx.Realtime.Published[0].Channel);
        Assert.Equal(RealtimeChannels.Participant(participant.Id), ctx.Realtime.Published[1].Channel);

        foreach (var published in ctx.Realtime.Published)
        {
            Assert.Equal(ParticipantStatus.Rejected, published.As<ParticipantUpdatedEvent>().Participant.Status);
        }
    }

    [Fact]
    public async Task Removing_publishes_left_to_the_room_and_removed_to_the_participant()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva");
        ctx.Realtime.Published.Clear();

        await ctx.Participants.RemoveAsync("482913", participant.Id, ctx.AsLeader, CancellationToken.None);

        Assert.Equal(2, ctx.Realtime.Published.Count);

        var left = ctx.Realtime.Published[0];
        Assert.Equal(RealtimeChannels.Room("482913"), left.Channel);
        Assert.Equal(participant.Id, left.As<ParticipantLeftEvent>().ParticipantId);

        // O privado e o que faz o servico de WS fechar o socket da pessoa (secao 10) — se ele
        // fosse para o canal da sala, fecharia o de todo mundo.
        var removed = ctx.Realtime.Published[1];
        Assert.Equal(RealtimeChannels.Participant(participant.Id), removed.Channel);
        Assert.Equal("removed_by_leader", removed.As<ParticipantRemovedEvent>().Reason);
    }

    [Fact]
    public async Task Patching_the_room_publishes_room_settings()
    {
        var ctx = new RoomTestContext();

        await ctx.Rooms.UpdateAsync(
            "482913",
            new UpdateRoomRequest(Locked: true, RequireAccount: null, Capacity: 30),
            ctx.AsLeader,
            CancellationToken.None);

        var published = Assert.Single(ctx.Realtime.Published);
        Assert.Equal(RealtimeChannels.Room("482913"), published.Channel);

        var payload = published.As<RoomSettingsEvent>();
        Assert.Equal("room.settings", payload.Type);
        Assert.True(payload.Locked);
        Assert.Equal(30, payload.Capacity);
        Assert.False(payload.RequireAccount);
    }

    [Fact]
    public async Task A_failed_mutation_publishes_nothing()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva", ParticipantStatus.Pending);
        ctx.Realtime.Published.Clear();

        // Nao e o lider: a acao nem chega a gravar.
        await Assert.ThrowsAsync<Codex.Api.Common.Errors.ApiException>(() =>
            ctx.Participants.ApproveAsync("482913", participant.Id, ctx.Anonymous, CancellationToken.None));

        Assert.Empty(ctx.Realtime.Published);
    }
}
