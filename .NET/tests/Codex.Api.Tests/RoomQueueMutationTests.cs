using Codex.Api.Common.Errors;
using Codex.Api.Common.Realtime;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Domain;
using Codex.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Tests;

/// <summary>
/// api-rest.md secao 6 — as mutacoes da fila. A leitura esta em <see cref="RoomQueueTests"/>.
/// </summary>
public class RoomQueueMutationTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    /* ---------------------------------------------------------------- POST /queue/sets */

    [Fact]
    public async Task Adding_a_set_appends_its_phases_and_returns_the_whole_queue()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 3);

        var queue = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var only = Assert.Single(queue.Sets);
        Assert.Equal("Frações", only.Title);
        Assert.Equal(3, only.PhaseCount);
        Assert.Equal(3, queue.Phases.Count);
    }

    /// <summary>
    /// A rota nova e a criacao de sala com "setId" tem que passar pelo mesmo AppendSetAsync — se
    /// uma das duas reimplementasse a paleta, a sala criada com conjunto e a que recebeu depois
    /// divergiriam na cor.
    /// </summary>
    [Fact]
    public async Task Second_set_gets_the_next_color_of_the_palette()
    {
        var ctx = new RoomTestContext();
        var first = ctx.AddPhaseSet(ctx.Leader, "Primeiro", phaseCount: 1);
        var second = ctx.AddPhaseSet(ctx.Leader, "Segundo", phaseCount: 1);

        await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(first.Id.ToString()), ctx.AsLeader, Ct);
        var queue = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(second.Id.ToString()), ctx.AsLeader, Ct);

        Assert.Equal([RoomQueueService.Palette[0], RoomQueueService.Palette[1]], queue.Sets.Select(s => s.Color));
    }

    [Fact]
    public async Task Ninth_set_is_TOO_MANY_SETS()
    {
        var ctx = new RoomTestContext();

        for (var index = 0; index < RoomQueueService.MaxSetsPerRoom; index++)
        {
            var filler = ctx.AddPhaseSet(ctx.Leader, $"Conjunto {index}", phaseCount: 1);
            await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(filler.Id.ToString()), ctx.AsLeader, Ct);
        }

        var extra = ctx.AddPhaseSet(ctx.Leader, "O nono", phaseCount: 1);
        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(extra.Id.ToString()), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.TooManySets, exception.Code);
        Assert.Equal(StatusCodes.Status409Conflict, exception.StatusCode);
    }

    /// <summary>Jogar numa sala o conjunto que outra pessoa publicou e o caso de uso da aba "Comunidade".</summary>
    [Fact]
    public async Task Community_set_of_another_author_can_be_queued()
    {
        var ctx = new RoomTestContext();
        var author = ctx.AddUser("Prof. Marcos", "marcos@escola.br");
        var set = ctx.AddPhaseSet(author, "Álgebra para o ENEM", phaseCount: 2, visibility: PhaseSetVisibility.Community);

        var queue = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        Assert.Equal(2, queue.Phases.Count);
    }

    [Fact]
    public async Task Private_set_of_another_author_is_PHASE_SET_NOT_FOUND()
    {
        var ctx = new RoomTestContext();
        var author = ctx.AddUser("Prof. Marcos", "marcos@escola.br");
        var set = ctx.AddPhaseSet(author, "Rascunho particular", phaseCount: 2);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.PhaseSetNotFound, exception.Code);
        Assert.Equal(StatusCodes.Status404NotFound, exception.StatusCode);
    }

    [Fact]
    public async Task Malformed_set_id_is_404_and_not_a_500()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest("nao-e-um-guid"), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.PhaseSetNotFound, exception.Code);
    }

    /// <summary>
    /// Nada impede o mesmo conjunto de entrar duas vezes: "setId" na resposta e o id da linha da
    /// fila, entao sao duas linhas com cores proprias e removiveis em separado.
    /// </summary>
    [Fact]
    public async Task Same_set_twice_becomes_two_independent_rows()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 2);

        await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);
        var queue = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        Assert.Equal(2, queue.Sets.Count);
        Assert.NotEqual(queue.Sets[0].SetId, queue.Sets[1].SetId);
        Assert.NotEqual(queue.Sets[0].Color, queue.Sets[1].Color);
        Assert.Equal(4, queue.Phases.Count);
    }

    /* -------------------------------------------------------------- DELETE /queue/sets */

    [Fact]
    public async Task Removing_a_set_takes_its_phases_with_it()
    {
        var ctx = new RoomTestContext();
        var first = ctx.AddPhaseSet(ctx.Leader, "Primeiro", phaseCount: 2);
        var second = ctx.AddPhaseSet(ctx.Leader, "Segundo", phaseCount: 3);
        await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(first.Id.ToString()), ctx.AsLeader, Ct);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(second.Id.ToString()), ctx.AsLeader, Ct);

        var queue = await ctx.Queue.RemoveSetAsync(ctx.Room.Code, before.Sets[0].SetId.ToString(), ctx.AsLeader, Ct);

        var only = Assert.Single(queue.Sets);
        Assert.Equal("Segundo", only.Title);
        Assert.Equal(3, queue.Phases.Count);
    }

    /// <summary>
    /// AppendSetAsync calcula a proxima posicao contando as linhas existentes, entao remover do
    /// meio precisa renumerar — senao a proxima fase adicionada empata com uma que ja esta la.
    /// </summary>
    [Fact]
    public async Task Order_stays_contiguous_after_removing_a_set()
    {
        var ctx = new RoomTestContext();
        var first = ctx.AddPhaseSet(ctx.Leader, "Primeiro", phaseCount: 2);
        var second = ctx.AddPhaseSet(ctx.Leader, "Segundo", phaseCount: 2);
        await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(first.Id.ToString()), ctx.AsLeader, Ct);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(second.Id.ToString()), ctx.AsLeader, Ct);

        await ctx.Queue.RemoveSetAsync(ctx.Room.Code, before.Sets[0].SetId.ToString(), ctx.AsLeader, Ct);
        var third = ctx.AddPhaseSet(ctx.Leader, "Terceiro", phaseCount: 1);
        var queue = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(third.Id.ToString()), ctx.AsLeader, Ct);

        var orders = await ctx.Db.RoomQueuePhases
            .Where(p => p.RoomId == ctx.Room.Id)
            .OrderBy(p => p.OrderIndex)
            .Select(p => p.OrderIndex)
            .ToListAsync();

        Assert.Equal([0, 1, 2], orders);
        Assert.Equal(3, queue.Phases.Count);
        Assert.Equal("Terceiro", queue.Sets[^1].Title);
    }

    /// <summary>A vaga e a cor voltam para a paleta: sem isso, 8 adicoes e 8 remocoes travariam a sala para sempre.</summary>
    [Fact]
    public async Task Removing_a_set_frees_its_slot_and_color()
    {
        var ctx = new RoomTestContext();
        var first = ctx.AddPhaseSet(ctx.Leader, "Primeiro", phaseCount: 1);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(first.Id.ToString()), ctx.AsLeader, Ct);

        await ctx.Queue.RemoveSetAsync(ctx.Room.Code, before.Sets[0].SetId.ToString(), ctx.AsLeader, Ct);

        var second = ctx.AddPhaseSet(ctx.Leader, "Segundo", phaseCount: 1);
        var queue = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(second.Id.ToString()), ctx.AsLeader, Ct);

        Assert.Equal(RoomQueueService.Palette[0], Assert.Single(queue.Sets).Color);
    }

    [Fact]
    public async Task Removing_a_set_of_another_room_is_PHASE_SET_NOT_FOUND()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 1);
        var queue = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var otherRoom = new Codex.Api.Domain.Entities.Room
        {
            Code = "100200",
            Capacity = 20,
            LeaderUserId = ctx.Leader.Id,
            Leader = ctx.Leader,
        };
        ctx.Db.Rooms.Add(otherRoom);
        await ctx.Db.SaveChangesAsync();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.RemoveSetAsync(otherRoom.Code, queue.Sets[0].SetId.ToString(), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.PhaseSetNotFound, exception.Code);
    }

    /* --------------------------------------------------------------- PATCH /queue/sets */

    [Fact]
    public async Task Patching_a_set_applies_the_three_values_to_all_of_its_phases()
    {
        var ctx = new RoomTestContext();
        var target = ctx.AddPhaseSet(ctx.Leader, "Alvo", phaseCount: 2);
        var other = ctx.AddPhaseSet(ctx.Leader, "Outro", phaseCount: 1);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(target.Id.ToString()), ctx.AsLeader, Ct);
        await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(other.Id.ToString()), ctx.AsLeader, Ct);

        var targetSetId = before.Sets[0].SetId;
        var queue = await ctx.Queue.UpdateSetAsync(
            ctx.Room.Code,
            targetSetId.ToString(),
            new UpdateQueueSetRequest(150, 2m, 60),
            ctx.AsLeader,
            Ct);

        var patched = queue.Phases.Where(p => p.SetId == targetSetId).ToList();
        Assert.Equal(2, patched.Count);
        Assert.All(patched, phase =>
        {
            Assert.Equal(150, phase.BasePoints);
            Assert.Equal(2m, phase.PointsMultiplier);
            Assert.Equal(60, phase.TimeSeconds);
        });

        // O outro conjunto na mesma sala nao pode ter sido tocado.
        var untouched = Assert.Single(queue.Phases, p => p.SetId != targetSetId);
        Assert.Equal(100, untouched.BasePoints);
        Assert.Equal(45, untouched.TimeSeconds);
    }

    /// <summary>Campo ausente e campo inalterado — um PATCH que zera o que voce omitiu seria um PUT.</summary>
    [Fact]
    public async Task Omitted_fields_of_the_set_patch_keep_their_value()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Alvo", phaseCount: 1);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var queue = await ctx.Queue.UpdateSetAsync(
            ctx.Room.Code,
            before.Sets[0].SetId.ToString(),
            new UpdateQueueSetRequest(null, null, 90),
            ctx.AsLeader,
            Ct);

        var phase = Assert.Single(queue.Phases);
        Assert.Equal(100, phase.BasePoints);
        Assert.Equal(1m, phase.PointsMultiplier);
        Assert.Equal(90, phase.TimeSeconds);
    }

    /* ------------------------------------------------------------- PATCH /queue/phases */

    [Fact]
    public async Task Patching_a_phase_touches_only_that_phase()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 2);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var queue = await ctx.Queue.UpdatePhaseAsync(
            ctx.Room.Code,
            before.Phases[0].Id.ToString(),
            new UpdateQueuePhaseRequest("Nome novo", 250, 1.5m, 30, null),
            ctx.AsLeader,
            Ct);

        Assert.Equal("Nome novo", queue.Phases[0].Name);
        Assert.Equal(250, queue.Phases[0].BasePoints);
        Assert.Equal(1.5m, queue.Phases[0].PointsMultiplier);
        Assert.Equal(30, queue.Phases[0].TimeSeconds);
        Assert.Equal("Fase 2", queue.Phases[1].Name);
        Assert.Equal(100, queue.Phases[1].BasePoints);
    }

    /// <summary>
    /// A copia e o ponto: ajustar a fase para esta turma nao pode reescrever a biblioteca do autor
    /// nem a fila de outra sala que enfileirou o mesmo conjunto.
    /// </summary>
    [Fact]
    public async Task Patching_a_queued_phase_does_not_touch_the_source_set()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 1);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        await ctx.Queue.UpdatePhaseAsync(
            ctx.Room.Code,
            before.Phases[0].Id.ToString(),
            new UpdateQueuePhaseRequest("Renomeada na sala", 999, null, null, null),
            ctx.AsLeader,
            Ct);

        var source = await ctx.Db.Phases.SingleAsync(p => p.PhaseSetId == set.Id);
        Assert.Equal("Fase 1", source.Name);
        Assert.Equal(100, source.BasePoints);
    }

    [Fact]
    public async Task Expected_answer_is_written_into_the_content_of_a_text_phase()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Dissertativas", PhaseKind.Text, new PhaseContent(Question: "Explique frações equivalentes"));
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);
        var phaseId = before.Phases[0].Id;

        await ctx.Queue.UpdatePhaseAsync(
            ctx.Room.Code,
            phaseId.ToString(),
            new UpdateQueuePhaseRequest(null, null, null, null, "Duas frações são equivalentes quando…"),
            ctx.AsLeader,
            Ct);

        var detail = await ctx.Queue.GetPhaseDetailAsync(ctx.Room.Code, phaseId.ToString(), ctx.AsLeader, Ct);

        Assert.Equal("Duas frações são equivalentes quando…", detail.ExpectedAnswer);
        // O resto do ContentJson sobreviveu: a gravacao reserializa o conteudo, nao remenda a string.
        Assert.Equal("Explique frações equivalentes", detail.Question);
    }

    [Fact]
    public async Task Expected_answer_on_a_quiz_is_VALIDATION_ERROR()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 1);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.UpdatePhaseAsync(
                ctx.Room.Code,
                before.Phases[0].Id.ToString(),
                new UpdateQueuePhaseRequest(null, null, null, null, "gabarito"),
                ctx.AsLeader,
                Ct));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
        Assert.Equal(StatusCodes.Status400BadRequest, exception.StatusCode);
    }

    /// <summary>
    /// Os mesmos limites do editor (secao 5), agora em PhaseLimits: gravar pela fila um tempo que o
    /// editor recusaria deixaria a fase invalida sem nunca ter passado por uma validacao.
    /// </summary>
    [Theory]
    [InlineData(null, null, 1)]
    [InlineData(null, null, 99_999)]
    [InlineData(-1, null, null)]
    [InlineData(null, 50, null)]
    public async Task Numbers_out_of_range_are_VALIDATION_ERROR(int? basePoints, int? multiplier, int? timeSeconds)
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 1);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.UpdatePhaseAsync(
                ctx.Room.Code,
                before.Phases[0].Id.ToString(),
                new UpdateQueuePhaseRequest(null, basePoints, multiplier, timeSeconds, null),
                ctx.AsLeader,
                Ct));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    /* ------------------------------------------------------------ DELETE /queue/phases */

    [Fact]
    public async Task Removing_a_phase_renumbers_the_rest()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 3);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var queue = await ctx.Queue.RemovePhaseAsync(ctx.Room.Code, before.Phases[1].Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal([before.Phases[0].Id, before.Phases[2].Id], queue.Phases.Select(p => p.Id));
        Assert.Equal(2, Assert.Single(queue.Sets).PhaseCount);

        var orders = await ctx.Db.RoomQueuePhases.OrderBy(p => p.OrderIndex).Select(p => p.OrderIndex).ToListAsync();
        Assert.Equal([0, 1], orders);
    }

    /// <summary>Um conjunto sem fase nenhuma ocuparia uma das 8 vagas e uma das 8 cores sem nada dentro.</summary>
    [Fact]
    public async Task Removing_the_last_phase_of_a_set_removes_the_set_too()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 1);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var queue = await ctx.Queue.RemovePhaseAsync(ctx.Room.Code, before.Phases[0].Id.ToString(), ctx.AsLeader, Ct);

        Assert.Empty(queue.Sets);
        Assert.Empty(queue.Phases);
    }

    [Fact]
    public async Task Phase_of_another_room_is_PHASE_NOT_FOUND()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 1);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var otherRoom = new Codex.Api.Domain.Entities.Room
        {
            Code = "100200",
            Capacity = 20,
            LeaderUserId = ctx.Leader.Id,
            Leader = ctx.Leader,
        };
        ctx.Db.Rooms.Add(otherRoom);
        await ctx.Db.SaveChangesAsync();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.RemovePhaseAsync(otherRoom.Code, before.Phases[0].Id.ToString(), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.PhaseNotFound, exception.Code);
        Assert.Equal(StatusCodes.Status404NotFound, exception.StatusCode);
    }

    /* ---------------------------------------------------------------- PUT /queue/order */

    [Fact]
    public async Task Reordering_with_exactly_the_current_ids_rewrites_the_queue()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 3);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var reversed = before.Phases.Select(p => p.Id.ToString()).Reverse().ToList();
        var queue = await ctx.Queue.ReorderAsync(ctx.Room.Code, new ReorderQueueRequest(reversed), ctx.AsLeader, Ct);

        Assert.Equal(reversed, queue.Phases.Select(p => p.Id.ToString()));
    }

    [Fact]
    public async Task Reordering_with_a_missing_id_is_QUEUE_MISMATCH()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 3);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var incomplete = before.Phases.Take(2).Select(p => p.Id.ToString()).ToList();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.ReorderAsync(ctx.Room.Code, new ReorderQueueRequest(incomplete), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.QueueMismatch, exception.Code);
        Assert.Equal(StatusCodes.Status409Conflict, exception.StatusCode);
    }

    /// <summary>
    /// O caso que a rota existe para pegar: a outra aba do lider removeu uma fase, e esta aqui
    /// mandou a ordem da fila que ela tinha em tela.
    /// </summary>
    [Fact]
    public async Task Reordering_a_queue_that_changed_underneath_is_QUEUE_MISMATCH()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 3);
        var stale = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        await ctx.Queue.RemovePhaseAsync(ctx.Room.Code, stale.Phases[0].Id.ToString(), ctx.AsLeader, Ct);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.ReorderAsync(
                ctx.Room.Code,
                new ReorderQueueRequest(stale.Phases.Select(p => p.Id.ToString()).ToList()),
                ctx.AsLeader,
                Ct));

        Assert.Equal(ErrorCodes.QueueMismatch, exception.Code);
    }

    /// <summary>["a","a"] tem os mesmos ids distintos que ["a"] — sem contar, passaria como "bateu".</summary>
    [Fact]
    public async Task Reordering_with_a_repeated_id_is_QUEUE_MISMATCH()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 2);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var repeated = new List<string> { before.Phases[0].Id.ToString(), before.Phases[0].Id.ToString() };

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.ReorderAsync(ctx.Room.Code, new ReorderQueueRequest(repeated), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.QueueMismatch, exception.Code);
    }

    [Fact]
    public async Task Reordering_with_a_malformed_id_is_QUEUE_MISMATCH_and_not_a_500()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 2);
        var before = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        var ids = new List<string> { before.Phases[0].Id.ToString(), "nao-e-um-guid" };

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.ReorderAsync(ctx.Room.Code, new ReorderQueueRequest(ids), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.QueueMismatch, exception.Code);
    }

    /* --------------------------------------------------------- revisao e queue.updated */

    /// <summary>
    /// Toda mutacao publica queue.updated no canal da sala, com a revisao nova. "Manda so o numero
    /// de proposito: a fila so interessa ao lider, e ele e quem acabou de muda-la."
    /// </summary>
    [Fact]
    public async Task Every_mutation_publishes_queue_updated_with_a_growing_revision()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 2);

        var queue = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);
        await ctx.Queue.UpdatePhaseAsync(
            ctx.Room.Code,
            queue.Phases[0].Id.ToString(),
            new UpdateQueuePhaseRequest(null, 200, null, null, null),
            ctx.AsLeader,
            Ct);
        await ctx.Queue.RemovePhaseAsync(ctx.Room.Code, queue.Phases[0].Id.ToString(), ctx.AsLeader, Ct);

        var events = ctx.Realtime.OfType<QueueUpdatedEvent>().ToList();
        Assert.Equal(3, events.Count);
        Assert.All(events, published => Assert.Equal(RealtimeChannels.Room(ctx.Room.Code), published.Channel));
        // Cresce inclusive no PATCH, que nao muda a quantidade de fases: uma revisao que as vezes
        // repete faria o cliente descartar uma mudanca real achando que ja a tinha visto.
        Assert.Equal([1, 2, 3], events.Select(e => e.As<QueueUpdatedEvent>().Revision));
    }

    [Fact]
    public async Task A_failed_mutation_publishes_nothing_and_does_not_bump_the_revision()
    {
        var ctx = new RoomTestContext();

        await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(Guid.NewGuid().ToString()), ctx.AsLeader, Ct));

        Assert.Empty(ctx.Realtime.Published);
        Assert.Equal(0, (await ctx.Db.Rooms.SingleAsync(r => r.Id == ctx.Room.Id)).QueueRevision);
    }

    /* ----------------------------------------------------------------- autorizacao */

    [Fact]
    public async Task Participant_cannot_mutate_the_queue()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 1);
        var participant = ctx.AddParticipant("Ana Silva");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.AddSetAsync(
                ctx.Room.Code,
                new AddQueueSetRequest(set.Id.ToString()),
                ctx.AsParticipant(participant.Id),
                Ct));

        Assert.Equal(ErrorCodes.NotRoomLeader, exception.Code);
        Assert.Equal(StatusCodes.Status403Forbidden, exception.StatusCode);
    }

    [Fact]
    public async Task Participant_cannot_read_the_phase_detail()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 1);
        var queue = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);
        var participant = ctx.AddParticipant("Ana Silva");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.GetPhaseDetailAsync(
                ctx.Room.Code,
                queue.Phases[0].Id.ToString(),
                ctx.AsParticipant(participant.Id),
                Ct));

        Assert.Equal(ErrorCodes.NotRoomLeader, exception.Code);
    }

    /// <summary>
    /// Guarda para a secao 7: reordenar a fila embaixo de uma partida em andamento moveria a fase
    /// corrente por baixo dos alunos. Hoje nada tira a sala de "lobby" sem SQL, e e assim que o
    /// teste a coloca em "running".
    /// </summary>
    [Fact]
    public async Task Queue_cannot_be_mutated_once_the_room_left_the_lobby()
    {
        var ctx = new RoomTestContext(room => room.Status = RoomStatus.Running);
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 1);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.MatchAlreadyStarted, exception.Code);
        Assert.Equal(StatusCodes.Status409Conflict, exception.StatusCode);
    }

    /// <summary>Ler o desafio nao muda nada — conferir a fase durante a partida e o proprio ponto da previa do lider.</summary>
    [Fact]
    public async Task Phase_detail_is_still_readable_after_the_match_started()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 1);
        var queue = await ctx.Queue.AddSetAsync(ctx.Room.Code, new AddQueueSetRequest(set.Id.ToString()), ctx.AsLeader, Ct);

        ctx.Room.Status = RoomStatus.Running;
        await ctx.Db.SaveChangesAsync();

        var detail = await ctx.Queue.GetPhaseDetailAsync(ctx.Room.Code, queue.Phases[0].Id.ToString(), ctx.AsLeader, Ct);

        Assert.Equal(PhaseKind.Quiz, detail.Kind);
    }
}
