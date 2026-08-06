using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Domain;
using Codex.Api.Services;
using Codex.Api.Services.Realtime;

namespace Codex.Api.Tests;

/// <summary>
/// <c>POST /internal/realtime/resolve</c> — a rota de que o servico de WS depende para saber
/// quem esta no socket e o que ele pode assinar (websocket-contract.md secoes 2 e 10).
///
/// A autorizacao de canal em si mora no Node (<c>realtime/src/channels.ts</c>), mas ela decide
/// a partir de tres campos que saem daqui: <c>isLeader</c>, <c>participantStatus</c> e
/// <c>roomCode</c>. Errar qualquer um deles vira canal liberado para quem nao devia.
/// </summary>
public class RealtimeSessionServiceTests
{
    private static (RealtimeSessionService Service, RoomTestContext Ctx, IRealtimeTicketStore Tickets) Build()
    {
        var ctx = new RoomTestContext();
        var tickets = new InMemoryRealtimeTicketStore();
        var service = new RealtimeSessionService(ctx.Db, ctx.Tokens, new RoomAccessService(ctx.Db), tickets);
        return (service, ctx, tickets);
    }

    private static string TokenFor(RoomTestContext ctx, Guid? userId, Guid? participantId)
        => ctx.Tokens.Issue(new SessionTokenPayload(userId, participantId, ctx.Room.Code, DateTimeOffset.UtcNow.AddHours(1)));

    [Fact]
    public async Task The_room_leader_resolves_as_leader_without_being_a_participant()
    {
        var (service, ctx, _) = Build();
        var token = TokenFor(ctx, ctx.Leader.Id, participantId: null);

        var result = await service.ResolveAsync(new ResolveRealtimeSessionRequest(token, null, "482913"), CancellationToken.None);

        Assert.True(result.IsLeader);
        Assert.Equal(ctx.Leader.Id, result.UserId);
        Assert.Equal("482913", result.RoomCode);
        // Lider e um usuario, nao um participante: o canal `participant:*` dele nao existe.
        Assert.Null(result.ParticipantStatus);
        Assert.Null(result.ParticipantId);
    }

    [Fact]
    public async Task A_pending_participant_resolves_as_pending()
    {
        var (service, ctx, _) = Build();
        var participant = ctx.AddParticipant("Ana Silva", ParticipantStatus.Pending);
        var token = TokenFor(ctx, null, participant.Id);

        var result = await service.ResolveAsync(new ResolveRealtimeSessionRequest(token, null, "482913"), CancellationToken.None);

        Assert.False(result.IsLeader);
        Assert.Equal(ParticipantStatus.Pending, result.ParticipantStatus);
        Assert.Equal(participant.Id, result.ParticipantId);
    }

    [Fact]
    public async Task An_approved_participant_carries_name_and_avatar_for_player_activity()
    {
        var (service, ctx, _) = Build();
        var participant = ctx.AddParticipant("Diego Alves");
        participant.AvatarIndex = 3;
        ctx.Db.SaveChanges();

        var result = await service.ResolveAsync(
            new ResolveRealtimeSessionRequest(TokenFor(ctx, null, participant.Id), null, "482913"),
            CancellationToken.None);

        // O evento `player.activity` (secao 5) leva nome e avatar; o cliente nao os manda, para
        // que ninguem se anuncie com o nome de outra pessoa.
        Assert.Equal(ParticipantStatus.Approved, result.ParticipantStatus);
        Assert.Equal("Diego Alves", result.DisplayName);
        Assert.Equal(3, result.AvatarIndex);
    }

    [Fact]
    public async Task A_participant_of_another_room_gets_no_role_in_this_one()
    {
        var (service, ctx, _) = Build();
        var otherRoom = new Codex.Api.Domain.Entities.Room
        {
            Code = "111222",
            Capacity = 20,
            LeaderUserId = ctx.Leader.Id,
        };
        ctx.Db.Rooms.Add(otherRoom);
        ctx.Db.SaveChanges();

        var stranger = ctx.AddParticipant("Ana Silva");

        var result = await service.ResolveAsync(
            new ResolveRealtimeSessionRequest(TokenFor(ctx, null, stranger.Id), null, "111222"),
            CancellationToken.None);

        // Resolve sem papel nenhum: autenticado, mas todo `subscribe` desta sala sera recusado
        // com FORBIDDEN_CHANNEL.
        Assert.False(result.IsLeader);
        Assert.Null(result.ParticipantStatus);
    }

