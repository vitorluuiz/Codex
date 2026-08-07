using Codex.Api.Contracts.Rooms;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;

namespace Codex.Api.Tests;

/// <summary>
/// api-rest.md secao 4, GET /rooms/active — a lista que sustenta "Voltar para a sala" no perfil
/// do lider e na tela de entrar.
/// </summary>
public class ActiveRoomsTests
{
    [Fact]
    public async Task Leader_sees_the_room_they_left_behind()
    {
        var ctx = new RoomTestContext();

        var active = await ctx.Rooms.ListActiveAsync(ctx.AsLeader, CancellationToken.None);

        var room = Assert.Single(active);
        Assert.Equal(ctx.Room.Code, room.Code);
        Assert.Equal(RoomMembershipRole.Leader, room.Role);
        Assert.Equal(RoomStatus.Lobby, room.Status);
        Assert.Equal(ctx.Leader.Name, room.LeaderName);
    }

    /// <summary>"A sala pode estar em andamento para entrar" — retomar nao e privilegio do lobby.</summary>
    [Fact]
    public async Task Room_already_running_still_shows_up()
    {
        var ctx = new RoomTestContext(room =>
        {
            room.Status = RoomStatus.Running;
            room.MatchMode = MatchMode.Live;
        });

        var room = Assert.Single(await ctx.Rooms.ListActiveAsync(ctx.AsLeader, CancellationToken.None));

        Assert.Equal(RoomStatus.Running, room.Status);
        Assert.Equal(MatchMode.Live, room.MatchMode);
    }

    /// <summary>
    /// Encerrada sai da lista: retomar nao leva a lugar nenhum (EnsureJoinableAsync recusa entrada
    /// em sala finished) e o historico de partidas do perfil e onde ela deve ser lida.
    /// </summary>
    [Fact]
    public async Task Finished_room_is_not_offered()
    {
        var ctx = new RoomTestContext(room => room.Status = RoomStatus.Finished);

        Assert.Empty(await ctx.Rooms.ListActiveAsync(ctx.AsLeader, CancellationToken.None));
    }

    [Fact]
    public async Task Expired_room_is_not_offered()
    {
        var ctx = new RoomTestContext(room => room.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1));

