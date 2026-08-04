using Codex.Api.Common.Errors;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Contracts.Users;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.AspNetCore.Http;

namespace Codex.Api.Tests;

/// <summary>api-rest.md secao 2: PATCH /users/me e GET /users/{userId}/profile.</summary>
public class UserProfileServiceTests
{
    /* ---------------------------------------------------------------------- */
    /* PATCH /users/me                                                         */
    /* ---------------------------------------------------------------------- */

    [Fact]
    public async Task Patch_updates_the_three_editable_fields()
    {
        var ctx = new RoomTestContext();

        var user = await ctx.Profiles.UpdateMeAsync(
            new UpdateUserRequest("Marina D. Duarte", "marina.duarte@escola.edu.br", 2), ctx.AsLeader, CancellationToken.None);

        Assert.Equal("Marina D. Duarte", user.Name);
        Assert.Equal("marina.duarte@escola.edu.br", user.Email);
        Assert.Equal(2, user.AvatarIndex);
    }

    [Fact]
    public async Task Patch_leaves_untouched_what_was_not_sent()
    {
        var ctx = new RoomTestContext();

        var user = await ctx.Profiles.UpdateMeAsync(
            new UpdateUserRequest(null, null, 4), ctx.AsLeader, CancellationToken.None);

        Assert.Equal("Marina Duarte", user.Name);
        Assert.Equal("marina@escola.br", user.Email);
        Assert.Equal(4, user.AvatarIndex);
    }

    [Fact]
    public async Task Patch_rejects_an_email_already_used_by_someone_else()
    {
        var ctx = new RoomTestContext();
        ctx.AddUser("Prof. Marcos", "marcos@escola.br");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Profiles.UpdateMeAsync(new UpdateUserRequest(null, "marcos@escola.br", null), ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.EmailTaken, exception.Code);
        Assert.Equal(StatusCodes.Status409Conflict, exception.StatusCode);
    }

    [Fact]
    public async Task Patch_accepts_resending_the_own_email_unchanged()
    {
        var ctx = new RoomTestContext();

        var user = await ctx.Profiles.UpdateMeAsync(
            new UpdateUserRequest("Marina", "marina@escola.br", null), ctx.AsLeader, CancellationToken.None);

        Assert.Equal("marina@escola.br", user.Email);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("sem-arroba")]
    [InlineData("dois@@arrobas.br")]
    [InlineData("com espaco@escola.br")]
    [InlineData("termina.em@")]
    public async Task Patch_rejects_an_implausible_email(string email)
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Profiles.UpdateMeAsync(new UpdateUserRequest(null, email, null), ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
        Assert.Equal(StatusCodes.Status400BadRequest, exception.StatusCode);
    }

    [Fact]
    public async Task Patch_rejects_an_empty_name()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Profiles.UpdateMeAsync(new UpdateUserRequest("   ", null, null), ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task Patch_rejects_a_negative_avatar()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Profiles.UpdateMeAsync(new UpdateUserRequest(null, null, -1), ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task Patch_requires_an_account()
    {
        var ctx = new RoomTestContext();
        var participant = ctx.AddParticipant("Ana Silva");

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Profiles.UpdateMeAsync(new UpdateUserRequest("Ana", null, null), ctx.AsParticipant(participant.Id), CancellationToken.None));

        Assert.Equal(ErrorCodes.AccountRequired, exception.Code);
        Assert.Equal(StatusCodes.Status403Forbidden, exception.StatusCode);
    }

    /* ---------------------------------------------------------------------- */
    /* GET /users/{userId}/profile                                             */
    /* ---------------------------------------------------------------------- */

    [Fact]
    public async Task Profile_resolves_the_literal_me_from_the_session()
    {
        var ctx = new RoomTestContext();

        var profile = await ctx.Profiles.GetProfileAsync("me", ctx.AsLeader, CancellationToken.None);

        Assert.Equal(ctx.Leader.Id, profile.User.Id);
        Assert.Equal("marina@escola.br", profile.User.Email);
        Assert.Equal(Audience.Teacher, profile.User.Audience);
    }

    [Fact]
    public async Task Profile_of_the_literal_me_requires_an_account()
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Profiles.GetProfileAsync("me", ctx.Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.AccountRequired, exception.Code);
    }