    [Fact]
    public async Task Without_a_room_it_resolves_only_the_identity()
    {
        var (service, ctx, _) = Build();
        var participant = ctx.AddParticipant("Ana Silva");

        // E a checagem que roda antes do upgrade, quando o `hello` — e portanto a sala — ainda
        // nao chegou.
        var result = await service.ResolveAsync(
            new ResolveRealtimeSessionRequest(TokenFor(ctx, null, participant.Id), null, null),
            CancellationToken.None);

        Assert.Equal(participant.Id, result.ParticipantId);
        Assert.False(result.IsLeader);
        Assert.Null(result.ParticipantStatus);
    }

    [Fact]
    public async Task An_invalid_token_is_unauthenticated()
    {
        var (service, _, _) = Build();

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            service.ResolveAsync(new ResolveRealtimeSessionRequest("nao-e-um-token", null, "482913"), CancellationToken.None));

        Assert.Equal(ErrorCodes.Unauthenticated, error.Code);
    }

    [Fact]
    public async Task An_expired_token_is_unauthenticated()
    {
        var (service, ctx, _) = Build();
        var expired = ctx.Tokens.Issue(new SessionTokenPayload(ctx.Leader.Id, null, "482913", DateTimeOffset.UtcNow.AddMinutes(-1)));

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            service.ResolveAsync(new ResolveRealtimeSessionRequest(expired, null, "482913"), CancellationToken.None));

        Assert.Equal(ErrorCodes.Unauthenticated, error.Code);
    }

    [Fact]
    public async Task An_unknown_room_is_room_not_found()
    {
        var (service, ctx, _) = Build();
        var token = TokenFor(ctx, ctx.Leader.Id, null);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            service.ResolveAsync(new ResolveRealtimeSessionRequest(token, null, "999999"), CancellationToken.None));

        Assert.Equal(ErrorCodes.RoomNotFound, error.Code);
    }

    [Fact]
    public async Task A_ticket_works_once_and_returns_the_session_token_behind_it()
    {
        var (service, ctx, _) = Build();
        var sessionToken = TokenFor(ctx, ctx.Leader.Id, null);

        var issued = await service.IssueTicketAsync(sessionToken, TimeSpan.FromSeconds(30), CancellationToken.None);
        Assert.Equal(30, issued.ExpiresIn);

        var result = await service.ResolveAsync(
            new ResolveRealtimeSessionRequest(null, issued.Ticket, "482913"), CancellationToken.None);

        Assert.True(result.IsLeader);
        // Devolvido para que a conexao consiga reler o papel nos `subscribe` seguintes — um
        // ticket, sendo de uso unico, nao serviria.
        Assert.Equal(sessionToken, result.SessionToken);

        var reuse = await Assert.ThrowsAsync<ApiException>(() =>
            service.ResolveAsync(new ResolveRealtimeSessionRequest(null, issued.Ticket, "482913"), CancellationToken.None));

        Assert.Equal(ErrorCodes.Unauthenticated, reuse.Code);
    }

    [Fact]
    public async Task A_session_token_resolution_never_echoes_the_token_back()
    {
        var (service, ctx, _) = Build();

        var result = await service.ResolveAsync(
            new ResolveRealtimeSessionRequest(TokenFor(ctx, ctx.Leader.Id, null), null, "482913"),
            CancellationToken.None);

        // So o caminho do ticket devolve o token; no caminho normal quem chamou ja o tem, e
        // repeti-lo seria espalhar uma credencial sem necessidade.
        Assert.Null(result.SessionToken);
    }

    [Fact]
    public async Task An_expired_ticket_is_unauthenticated()
    {
        var (service, ctx, tickets) = Build();
        var sessionToken = TokenFor(ctx, ctx.Leader.Id, null);
        var ticket = await tickets.IssueAsync(sessionToken, TimeSpan.FromSeconds(-1), CancellationToken.None);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            service.ResolveAsync(new ResolveRealtimeSessionRequest(null, ticket, "482913"), CancellationToken.None));

        Assert.Equal(ErrorCodes.Unauthenticated, error.Code);
    }

    [Fact]
    public async Task A_ticket_is_not_issued_over_an_invalid_session()
    {
        var (service, _, _) = Build();

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            service.IssueTicketAsync("nao-e-um-token", TimeSpan.FromSeconds(30), CancellationToken.None));

        Assert.Equal(ErrorCodes.Unauthenticated, error.Code);
    }
}
