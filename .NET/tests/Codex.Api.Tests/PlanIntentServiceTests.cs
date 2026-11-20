using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Billing;
using Codex.Api.Data;
using Codex.Api.Documents;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace Codex.Api.Tests;

public class PlanIntentServiceTests
{
    private static readonly ClaimsPrincipal Anonymous = new(new ClaimsIdentity());

    private static ClaimsPrincipal AsUser(Guid userId)
        => new(new ClaimsIdentity([new Claim(CodexClaimTypes.UserId, userId.ToString())], "test"));

    private static (User Leader, ClaimsPrincipal AsLeader, InMemoryPlanIntentDocumentStore Store, PlanIntentService Service) CreateFixture()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new AppDbContext(options);

        var leader = new User
        {
            Name = "Marina Duarte",
            Email = "marina@escola.br",
            Audience = Audience.Teacher,
            Plan = UserPlan.Free,
        };
        db.Users.Add(leader);
        db.SaveChanges();

        var store = new InMemoryPlanIntentDocumentStore();
        var service = new PlanIntentService(db, store);
        return (leader, AsUser(leader.Id), store, service);
    }

    [Fact]
    public async Task GetMine_requires_an_authenticated_account()
    {
        var (_, _, _, service) = CreateFixture();

        var ex = await Assert.ThrowsAsync<ApiException>(
            () => service.GetMineAsync(Anonymous, CancellationToken.None));

        Assert.Equal(ErrorCodes.AccountRequired, ex.Code);
        Assert.Equal(StatusCodes.Status403Forbidden, ex.StatusCode);
    }

    [Fact]
    public async Task SaveMine_requires_an_authenticated_account()
    {
        var (_, _, _, service) = CreateFixture();

        var ex = await Assert.ThrowsAsync<ApiException>(
            () => service.SaveMineAsync(
                new SavePlanIntentRequest(UserPlan.Intermediate, PlanPricePerception.Fair, PlanSubscriptionIntent.Yes, null, null),
                Anonymous,
                CancellationToken.None));

        Assert.Equal(ErrorCodes.AccountRequired, ex.Code);
        Assert.Equal(StatusCodes.Status403Forbidden, ex.StatusCode);
    }

    [Fact]
    public async Task GetMine_returns_null_when_user_has_not_answered_yet()
    {
        var (_, asLeader, _, service) = CreateFixture();

        var envelope = await service.GetMineAsync(asLeader, CancellationToken.None);

        Assert.Null(envelope.Intent);
    }

    [Theory]
    [InlineData(UserPlan.Free, 0)]
    [InlineData(UserPlan.Intermediate, 11)]
    [InlineData(UserPlan.Pro, 35)]
    public async Task SaveMine_assigns_authoritative_suggested_price_per_plan(UserPlan plan, int expectedSuggestedPrice)
    {
        var (leader, asLeader, store, service) = CreateFixture();

        var response = await service.SaveMineAsync(
            new SavePlanIntentRequest(plan, PlanPricePerception.Fair, PlanSubscriptionIntent.Yes, null, "  Ótimo custo-benefício  "),
            asLeader,
            CancellationToken.None);

        Assert.Equal(plan, response.SelectedPlan);
        Assert.Equal(expectedSuggestedPrice, response.SuggestedPriceBrl);
        Assert.Equal(PlanPricePerception.Fair, response.PricePerception);
        Assert.Equal(PlanSubscriptionIntent.Yes, response.SubscriptionIntent);
        Assert.Null(response.ExpectedPriceBrl);
        Assert.Equal("Ótimo custo-benefício", response.Comment);
        Assert.Equal(1, response.SubmissionCount);

        var stored = await store.GetByUserIdAsync(leader.Id, CancellationToken.None);
        Assert.NotNull(stored);
        Assert.Equal(leader.Email, stored.UserEmail);
        Assert.Equal(leader.Name, stored.UserName);
        Assert.Equal(leader.Audience, stored.Audience);
        Assert.Equal(expectedSuggestedPrice, stored.SuggestedPriceBrl);
    }

    [Fact]
    public async Task SaveMine_updates_existing_document_preserving_createdAt_and_incrementing_submissionCount()
    {
        var (_, asLeader, _, service) = CreateFixture();

        var first = await service.SaveMineAsync(
            new SavePlanIntentRequest(UserPlan.Intermediate, PlanPricePerception.ExpectedLower, PlanSubscriptionIntent.Maybe, 8, "Primeira resposta"),
            asLeader,
            CancellationToken.None);

        await Task.Delay(15);

        var second = await service.SaveMineAsync(
            new SavePlanIntentRequest(UserPlan.Pro, PlanPricePerception.ExpectedHigher, PlanSubscriptionIntent.Yes, 45, "   "),
            asLeader,
            CancellationToken.None);

        Assert.Equal(first.CreatedAt, second.CreatedAt);
        Assert.True(second.UpdatedAt >= first.UpdatedAt);
        Assert.Equal(2, second.SubmissionCount);
        Assert.Equal(UserPlan.Pro, second.SelectedPlan);
        Assert.Equal(35, second.SuggestedPriceBrl);
        Assert.Equal(PlanPricePerception.ExpectedHigher, second.PricePerception);
        Assert.Equal(PlanSubscriptionIntent.Yes, second.SubscriptionIntent);
        Assert.Equal(45, second.ExpectedPriceBrl);
        Assert.Null(second.Comment);

        var fetched = await service.GetMineAsync(asLeader, CancellationToken.None);
        Assert.NotNull(fetched.Intent);
        Assert.Equal(2, fetched.Intent.SubmissionCount);
        Assert.Equal(UserPlan.Pro, fetched.Intent.SelectedPlan);
    }

    [Fact]
    public async Task SaveMine_clears_expected_price_when_perception_is_fair()
    {
        var (_, asLeader, _, service) = CreateFixture();

        var saved = await service.SaveMineAsync(
            new SavePlanIntentRequest(UserPlan.Intermediate, PlanPricePerception.Fair, PlanSubscriptionIntent.Yes, 9, null),
            asLeader,
            CancellationToken.None);

        Assert.Null(saved.ExpectedPriceBrl);
    }

    [Fact]
    public async Task SaveMine_rejects_expected_lower_for_free_plan()
    {
        var (_, asLeader, _, service) = CreateFixture();

        var ex = await Assert.ThrowsAsync<ApiException>(
            () => service.SaveMineAsync(
                new SavePlanIntentRequest(UserPlan.Free, PlanPricePerception.ExpectedLower, PlanSubscriptionIntent.No, null, null),
                asLeader,
                CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationError, ex.Code);
        Assert.Equal(StatusCodes.Status400BadRequest, ex.StatusCode);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(100_001)]
    public async Task SaveMine_rejects_out_of_range_expected_price(int expectedPrice)
    {
        var (_, asLeader, _, service) = CreateFixture();

        var ex = await Assert.ThrowsAsync<ApiException>(
            () => service.SaveMineAsync(
                new SavePlanIntentRequest(UserPlan.Pro, PlanPricePerception.ExpectedLower, PlanSubscriptionIntent.Maybe, expectedPrice, null),
                asLeader,
                CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationError, ex.Code);
        Assert.Equal(StatusCodes.Status400BadRequest, ex.StatusCode);
    }

    [Fact]
    public async Task SaveMine_rejects_comment_longer_than_500_chars()
    {
        var (_, asLeader, _, service) = CreateFixture();
        var longComment = new string('a', PlanIntentService.MaxCommentLength + 1);

        var ex = await Assert.ThrowsAsync<ApiException>(
            () => service.SaveMineAsync(
                new SavePlanIntentRequest(UserPlan.Pro, PlanPricePerception.Fair, PlanSubscriptionIntent.Yes, null, longComment),
                asLeader,
                CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationError, ex.Code);
        Assert.Equal(StatusCodes.Status400BadRequest, ex.StatusCode);
    }

    [Fact]
    public void PlanIntentDocument_serializes_and_deserializes_with_camelCase_bson_conventions()
    {
        DocumentConventions.Register();

        var doc = new PlanIntentDocument
        {
            UserId = Guid.CreateVersion7(),
            UserEmail = "marina@escola.br",
            UserName = "Marina Duarte",
            Audience = Audience.Teacher,
            CurrentPlan = UserPlan.Free,
            SelectedPlan = UserPlan.Intermediate,
            SuggestedPriceBrl = 11,
            PricePerception = PlanPricePerception.ExpectedLower,
            SubscriptionIntent = PlanSubscriptionIntent.Maybe,
            ExpectedPriceBrl = 9,
            Comment = "Bom para turmas médias",
            SubmissionCount = 1,
        };

        var bson = doc.ToBsonDocument();

        Assert.Equal("teacher", bson["audience"].AsString);
        Assert.Equal("free", bson["currentPlan"].AsString);
        Assert.Equal("intermediate", bson["selectedPlan"].AsString);
        Assert.Equal(11, bson["suggestedPriceBrl"].AsInt32);
        Assert.Equal("expectedLower", bson["pricePerception"].AsString);
        Assert.Equal("maybe", bson["subscriptionIntent"].AsString);
        Assert.Equal(9, bson["expectedPriceBrl"].AsInt32);

        var roundTrip = BsonSerializer.Deserialize<PlanIntentDocument>(bson);
        Assert.Equal(doc.UserId, roundTrip.UserId);
        Assert.Equal(doc.SelectedPlan, roundTrip.SelectedPlan);
        Assert.Equal(doc.PricePerception, roundTrip.PricePerception);
        Assert.Equal(doc.SubscriptionIntent, roundTrip.SubscriptionIntent);
        Assert.Equal(doc.ExpectedPriceBrl, roundTrip.ExpectedPriceBrl);
        Assert.Equal(doc.Comment, roundTrip.Comment);
    }
}
