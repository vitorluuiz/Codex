using System.Text.Json;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Json;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Tests;

/// <summary>api-rest.md secao 5 — biblioteca de conjuntos e editor.</summary>
public class PhaseSetServiceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    /* ---------------------------------------------------------------- */
    /* GET /phase-sets                                                    */
    /* ---------------------------------------------------------------- */

    [Fact]
    public async Task Owned_scope_lists_own_sets_with_updated_label()
    {
        var ctx = new RoomTestContext();
        ctx.AddPhaseSet(ctx.Leader, "Frações & Funções Básicas", phaseCount: 3);

        var sets = await ctx.PhaseSets.ListAsync("owned", null, ctx.AsLeader, Ct);

        var only = Assert.Single(sets);
        Assert.Equal("Frações & Funções Básicas", only.Title);
        Assert.Equal(3, only.PhaseCount);
        Assert.Equal(PhaseSetSource.Owned, only.Source);
        Assert.Equal("editado agora", only.UpdatedLabel);
        Assert.Null(only.AuthorName);
    }

    [Fact]
    public async Task Owned_scope_is_the_default_and_hides_other_peoples_sets()
    {
        var ctx = new RoomTestContext();
        var other = ctx.AddUser("Prof. Marcos", "marcos@escola.br");
        ctx.AddPhaseSet(ctx.Leader, "Meu conjunto");
        ctx.AddPhaseSet(other, "Álgebra para o ENEM", visibility: PhaseSetVisibility.Community);

        var sets = await ctx.PhaseSets.ListAsync(null, null, ctx.AsLeader, Ct);

        Assert.Equal(["Meu conjunto"], sets.Select(s => s.Title));
    }

    [Fact]
    public async Task Community_scope_names_the_author_and_omits_the_edited_label()
    {
        var ctx = new RoomTestContext();
        var other = ctx.AddUser("Prof. Marcos", "marcos@escola.br");
        ctx.AddPhaseSet(other, "Álgebra para o ENEM", phaseCount: 10, visibility: PhaseSetVisibility.Community);
        ctx.AddPhaseSet(other, "Rascunho particular");

        var only = Assert.Single(await ctx.PhaseSets.ListAsync("community", null, ctx.AsLeader, Ct));

        Assert.Equal("Álgebra para o ENEM", only.Title);
        Assert.Equal(10, only.PhaseCount);
        Assert.Equal(PhaseSetSource.Community, only.Source);
        Assert.Equal("Prof. Marcos", only.AuthorName);
        Assert.Null(only.UpdatedLabel);
    }

    [Fact]
    public async Task Community_scope_does_not_repeat_what_the_caller_already_sees_in_owned()
    {
        var ctx = new RoomTestContext();
        ctx.AddPhaseSet(ctx.Leader, "Publicado por mim", visibility: PhaseSetVisibility.Community);

        Assert.Empty(await ctx.PhaseSets.ListAsync("community", null, ctx.AsLeader, Ct));
        Assert.Single(await ctx.PhaseSets.ListAsync("owned", null, ctx.AsLeader, Ct));
    }

    [Fact]
    public async Task Search_is_case_insensitive_and_matches_the_middle_of_the_title()
    {
        var ctx = new RoomTestContext();
        ctx.AddPhaseSet(ctx.Leader, "Frações & Funções Básicas");
        ctx.AddPhaseSet(ctx.Leader, "Geometria plana");

        var sets = await ctx.PhaseSets.ListAsync("owned", "  FUNÇÕES ", ctx.AsLeader, Ct);

        Assert.Equal(["Frações & Funções Básicas"], sets.Select(s => s.Title));
    }

    [Fact]
    public async Task Newest_edit_comes_first()
    {
        var ctx = new RoomTestContext();
        ctx.AddPhaseSet(ctx.Leader, "Antigo", updatedAt: DateTimeOffset.UtcNow.AddDays(-3));
        ctx.AddPhaseSet(ctx.Leader, "Recente", updatedAt: DateTimeOffset.UtcNow.AddMinutes(-5));

        var sets = await ctx.PhaseSets.ListAsync("owned", null, ctx.AsLeader, Ct);

        Assert.Equal(["Recente", "Antigo"], sets.Select(s => s.Title));
    }

    [Fact]
    public async Task Unknown_scope_is_a_validation_error_and_not_a_silent_default()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.PhaseSets.ListAsync("todos", null, ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task Owned_scope_without_an_account_is_ACCOUNT_REQUIRED()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.PhaseSets.ListAsync("owned", null, ctx.Anonymous, Ct));

        Assert.Equal(ErrorCodes.AccountRequired, exception.Code);
        Assert.Equal(StatusCodes.Status403Forbidden, exception.StatusCode);
    }

    /* ---------------------------------------------------------------- */
    /* POST /phase-sets e GET .../draft                                   */
    /* ---------------------------------------------------------------- */

    [Fact]
    public async Task Creating_replaces_the_local_draft_ids_and_keeps_the_array_order()
    {
        var ctx = new RoomTestContext();

        var draft = await ctx.PhaseSets.CreateAsync(
            new SavePhaseSetRequest("Frações", [Quiz(id: "draft_a", name: "Primeira"), Fill(id: "draft_b", name: "Segunda")]),
            ctx.AsLeader,
            Ct);

        Assert.Equal(["Primeira", "Segunda"], draft.Phases.Select(p => p.Name));
        Assert.All(draft.Phases, phase => Assert.True(Guid.TryParse(phase.Id, out _)));
        Assert.Equal([0, 1], (await ctx.Db.Phases.OrderBy(p => p.OrderIndex).ToListAsync()).Select(p => p.OrderIndex));
    }

    [Fact]
    public async Task A_set_with_no_phases_is_allowed_because_the_editor_saves_the_title_first()
    {
        var ctx = new RoomTestContext();

        var draft = await ctx.PhaseSets.CreateAsync(new SavePhaseSetRequest("Só o título", null), ctx.AsLeader, Ct);

        Assert.Empty(draft.Phases);
        Assert.Single(await ctx.PhaseSets.ListAsync("owned", null, ctx.AsLeader, Ct));
    }

    [Fact]
    public async Task A_new_set_is_private_until_someone_publishes_it()
    {
        var ctx = new RoomTestContext();

        var draft = await ctx.PhaseSets.CreateAsync(new SavePhaseSetRequest("Frações", []), ctx.AsLeader, Ct);

        var set = await ctx.Db.PhaseSets.SingleAsync(s => s.Id == draft.Id);
        Assert.Equal(PhaseSetVisibility.Private, set.Visibility);
    }

    [Fact]
    public async Task Quiz_survives_the_round_trip_and_carries_no_field_of_another_kind()
    {
        var ctx = new RoomTestContext();
        var created = await ctx.PhaseSets.CreateAsync(
            new SavePhaseSetRequest("Frações", [Quiz(options: ["4/6", "3/4", "5/9"], correct: [0, 2])]),
            ctx.AsLeader,
            Ct);

        var phase = Assert.Single((await ctx.PhaseSets.GetDraftAsync(created.Id.ToString(), ctx.AsLeader, Ct)).Phases);

        Assert.Equal(PhaseKind.Quiz, phase.Kind);
        Assert.Equal("Qual fração é equivalente a 2/3?", phase.Question);
        Assert.Equal(["4/6", "3/4", "5/9"], phase.Options);
        Assert.Equal([0, 2], phase.CorrectIndexes);
        // O que sai no JSON e a uniao discriminada de types.ts: uma QuizDraftPhase nao tem blanks.
        Assert.Null(phase.Blanks);
        Assert.Null(phase.Words);
        Assert.Null(phase.ExpectedAnswer);
        Assert.Null(phase.StarterCode);
    }

    [Fact]
    public async Task Fill_keeps_the_gap_answers_positional_including_the_unanswered_ones()
    {
        var ctx = new RoomTestContext();
        var created = await ctx.PhaseSets.CreateAsync(
            new SavePhaseSetRequest("Proporção", [Fill(blanks: [null, "proporção"])]),
            ctx.AsLeader,
            Ct);

        var phase = Assert.Single((await ctx.PhaseSets.GetDraftAsync(created.Id.ToString(), ctx.AsLeader, Ct)).Phases);

        Assert.Equal([null, "proporção"], phase.Blanks);
        Assert.Equal(["multiplicar", "somar", "proporção"], phase.Words);
        Assert.Null(phase.Options);
    }

    [Fact]
    public async Task Code_and_text_keep_the_fields_only_the_author_sees()
    {
        var ctx = new RoomTestContext();
        var created = await ctx.PhaseSets.CreateAsync(
            new SavePhaseSetRequest("Mistas", [Code(), Text()]),
            ctx.AsLeader,
            Ct);

        var phases = (await ctx.PhaseSets.GetDraftAsync(created.Id.ToString(), ctx.AsLeader, Ct)).Phases;

        Assert.Equal("function solucao(entrada) {}", phases[0].StarterCode);
        Assert.Equal("entrada: 2 -> saída: 4", phases[0].TestCases);
        Assert.Null(phases[0].ExpectedAnswer);
        Assert.Equal("Porque numerador e denominador são multiplicados pelo mesmo fator.", phases[1].ExpectedAnswer);
        Assert.Null(phases[1].StarterCode);
    }

    [Fact]
    public async Task FromAI_is_the_authors_flag_and_comes_back_as_it_went()
    {
        var ctx = new RoomTestContext();
        var created = await ctx.PhaseSets.CreateAsync(
            new SavePhaseSetRequest("Frações", [Quiz() with { FromAI = true }]),
            ctx.AsLeader,
            Ct);

        var phase = Assert.Single((await ctx.PhaseSets.GetDraftAsync(created.Id.ToString(), ctx.AsLeader, Ct)).Phases);

        Assert.True(phase.FromAI);
    }

    /* ---------------------------------------------------------------- */
    /* PUT /phase-sets/{setId}/draft                                      */
    /* ---------------------------------------------------------------- */

    [Fact]
    public async Task Saving_again_keeps_the_id_of_a_phase_that_already_had_one()
    {
        var ctx = new RoomTestContext();
        var created = await ctx.PhaseSets.CreateAsync(new SavePhaseSetRequest("Frações", [Quiz()]), ctx.AsLeader, Ct);
        var id = created.Phases[0].Id;

        var saved = await ctx.PhaseSets.ReplaceDraftAsync(
            created.Id.ToString(),
            new SavePhaseSetRequest("Frações", [Quiz(id: id, name: "Nome corrigido")]),
            ctx.AsLeader,
            Ct);

        Assert.Equal(id, saved.Phases[0].Id);
        Assert.Equal("Nome corrigido", saved.Phases[0].Name);
        Assert.Single(await ctx.Db.Phases.ToListAsync());
    }

    [Fact]
    public async Task What_the_editor_removed_is_deleted_and_the_rest_is_reordered()
    {
        var ctx = new RoomTestContext();
        var created = await ctx.PhaseSets.CreateAsync(
            new SavePhaseSetRequest("Frações", [Quiz(id: "draft_a", name: "A"), Quiz(id: "draft_b", name: "B")]),
            ctx.AsLeader,
            Ct);
        var second = created.Phases[1].Id;

        var saved = await ctx.PhaseSets.ReplaceDraftAsync(
            created.Id.ToString(),
            new SavePhaseSetRequest("Frações", [Quiz(id: second, name: "B"), Quiz(id: "draft_c", name: "C")]),
            ctx.AsLeader,
            Ct);

        Assert.Equal(["B", "C"], saved.Phases.Select(p => p.Name));
        Assert.Equal(second, saved.Phases[0].Id);
        Assert.Equal(2, await ctx.Db.Phases.CountAsync());
    }

    [Fact]
    public async Task A_phase_id_of_someone_elses_set_is_not_adopted()
    {
        var ctx = new RoomTestContext();
        var other = ctx.AddUser("Prof. Marcos", "marcos@escola.br");
        var stranger = ctx.AddPhaseSet(other, "Conjunto alheio", phaseCount: 1);
        var strangerPhase = await ctx.Db.Phases.FirstAsync(p => p.PhaseSetId == stranger.Id);
        var mine = await ctx.PhaseSets.CreateAsync(new SavePhaseSetRequest("Meu", []), ctx.AsLeader, Ct);

        var saved = await ctx.PhaseSets.ReplaceDraftAsync(
            mine.Id.ToString(),
            new SavePhaseSetRequest("Meu", [Quiz(id: strangerPhase.Id.ToString(), name: "Roubada")]),
            ctx.AsLeader,
            Ct);

        Assert.NotEqual(strangerPhase.Id.ToString(), saved.Phases[0].Id);
        Assert.Equal(stranger.Id, (await ctx.Db.Phases.SingleAsync(p => p.Id == strangerPhase.Id)).PhaseSetId);
    }

    [Fact]
    public async Task Saving_bumps_the_edited_label()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 0, updatedAt: DateTimeOffset.UtcNow.AddDays(-3));

        await ctx.PhaseSets.ReplaceDraftAsync(set.Id.ToString(), new SavePhaseSetRequest("Frações", []), ctx.AsLeader, Ct);

        var only = Assert.Single(await ctx.PhaseSets.ListAsync("owned", null, ctx.AsLeader, Ct));
        Assert.Equal("editado agora", only.UpdatedLabel);
    }

    /* ---------------------------------------------------------------- */
    /* Validacoes que o contrato manda o servidor repetir                 */
    /* ---------------------------------------------------------------- */

    [Fact]
    public async Task Quiz_cannot_have_every_option_marked_as_correct()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => Create(ctx, Quiz(options: ["a", "b"], correct: [0, 1])));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
        Assert.Equal(StatusCodes.Status400BadRequest, exception.StatusCode);
    }

    [Fact]
    public async Task Quiz_needs_at_least_one_correct_option()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(() => Create(ctx, Quiz(correct: [])));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task Repeated_correct_indexes_do_not_sneak_past_the_all_correct_check()
    {
        var ctx = new RoomTestContext();

        await Assert.ThrowsAsync<ApiException>(() => Create(ctx, Quiz(options: ["a", "b"], correct: [0, 0])));
    }

    [Fact]
    public async Task Correct_index_outside_the_options_is_rejected()
    {
        var ctx = new RoomTestContext();

        await Assert.ThrowsAsync<ApiException>(() => Create(ctx, Quiz(options: ["a", "b", "c"], correct: [7])));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(7)]
    public async Task Quiz_options_stay_between_two_and_six(int count)
    {
        var ctx = new RoomTestContext();
        var options = Enumerable.Range(0, count).Select(i => $"opção {i}").ToList();

        await Assert.ThrowsAsync<ApiException>(() => Create(ctx, Quiz(options: options, correct: [0])));
    }

    [Fact]
    public async Task Fill_needs_one_answer_slot_per_gap_in_the_question()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => Create(ctx, Fill(blanks: ["multiplicar"])));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task The_word_PALAVRA_opens_a_gap_just_like_three_underscores()
    {
        var ctx = new RoomTestContext();

        var draft = await Create(ctx, Fill(question: "Ao PALAVRA os termos, a ___ se mantém.", blanks: ["multiplicar", "proporção"]));

        Assert.Equal(["multiplicar", "proporção"], draft.Phases[0].Blanks);
    }

    [Fact]
    public async Task Four_underscores_are_one_gap_and_a_leftover_character()
    {
        var ctx = new RoomTestContext();

        // Mesmo resultado do split por /___|PALAVRA/ no editor: contar diferente aqui rejeitaria
        // um rascunho que a tela mostra como valido.
        var draft = await Create(ctx, Fill(question: "Ao ____ os termos.", blanks: ["multiplicar"]));

        Assert.Single(draft.Phases[0].Blanks!);
    }

    [Fact]
    public async Task A_gap_answered_with_a_word_that_is_not_in_the_bank_is_rejected()
    {
        var ctx = new RoomTestContext();

        await Assert.ThrowsAsync<ApiException>(
            () => Create(ctx, Fill(blanks: ["dividir", "proporção"])));
    }

    [Fact]
    public async Task A_gap_still_empty_is_a_draft_and_not_an_error()
    {
        var ctx = new RoomTestContext();

        var draft = await Create(ctx, Fill(blanks: [null, null]));

        Assert.Equal([null, null], draft.Phases[0].Blanks);
    }

    [Fact]
    public async Task An_empty_question_saves_because_this_is_a_draft()
    {
        var ctx = new RoomTestContext();

        var draft = await Create(ctx, Quiz(question: "", options: ["", "", "", ""], correct: [0]));

        Assert.Equal(string.Empty, draft.Phases[0].Question);
    }

    [Fact]
    public async Task Title_cannot_be_blank()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.PhaseSets.CreateAsync(new SavePhaseSetRequest("   ", []), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task Phase_name_cannot_be_blank()
    {
        var ctx = new RoomTestContext();

        await Assert.ThrowsAsync<ApiException>(() => Create(ctx, Quiz(name: " ")));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(4_000)]
    public async Task Time_per_phase_has_a_floor_and_a_ceiling(int seconds)
    {
        var ctx = new RoomTestContext();

        await Assert.ThrowsAsync<ApiException>(() => Create(ctx, Quiz() with { TimeSeconds = seconds }));
    }

    [Fact]
    public async Task Points_multiplier_is_rounded_to_what_the_column_holds()
    {
        var ctx = new RoomTestContext();

        var draft = await Create(ctx, Quiz() with { PointsMultiplier = 1.499m });

        Assert.Equal(1.50m, draft.Phases[0].PointsMultiplier);
    }

    /* ---------------------------------------------------------------- */
    /* PATCH, DELETE e autoria                                            */
    /* ---------------------------------------------------------------- */

    [Fact]
    public async Task Renaming_returns_the_summary_the_library_row_needs()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Nome antigo", phaseCount: 3, updatedAt: DateTimeOffset.UtcNow.AddDays(-2));

        var summary = await ctx.PhaseSets.RenameAsync(set.Id.ToString(), new RenamePhaseSetRequest("Nome novo"), ctx.AsLeader, Ct);

        Assert.Equal("Nome novo", summary.Title);
        Assert.Equal(3, summary.PhaseCount);
        Assert.Equal(PhaseSetSource.Owned, summary.Source);
        Assert.Equal("editado agora", summary.UpdatedLabel);
    }

    [Fact]
    public async Task Deleting_takes_the_phases_with_it()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 3);

        await ctx.PhaseSets.DeleteAsync(set.Id.ToString(), ctx.AsLeader, Ct);

        Assert.Empty(await ctx.Db.PhaseSets.ToListAsync());
        Assert.Empty(await ctx.Db.Phases.ToListAsync());
    }

    [Fact]
    public async Task Deleting_does_not_touch_a_room_that_already_copied_the_set()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações", phaseCount: 3);
        await ctx.Queue.AppendSetAsync(ctx.Room.Id, set, Ct);
        await ctx.Db.SaveChangesAsync();

        await ctx.PhaseSets.DeleteAsync(set.Id.ToString(), ctx.AsLeader, Ct);

        // "Nao afeta partidas passadas: a fila copia a fase em vez de referencia-la" (secao 5).
        var queue = await ctx.Queue.GetQueueAsync(ctx.Room.Code, ctx.AsLeader, Ct);
        Assert.Single(queue.Sets);
        Assert.Equal(3, queue.Phases.Count);
    }

    [Fact]
    public async Task Someone_elses_set_does_not_open_in_the_editor()
    {
        var ctx = new RoomTestContext();
        var other = ctx.AddUser("Prof. Marcos", "marcos@escola.br");
        var set = ctx.AddPhaseSet(other, "Álgebra para o ENEM", visibility: PhaseSetVisibility.Community);

        // 404 e nao 403: responder "existe, mas nao e seu" confirmaria conjunto alheio para quem
        // varresse ids, e nao daria ao autor legitimo nenhuma acao a mais.
        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.PhaseSets.GetDraftAsync(set.Id.ToString(), ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.PhaseSetNotFound, exception.Code);
        Assert.Equal(StatusCodes.Status404NotFound, exception.StatusCode);
    }

    [Fact]
    public async Task Someone_elses_set_cannot_be_written_or_deleted_either()
    {
        var ctx = new RoomTestContext();
        var other = ctx.AddUser("Prof. Marcos", "marcos@escola.br");
        var set = ctx.AddPhaseSet(other, "Álgebra para o ENEM", visibility: PhaseSetVisibility.Community);
        var id = set.Id.ToString();

        await Assert.ThrowsAsync<ApiException>(() => ctx.PhaseSets.ReplaceDraftAsync(id, new SavePhaseSetRequest("Sequestrado", []), ctx.AsLeader, Ct));
        await Assert.ThrowsAsync<ApiException>(() => ctx.PhaseSets.RenameAsync(id, new RenamePhaseSetRequest("Sequestrado"), ctx.AsLeader, Ct));
        await Assert.ThrowsAsync<ApiException>(() => ctx.PhaseSets.DeleteAsync(id, ctx.AsLeader, Ct));

        Assert.Equal("Álgebra para o ENEM", (await ctx.Db.PhaseSets.SingleAsync(s => s.Id == set.Id)).Title);
    }

    [Fact]
    public async Task A_malformed_id_is_a_set_that_does_not_exist()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.PhaseSets.GetDraftAsync("nao-e-um-guid", ctx.AsLeader, Ct));

        Assert.Equal(ErrorCodes.PhaseSetNotFound, exception.Code);
    }

    [Fact]
    public async Task The_editor_is_closed_to_guests()
    {
        var ctx = new RoomTestContext();
        var set = ctx.AddPhaseSet(ctx.Leader, "Frações");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.PhaseSets.GetDraftAsync(set.Id.ToString(), ctx.Anonymous, Ct));

        Assert.Equal(ErrorCodes.AccountRequired, exception.Code);
    }

    /* ---------------------------------------------------------------- */
    /* O corpo que o front recebe                                         */
    /* ---------------------------------------------------------------- */

    [Fact]
    public async Task The_json_of_a_phase_is_the_discriminated_union_of_types_ts()
    {
        var ctx = new RoomTestContext();
        var created = await ctx.PhaseSets.CreateAsync(
            new SavePhaseSetRequest("Frações", [Quiz()]),
            ctx.AsLeader,
            Ct);

        var json = JsonSerializer.Serialize(created, CodexJsonOptions.Create());

        Assert.Contains("\"kind\":\"quiz\"", json);
        // Nao "fromAi": a chave de types.ts e fromAI, e a politica camelCase do .NET so mexe no
        // primeiro caractere — o que aqui e sorte, nao acaso, e por isso esta afirmado.
        Assert.Contains("\"fromAI\":false", json);
        Assert.Contains("\"correctIndexes\":[0]", json);
        // Uma QuizDraftPhase de types.ts nao tem estes campos — nem como null.
        Assert.DoesNotContain("blanks", json);
        Assert.DoesNotContain("expectedAnswer", json);
        Assert.DoesNotContain("starterCode", json);
    }

    /* ---------------------------------------------------------------- */
    /* Tetos de texto livre (migracao-dados.md secao 5.3)                 */
    /* ---------------------------------------------------------------- */

    [Fact]
    public async Task Question_longer_than_the_ceiling_is_rejected()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => Create(ctx, Quiz(question: Filler(PhaseLimits.MaxQuestionLength + 1))));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
        Assert.Equal(StatusCodes.Status400BadRequest, exception.StatusCode);
    }

    /// <summary>
    /// O teto e <c>&gt;</c>, nao <c>&gt;=</c>: o valor exato do limite passa. Sem esta, trocar o
    /// operador por engano nao quebraria teste nenhum.
    /// </summary>
    [Fact]
    public async Task A_question_exactly_at_the_ceiling_is_accepted()
    {
        var ctx = new RoomTestContext();

        var draft = await Create(ctx, Quiz(question: Filler(PhaseLimits.MaxQuestionLength)));

        Assert.Equal(PhaseLimits.MaxQuestionLength, Assert.Single(draft.Phases).Question!.Length);
    }

    [Fact]
    public async Task Quiz_option_longer_than_the_ceiling_is_rejected()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => Create(ctx, Quiz(options: ["ok", Filler(PhaseLimits.MaxOptionLength + 1)], correct: [0])));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task Fill_word_bank_has_a_ceiling_on_how_many_words_it_holds()
    {
        var ctx = new RoomTestContext();
        var words = Enumerable.Range(0, PhaseLimits.MaxWords + 1).Select(i => $"palavra{i}").ToList();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => Create(ctx, Fill(words: words, blanks: ["palavra0", "palavra1"])));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task Starter_code_longer_than_the_ceiling_is_rejected()
    {
        var ctx = new RoomTestContext();
        var phase = Code() with { StarterCode = Filler(PhaseLimits.MaxStarterCodeLength + 1) };

        var exception = await Assert.ThrowsAsync<ApiException>(() => Create(ctx, phase));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task Test_cases_longer_than_the_ceiling_are_rejected()
    {
        var ctx = new RoomTestContext();
        var phase = Code() with { TestCases = Filler(PhaseLimits.MaxTestCasesLength + 1) };

        var exception = await Assert.ThrowsAsync<ApiException>(() => Create(ctx, phase));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task Expected_answer_longer_than_the_ceiling_is_rejected()
    {
        var ctx = new RoomTestContext();
        var phase = Text() with { ExpectedAnswer = Filler(PhaseLimits.MaxExpectedAnswerLength + 1) };

        var exception = await Assert.ThrowsAsync<ApiException>(() => Create(ctx, phase));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    /// <summary>
    /// Campo em branco continua valido — a politica de rascunho nao mudou, so ganhou teto em cima.
    /// </summary>
    [Fact]
    public async Task An_empty_question_still_passes()
    {
        var ctx = new RoomTestContext();

        var draft = await Create(ctx, Quiz(question: string.Empty));

        Assert.Equal(string.Empty, Assert.Single(draft.Phases).Question);
    }

    /* ---------------------------------------------------------------- */

    private static Task<PhaseSetDraftResponse> Create(RoomTestContext ctx, DraftPhaseDto phase)
        => ctx.PhaseSets.CreateAsync(new SavePhaseSetRequest("Conjunto", [phase]), ctx.AsLeader, Ct);

    /// <summary>Texto de <paramref name="length"/> caracteres, para exercitar um teto.</summary>
    private static string Filler(int length) => new('x', length);

    private static DraftPhaseDto Quiz(
        string? id = "draft_1",
        string name = "Frações equivalentes",
        string question = "Qual fração é equivalente a 2/3?",
        IReadOnlyList<string>? options = null,
        IReadOnlyList<int>? correct = null)
        => new(id, PhaseKind.Quiz, name, 100, 1m, 45, false, question,
            Options: options ?? ["4/6", "3/4", "5/9", "6/8"],
            CorrectIndexes: correct ?? [0]);

    private static DraftPhaseDto Fill(
        string id = "draft_1",
        string name = "Proporção entre partes",
        string question = "Ao ___ os termos, a ___ se mantém.",
        IReadOnlyList<string>? words = null,
        IReadOnlyList<string?>? blanks = null)
        => new(id, PhaseKind.Fill, name, 100, 1m, 40, false, question,
            Words: words ?? ["multiplicar", "somar", "proporção"],
            Blanks: blanks ?? ["multiplicar", "proporção"]);

    private static DraftPhaseDto Code(string id = "draft_1")
        => new(id, PhaseKind.Code, "Soma dos pares", 150, 1m, 300, false, "Some os números pares da lista.",
            StarterCode: "function solucao(entrada) {}",
            TestCases: "entrada: 2 -> saída: 4");

    private static DraftPhaseDto Text(string id = "draft_2")
        => new(id, PhaseKind.Text, "Explique com suas palavras", 100, 1m, 120, false, "Por que 2/3 e 4/6 são equivalentes?",
            ExpectedAnswer: "Porque numerador e denominador são multiplicados pelo mesmo fator.");
}