        Assert.Empty(await ctx.Rooms.ListActiveAsync(ctx.AsLeader, CancellationToken.None));
    }

    [Fact]
    public async Task Someone_elses_room_never_appears()
    {
        var ctx = new RoomTestContext();
        var stranger = ctx.AddUser("Bruno Costa", "bruno@escola.br");

        Assert.Empty(await ctx.Rooms.ListActiveAsync(RoomTestContext.AsUser(stranger.Id), CancellationToken.None));
    }

    [Fact]
    public async Task No_session_is_an_empty_list_not_an_error()
    {
        var ctx = new RoomTestContext();

        Assert.Empty(await ctx.Rooms.ListActiveAsync(ctx.Anonymous, CancellationToken.None));
    }

    /// <summary>
    /// O convidado e quem faz a rota /sala funcionar sem digitar codigo de novo: ele nao tem
    /// conta, so o participantId do token.
    /// </summary>
    [Fact]
    public async Task Guest_participant_gets_the_room_of_their_token()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva");

        var room = Assert.Single(await ctx.Rooms.ListActiveAsync(ctx.AsParticipant(participant.Id), CancellationToken.None));

        Assert.Equal(ctx.Room.Code, room.Code);
        Assert.Equal(RoomMembershipRole.Participant, room.Role);
    }

    [Fact]
    public async Task Rejected_participant_has_no_room_to_return_to()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva", ParticipantStatus.Rejected);

        Assert.Empty(await ctx.Rooms.ListActiveAsync(ctx.AsParticipant(participant.Id), CancellationToken.None));
    }

    /// <summary>
    /// Quem entrou logado e reconhecido pelo userId gravado no Participant, e nao so pelo
    /// participantId — e o caminho de que a secao "perfil de participante" vai depender.
    /// </summary>
    [Fact]
    public async Task Logged_in_participant_is_found_by_user_id()
    {
        var ctx = new RoomTestContext();
        var player = ctx.AddUser("Ana Silva", "ana@escola.br");
        ctx.AddParticipant("Ana Silva", ParticipantStatus.Approved, player.Id);

        var room = Assert.Single(await ctx.Rooms.ListActiveAsync(RoomTestContext.AsUser(player.Id), CancellationToken.None));

        Assert.Equal(RoomMembershipRole.Participant, room.Role);
    }

    /// <summary>
    /// A fila e leader-only (403 NOT_ROOM_LEADER em GET /rooms/{code}/queue). O titulo do conjunto
    /// aqui contornaria essa regra por outra rota, entao ele — e a contagem de fases — nao sai
    /// para participante.
    /// </summary>
    [Fact]
    public async Task Queue_summary_goes_to_the_leader_only()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Fracoes & Funcoes Basicas", phaseCount: 3);
        await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, CancellationToken.None);

        var participant = ctx.AddParticipant("Ana Silva");

        var asLeader = Assert.Single(await ctx.Rooms.ListActiveAsync(ctx.AsLeader, CancellationToken.None));
        Assert.Equal("Fracoes & Funcoes Basicas", asLeader.SetTitle);
        Assert.Equal(3, asLeader.PhaseCount);

        var asPlayer = Assert.Single(await ctx.Rooms.ListActiveAsync(ctx.AsParticipant(participant.Id), CancellationToken.None));
        Assert.Null(asPlayer.SetTitle);
        Assert.Null(asPlayer.PhaseCount);
    }

    /// <summary>Mesma regra da linha do historico: o primeiro conjunto nomeia, o resto vira contagem.</summary>
    [Fact]
    public async Task Several_sets_collapse_into_one_title()
    {
        var ctx = new RoomTestContext();
        await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(ctx.AddPhaseSet(ctx.Leader, "Fracoes").Id.ToString()), ctx.AsLeader, CancellationToken.None);
        await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(ctx.AddPhaseSet(ctx.Leader, "Funcoes").Id.ToString()), ctx.AsLeader, CancellationToken.None);

        var room = Assert.Single(await ctx.Rooms.ListActiveAsync(ctx.AsLeader, CancellationToken.None));

        Assert.Equal("Fracoes +1", room.SetTitle);
    }

    [Fact]
    public async Task Empty_queue_still_names_the_room()
    {
        var ctx = new RoomTestContext();

        var room = Assert.Single(await ctx.Rooms.ListActiveAsync(ctx.AsLeader, CancellationToken.None));

        Assert.Equal("Sem conjunto", room.SetTitle);
        Assert.Equal(0, room.PhaseCount);
    }

    /// <summary>Aprovado e quem a tela chama de participante; pendente ainda espera o lider.</summary>
    [Fact]
    public async Task Participant_count_only_counts_the_approved()
    {
        var ctx = new RoomTestContext();
        ctx.AddParticipant("Ana Silva");
        ctx.AddParticipant("Bruno Costa");
        ctx.AddParticipant("Carla Souza", ParticipantStatus.Pending);

        var room = Assert.Single(await ctx.Rooms.ListActiveAsync(ctx.AsLeader, CancellationToken.None));

        Assert.Equal(2, room.ParticipantCount);
    }

    [Fact]
    public async Task Most_recent_room_comes_first()
    {
        var ctx = new RoomTestContext();
        var older = AddRoom(ctx, "111111", ctx.Room.CreatedAt.AddHours(-2));
        var newer = AddRoom(ctx, "222222", ctx.Room.CreatedAt.AddHours(2));

        var codes = (await ctx.Rooms.ListActiveAsync(ctx.AsLeader, CancellationToken.None))
            .Select(r => r.Code)
            .ToList();

        Assert.Equal([newer.Code, ctx.Room.Code, older.Code], codes);
    }

    /// <summary>
    /// O teto existe porque, sem TTL preenchido (next-steps.md §1), "sala ativa" e "sala que
    /// ninguem encerrou" — um professor que abre uma sala por aula acumularia a lista inteira.
    /// </summary>
    [Fact]
    public async Task List_is_capped_at_ten_rooms()
    {
        var ctx = new RoomTestContext();
        for (var index = 0; index < 15; index++)
        {
            AddRoom(ctx, $"9000{index:D2}", ctx.Room.CreatedAt.AddMinutes(index + 1));
        }

        var active = await ctx.Rooms.ListActiveAsync(ctx.AsLeader, CancellationToken.None);

        Assert.Equal(10, active.Count);
        // As dez mais recentes, nao dez quaisquer: a mais antiga (a semeada pelo contexto) fica de fora.
        Assert.DoesNotContain(ctx.Room.Code, active.Select(r => r.Code));
    }

    private static Room AddRoom(RoomTestContext ctx, string code, DateTimeOffset createdAt)
    {
        var room = new Room
        {
            Code = code,
            Capacity = 20,
            LeaderUserId = ctx.Leader.Id,
            Leader = ctx.Leader,
            CreatedAt = createdAt,
        };
        ctx.Db.Rooms.Add(room);
        ctx.Db.SaveChanges();
        return room;
    }
}
