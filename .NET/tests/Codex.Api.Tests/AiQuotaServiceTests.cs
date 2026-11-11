using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Ai;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.Ai;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Codex.Api.Tests;

public class AiQuotaServiceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    [Fact]
    public async Task Counts_only_non_failed_generations_in_current_month_and_day_for_display_timezone()
    {
        var db = CreateDb();
        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = "Prof. Ana",
            Email = "ana@escola.br",
            Plan = UserPlan.Free,
        };
        db.Users.Add(user);

        // Referencia: 2026-10-18T15:00:00-03:00 (18:00 UTC)
        var now = new DateTimeOffset(2026, 10, 18, 18, 0, 0, TimeSpan.Zero);

        // Geracao do mes passado: nao deve contar
        db.AiGenerations.Add(new AiGeneration
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Operation = AiOperation.Phase,
            Provider = "local",
            Model = "qwen",
            Status = AiGenerationStatus.Succeeded,
            Cost = 5,
            InputJson = "{}",
            CreatedAt = new DateTimeOffset(2026, 9, 30, 20, 0, 0, TimeSpan.Zero),
        });

        // Geracao com falha neste mes: nao deve contar
        db.AiGenerations.Add(new AiGeneration
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Operation = AiOperation.Phase,
            Provider = "local",
            Model = "qwen",
            Status = AiGenerationStatus.Failed,
            Cost = 0,
            InputJson = "{}",
            CreatedAt = now.AddHours(-2),
        });

        // Geracao bem-sucedida neste mes (custo 2)
        db.AiGenerations.Add(new AiGeneration
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Operation = AiOperation.Variations,
            Provider = "local",
            Model = "qwen",
            Status = AiGenerationStatus.Succeeded,
            Cost = 2,
            InputJson = "{}",
            CreatedAt = now.AddDays(-3),
        });

        // Sugestao de ontem: nao conta no dia de hoje
        db.AiGenerations.Add(new AiGeneration
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Operation = AiOperation.QuizOptions,
            Provider = "local",
            Model = "qwen",
            Status = AiGenerationStatus.Succeeded,
            Cost = 0,
            InputJson = "{}",
            CreatedAt = now.AddDays(-1),
        });

        // Sugestao de hoje: conta no dia de hoje
        db.AiGenerations.Add(new AiGeneration
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Operation = AiOperation.QuizOptions,
            Provider = "local",
            Model = "qwen",
            Status = AiGenerationStatus.Succeeded,
            Cost = 0,
            InputJson = "{}",
            CreatedAt = now.AddHours(-1),
        });

        await db.SaveChangesAsync(Ct);

        var service = CreateQuotaService(db);
        var usage = await service.GetUsageAsync(user, Ct, now);

        Assert.Equal("free", usage.Plan);
        Assert.Equal(2, usage.CreditsUsed);
        Assert.Equal(20, usage.CreditsLimit);
        Assert.Equal(1, usage.SuggestionsUsedToday);
        Assert.Equal(30, usage.SuggestionsDailyLimit);
        Assert.True(usage.Enabled);
    }

    [Fact]
    public async Task Throws_AiQuotaExceeded_with_usage_payload_when_monthly_credits_or_daily_suggestions_are_exhausted()
    {
        var db = CreateDb();
        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = "Prof. Ana",
            Email = "ana@escola.br",
            Plan = UserPlan.Free,
        };
        db.Users.Add(user);

        var now = new DateTimeOffset(2026, 10, 18, 18, 0, 0, TimeSpan.Zero);

        db.AiGenerations.Add(new AiGeneration
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Operation = AiOperation.Phase,
            Provider = "local",
            Model = "qwen",
            Status = AiGenerationStatus.Succeeded,
            Cost = 20,
            InputJson = "{}",
            CreatedAt = now.AddHours(-1),
        });

        await db.SaveChangesAsync(Ct);

        var service = CreateQuotaService(db);

        var ex = await Assert.ThrowsAsync<ApiException>(() =>
            service.EnsureAvailableAsync(user, AiOperation.Phase, cost: 1, Ct, now));

        Assert.Equal(429, ex.StatusCode);
        Assert.Equal(ErrorCodes.AiQuotaExceeded, ex.Code);
        Assert.NotNull(ex.Usage);
        Assert.Equal(20, ex.Usage.CreditsUsed);
        Assert.Equal(20, ex.Usage.CreditsLimit);
    }

    private static AppDbContext CreateDb()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static AiQuotaService CreateQuotaService(AppDbContext db, AiOptions? aiOptions = null)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CodexApi:DisplayUtcOffsetHours"] = "-3",
            })
            .Build();

        return new AiQuotaService(db, aiOptions ?? new AiOptions(), config);
    }
}
