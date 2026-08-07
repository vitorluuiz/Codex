using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Matches;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Tests;

/// <summary>
/// O fim da partida: encerramento automatico quando a fila acaba, e a volta ao lobby de cada um.
///
/// Nasceu de quatro defeitos relatados de uma vez — a partida que nunca acabava, a fase que nunca
/// fechava por tempo, o podio que sumia no F5 e o envio atrasado que estourava erro. Os dois
/// primeiros sao de servidor e estao aqui; os dois ultimos sao de tela.
/// </summary>
public class MatchEndingTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly StartMatchRequest Live = new("live");

    private static async Task<(RoomTestContext Ctx, MatchDto Match, List<Participant> Players)> PlayingAsync(
        int phaseCount = 1,
        int playerCount = 1)
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPlayableSet(ctx.Leader, "Frações", phaseCount));

        var players = Enumerable.Range(1, playerCount).Select(i => ctx.AddParticipant($"Aluno {i}")).ToList();
        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        return (ctx, match, players);
    }

    private static async Task Submit(RoomTestContext ctx, MatchDto match, Participant player)
    {
        var phaseId = (await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct)).Phase.Id;
        await ctx.Submissions.SubmitAsync(
            match.Id.ToString(),
            phaseId.ToString(),
            new SubmitAnswerRequest(new AnswerDto("quiz", OptionId: "o1")),
            ctx.AsParticipant(player.Id),
            Ct);
    }

    /* ------------------------------------------------- encerramento automatico */

    /// <summary>
    /// "Logo que as fases acabam, a partida deve ser encerrada." Sem isto a turma via a comparacao
    /// da ultima fase e ficava esperando um proximo passo que so o lider poderia dar — e nao havia
    /// para onde avancar, porque <c>advance</c> recusa depois da ultima fase.
    /// </summary>
    [Fact]
    public async Task Last_submission_of_the_last_phase_finishes_the_match()
    {
        var (ctx, match, players) = await PlayingAsync();

        await Submit(ctx, match, players[0]);

        var finished = ctx.Db.Matches.Single();
        Assert.Equal(MatchStatus.Finished, finished.Status);
        Assert.NotNull(finished.FinishedAt);
        Assert.Single(ctx.Realtime.OfType<MatchFinishedEvent>());
    }

    /// <summary>
    /// O outro caminho do mesmo fim: ninguem respondeu e o cronometro venceu. E o caso que o
    /// fechamento preguicoso precisa cobrir — quem chega depois do fim do relogio fecha a fase, e
    /// sendo ela a ultima, encerra a partida junto.
    /// </summary>
    [Fact]
    public async Task Expired_last_phase_finishes_the_match_too()
    {
        var (ctx, match, _) = await PlayingAsync();

        ctx.Db.Matches.Single().CurrentPhaseEndsAt = DateTimeOffset.UtcNow.AddSeconds(-1);
        await ctx.Db.SaveChangesAsync(Ct);

        // Uma leitura qualquer serve de gatilho: e assim que a fase vencida fecha.
        await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(MatchStatus.Finished, ctx.Db.Matches.Single().Status);
        Assert.Single(ctx.Realtime.OfType<PhaseEndedEvent>());
        Assert.Single(ctx.Realtime.OfType<MatchFinishedEvent>());
    }

    /// <summary>Fechar uma fase do meio da fila nao encerra nada — so a ultima encerra.</summary>
    [Fact]
    public async Task Closing_a_middle_phase_does_not_finish_the_match()
    {
        var (ctx, match, players) = await PlayingAsync(phaseCount: 2);

        await Submit(ctx, match, players[0]);

        Assert.Equal(MatchStatus.Running, ctx.Db.Matches.Single().Status);
        Assert.Empty(ctx.Realtime.OfType<MatchFinishedEvent>());
    }

    /// <summary>
    /// O podio da partida que acabou de terminar nao pode sair vazio. Encerrar marca todos os
    /// jogadores como "nos resultados", e o filtro que tira essas pessoas da contagem da proxima
    /// partida esvaziaria justamente o podio desta se valesse tambem para partida encerrada.
    /// </summary>
    [Fact]
    public async Task Podium_of_the_match_that_just_ended_still_has_its_players()
    {
        var (ctx, match, players) = await PlayingAsync(playerCount: 2);

        await Submit(ctx, match, players[0]);
        await Submit(ctx, match, players[1]);

        var podium = await ctx.Matches.GetPodiumAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(2, podium.Count);
        Assert.All(ctx.Db.Participants, p => Assert.NotNull(p.InResultsSince));
    }

    /* ------------------------------------------------------ voltar para o lobby */

    /// <summary>
    /// Encerrar deixou de arrastar a turma de volta: cada um sai do podio quando quiser, e ate la
    /// fica marcado.
    /// </summary>
    [Fact]
    public async Task Finishing_leaves_everyone_marked_as_in_results()
    {
        var (ctx, match, players) = await PlayingAsync(phaseCount: 2, playerCount: 2);

        await ctx.Matches.FinishAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.All(ctx.Db.Participants, p => Assert.NotNull(p.InResultsSince));

        var listed = await ctx.Participants.ListAsync(ctx.Room.Code, "approved", ctx.AsLeader, Ct);
        Assert.All(listed, p => Assert.True(p.InResults));

        // …e o lider voltar ao lobby continua nao voltando por ninguem.
        await ctx.Matches.ReturnToLobbyAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        Assert.All(ctx.Db.Participants, p => Assert.NotNull(p.InResultsSince));
    }

    [Fact]
    public async Task Participant_returns_to_the_lobby_by_themselves()
    {
        var (ctx, match, players) = await PlayingAsync();
        await Submit(ctx, match, players[0]);
        ctx.Realtime.Published.Clear();

        await ctx.Participants.ReturnToLobbyAsync(ctx.Room.Code, ctx.AsParticipant(players[0].Id), Ct);

        Assert.Null(ctx.Db.Participants.Single().InResultsSince);

        // O lobby do lider tira a marca sem refazer o GET.
        var updated = Assert.Single(ctx.Realtime.OfType<ParticipantUpdatedEvent>());
        Assert.False(updated.As<ParticipantUpdatedEvent>().Participant.InResults);
    }

    /// <summary>O botao sobrevive a um duplo clique e a uma volta pelo historico do navegador.</summary>
    [Fact]
    public async Task Returning_twice_publishes_nothing_the_second_time()
    {
        var (ctx, match, players) = await PlayingAsync();
        await Submit(ctx, match, players[0]);

        await ctx.Participants.ReturnToLobbyAsync(ctx.Room.Code, ctx.AsParticipant(players[0].Id), Ct);
        ctx.Realtime.Published.Clear();
        await ctx.Participants.ReturnToLobbyAsync(ctx.Room.Code, ctx.AsParticipant(players[0].Id), Ct);

        Assert.Empty(ctx.Realtime.OfType<ParticipantUpdatedEvent>());
    }

    [Fact]
    public async Task Leader_cannot_return_on_behalf_of_a_participant()
    {
        var (ctx, _, _) = await PlayingAsync();

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Participants.ReturnToLobbyAsync(ctx.Room.Code, ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.AccountRequired, error.Code);
    }

    /* --------------------------------------- quem nao voltou nao conta como jogador */

    /// <summary>
    /// O motivo funcional de <c>InResultsSince</c> existir: uma aba esquecida no podio entraria no
    /// <c>totalPlayers</c> da partida seguinte, e a regra "todos enviaram" nunca fecharia uma fase.
    /// </summary>
    [Fact]
    public async Task Player_still_on_the_results_screen_does_not_hold_the_next_match()
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPlayableSet(ctx.Leader, "Frações", phaseCount: 1));
        var stayed = ctx.AddParticipant("Ana Silva");
        var returned = ctx.AddParticipant("Bruno Costa");

        var first = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        await ctx.Matches.FinishAsync(first.Id.ToString(), ctx.AsLeader, Ct);
        await ctx.Matches.ReturnToLobbyAsync(first.Id.ToString(), ctx.AsLeader, Ct);

        // So o Bruno volta; a Ana ficou no podio.
        await ctx.Participants.ReturnToLobbyAsync(ctx.Room.Code, ctx.AsParticipant(returned.Id), Ct);

        var second = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var state = await ctx.Matches.GetCurrentPhaseAsync(second.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(1, state.TotalPlayers);

        // E o envio do unico jogador de verdade fecha a fase — e, sendo a ultima, a partida.
        await Submit(ctx, second, returned);
        Assert.Equal(MatchStatus.Finished, ctx.Db.Matches.OrderByDescending(m => m.StartedAt).First().Status);
        Assert.NotEqual(default, stayed.Id);
    }

    /// <summary>Sala sem ninguem no lobby (todos ainda no podio) nao comeca partida.</summary>
    [Fact]
    public async Task Starting_with_everyone_still_in_results_is_NO_PLAYERS()
    {
        var (ctx, match, _) = await PlayingAsync(phaseCount: 2);

        await ctx.Matches.FinishAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        await ctx.Matches.ReturnToLobbyAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.NoPlayers, error.Code);
    }

    /* ------------------------------------------------------------------ TTL */

    /// <summary>
    /// <c>finish</c> marca o TTL de 24 h; voltar ao lobby o desmarca. Sem isso a sala continuaria
    /// morrendo em 24 h — viva na tela, expirada no banco — e sumiria de "Voltar para a sala" no
    /// meio de uma aula.
    /// </summary>
    [Fact]
    public async Task Returning_to_the_lobby_clears_the_TTL_that_finishing_set()
    {
        var (ctx, match, _) = await PlayingAsync(phaseCount: 2);

        await ctx.Matches.FinishAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        Assert.NotNull(ctx.Room.ExpiresAt);

        await ctx.Matches.ReturnToLobbyAsync(match.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Null(ctx.Room.ExpiresAt);
        Assert.Equal(RoomStatus.Lobby, ctx.Room.Status);
        Assert.Single(await ctx.Rooms.ListActiveAsync(ctx.AsLeader, Ct));
    }
}