    [Fact]
    public async Task Profile_by_id_is_the_same_route_as_me()
    {
        var ctx = new RoomTestContext();

        var byId = await ctx.Profiles.GetProfileAsync(ctx.Leader.Id.ToString(), ctx.AsLeader, CancellationToken.None);

        Assert.Equal(ctx.Leader.Id, byId.User.Id);
        Assert.Equal("marina@escola.br", byId.User.Email);
    }

    [Theory]
    [InlineData("nao-e-um-guid")]
    public async Task Profile_of_an_unresolvable_id_is_not_found(string userId)
    {
        var ctx = new RoomTestContext();

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => ctx.Profiles.GetProfileAsync(userId, ctx.AsLeader, CancellationToken.None));

        Assert.Equal(ErrorCodes.UserNotFound, exception.Code);
        Assert.Equal(StatusCodes.Status404NotFound, exception.StatusCode);
    }

    [Fact]
    public async Task Profile_of_someone_else_hides_the_email()
    {
        var ctx = new RoomTestContext();
        var other = ctx.AddUser("Prof. Marcos", "marcos@escola.br");

        var profile = await ctx.Profiles.GetProfileAsync(other.Id.ToString(), ctx.AsLeader, CancellationToken.None);

        Assert.Equal("Prof. Marcos", profile.User.Name);
        Assert.Equal(string.Empty, profile.User.Email);
    }

    [Fact]
    public async Task Own_sets_come_as_owned_with_a_relative_label()
    {
        var ctx = new RoomTestContext();
        ctx.AddPhaseSet(ctx.Leader, "Frações & Funções Básicas", phaseCount: 8, updatedAt: DateTimeOffset.UtcNow.AddDays(-2));

        var profile = await ctx.Profiles.GetProfileAsync("me", ctx.AsLeader, CancellationToken.None);

        var set = Assert.Single(profile.Sets);
        Assert.Equal("Frações & Funções Básicas", set.Title);
        Assert.Equal(8, set.PhaseCount);
        Assert.Equal(PhaseSetSource.Owned, set.Source);
        Assert.Equal("editado há 2 dias", set.UpdatedLabel);
        Assert.Null(set.AuthorName);
    }

    [Fact]
    public async Task Sets_come_most_recently_edited_first()
    {
        var ctx = new RoomTestContext();
        ctx.AddPhaseSet(ctx.Leader, "Antigo", updatedAt: DateTimeOffset.UtcNow.AddDays(-10));
        ctx.AddPhaseSet(ctx.Leader, "Recente", updatedAt: DateTimeOffset.UtcNow.AddHours(-1));

        var profile = await ctx.Profiles.GetProfileAsync("me", ctx.AsLeader, CancellationToken.None);

        Assert.Equal(["Recente", "Antigo"], profile.Sets.Select(s => s.Title));
    }

    [Fact]
    public async Task Someone_elses_profile_shows_only_community_sets_credited_to_the_author()
    {
        var ctx = new RoomTestContext();
        var other = ctx.AddUser("Prof. Marcos", "marcos@escola.br");
        ctx.AddPhaseSet(other, "Rascunho privado");
        ctx.AddPhaseSet(other, "Álgebra para o ENEM", phaseCount: 10, visibility: PhaseSetVisibility.Community);

        var profile = await ctx.Profiles.GetProfileAsync(other.Id.ToString(), ctx.AsLeader, CancellationToken.None);

        var set = Assert.Single(profile.Sets);
        Assert.Equal("Álgebra para o ENEM", set.Title);
        Assert.Equal(PhaseSetSource.Community, set.Source);
        Assert.Equal("Prof. Marcos", set.AuthorName);
        Assert.Null(set.UpdatedLabel);
    }

    [Fact]
    public async Task Match_history_summarises_a_finished_match()
    {
        var ctx = new RoomTestContext();
        ctx.AddParticipant("Ana Silva");
        ctx.AddParticipant("Bruno Costa");
        ctx.AddParticipant("Pendente", ParticipantStatus.Pending);
        SeedQueueSet(ctx, "Frações & Funções Básicas");

        var match = SeedFinishedMatch(ctx, TimeSpan.FromMinutes(32));
        SeedSubmission(ctx, match, "Ana Silva", score: 700, correct: true);
        SeedSubmission(ctx, match, "Bruno Costa", score: 580, correct: false);

        var profile = await ctx.Profiles.GetProfileAsync("me", ctx.AsLeader, CancellationToken.None);

        var summary = Assert.Single(profile.Matches);
        Assert.Equal("Frações & Funções Básicas", summary.SetTitle);
        Assert.Equal(MatchMode.Live, summary.Mode);
        // Aprovados apenas: o participante pendente nunca jogou.
        Assert.Equal(2, summary.ParticipantCount);
        Assert.Equal(640, summary.AvgScore);
        Assert.Equal(50, summary.AccuracyRate);
        Assert.Equal("32 min", summary.DurationLabel);
        Assert.NotEmpty(summary.PlayedAtLabel);
    }

    [Fact]
    public async Task Match_history_ignores_a_match_still_running()
    {
        var ctx = new RoomTestContext();
        ctx.Db.Matches.Add(new Match { RoomId = ctx.Room.Id, Mode = MatchMode.Live, Status = MatchStatus.Running });
        ctx.Db.SaveChanges();

        var profile = await ctx.Profiles.GetProfileAsync("me", ctx.AsLeader, CancellationToken.None);

        Assert.Empty(profile.Matches);
    }

    [Fact]
    public async Task Match_history_names_extra_sets_by_count()
    {
        var ctx = new RoomTestContext();
        SeedQueueSet(ctx, "Frações", order: 0);
        SeedQueueSet(ctx, "Funções", order: 1);
        SeedFinishedMatch(ctx, TimeSpan.FromMinutes(10));

        var profile = await ctx.Profiles.GetProfileAsync("me", ctx.AsLeader, CancellationToken.None);

        Assert.Equal("Frações +1", Assert.Single(profile.Matches).SetTitle);
    }

    private static void SeedQueueSet(RoomTestContext ctx, string title, int order = 0)
    {
        ctx.Db.RoomQueueSets.Add(new RoomQueueSet
        {
            RoomId = ctx.Room.Id,
            SourcePhaseSetId = Guid.NewGuid(),
            Title = title,
            Color = "var(--blue-500)",
            OrderIndex = order,
        });
        ctx.Db.SaveChanges();
    }

    private static Match SeedFinishedMatch(RoomTestContext ctx, TimeSpan duration)
    {
        var startedAt = DateTimeOffset.UtcNow.AddHours(-2);
        var match = new Match
        {
            RoomId = ctx.Room.Id,
            Mode = MatchMode.Live,
            Status = MatchStatus.Finished,
            FinishedAt = startedAt + duration,
        };
        // StartedAt e init-only com default "agora"; a reflexao do EF nao esta em jogo aqui, entao
        // o jeito de ter uma partida com duracao conhecida e criar o registro pela entidade.
        typeof(Match).GetProperty(nameof(Match.StartedAt))!.SetValue(match, startedAt);

        ctx.Db.Matches.Add(match);
        ctx.Db.SaveChanges();
        return match;
    }

    private static void SeedSubmission(RoomTestContext ctx, Match match, string participantName, int score, bool correct)
    {
        var participant = ctx.Db.Participants.Single(p => p.RoomId == ctx.Room.Id && p.DisplayName == participantName);

        var phase = new RoomQueuePhase
        {
            RoomId = ctx.Room.Id,
            RoomQueueSetId = ctx.Db.RoomQueueSets.First(s => s.RoomId == ctx.Room.Id).Id,
            SourcePhaseId = Guid.NewGuid(),
            Kind = PhaseKind.Quiz,
            Name = "Fase",
            BasePoints = 100,
            TimeSeconds = 45,
            ContentJson = "{}",
        };
        ctx.Db.RoomQueuePhases.Add(phase);

        ctx.Db.Submissions.Add(new Submission
        {
            MatchId = match.Id,
            RoomQueuePhaseId = phase.Id,
            ParticipantId = participant.Id,
            AnswerJson = """{"kind":"quiz","optionId":"o1"}""",
            Grading = GradingStatus.Graded,
            Correct = correct,
            Score = score,
        });
        ctx.Db.SaveChanges();
    }
}
