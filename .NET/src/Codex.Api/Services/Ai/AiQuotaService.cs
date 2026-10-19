using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Ai;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services.Ai;

/// <summary>
/// Calcula o consumo de creditos do periodo (mes corrente no fuso configurado em
/// <c>CodexApi:DisplayUtcOffsetHours</c>) e as sugestoes de quiz do dia. Geracoes com
/// <see cref="AiGenerationStatus.Failed"/> nao entram na soma.
/// </summary>
public class AiQuotaService(AppDbContext db, AiOptions options, IConfiguration configuration)
{
    private readonly TimeSpan _displayOffset =
        TimeSpan.FromHours(configuration.GetValue("CodexApi:DisplayUtcOffsetHours", -3.0));

    public async Task<AiUsageDto> GetUsageAsync(User user, CancellationToken ct, DateTimeOffset? now = null)
    {
        var currentInstant = now ?? DateTimeOffset.UtcNow;
        var (monthStartUtc, resetsAtUtc, dayStartUtc) = GetPeriodBounds(currentInstant);

        var planQuota = options.GetQuotaFor(user.Plan);

        var creditsUsed = await db.AiGenerations
            .AsNoTracking()
            .Where(g => g.UserId == user.Id
                        && g.Status != AiGenerationStatus.Failed
                        && g.CreatedAt >= monthStartUtc)
            .SumAsync(g => (int?)g.Cost, ct) ?? 0;

        var suggestionsUsedToday = await db.AiGenerations
            .AsNoTracking()
            .Where(g => g.UserId == user.Id
                        && g.Operation == AiOperation.QuizOptions
                        && g.Status != AiGenerationStatus.Failed
                        && g.CreatedAt >= dayStartUtc)
            .CountAsync(ct);

        return new AiUsageDto(
            Plan: user.Plan.ToString().ToLowerInvariant(),
            CreditsUsed: creditsUsed,
            CreditsLimit: planQuota.Credits,
            SuggestionsUsedToday: suggestionsUsedToday,
            SuggestionsDailyLimit: planQuota.DailySuggestions,
            ResetsAt: resetsAtUtc,
            Enabled: options.Enabled);
    }

    public async Task<AiUsageDto> EnsureAvailableAsync(
        User user,
        AiOperation operation,
        int cost,
        CancellationToken ct,
        DateTimeOffset? now = null)
    {
        var usage = await GetUsageAsync(user, ct, now);

        if (cost > 0 && usage.CreditsUsed + cost > usage.CreditsLimit)
        {
            throw new ApiException(
                StatusCodes.Status429TooManyRequests,
                ErrorCodes.AiQuotaExceeded,
                "Voce atingiu o limite de creditos de IA do seu plano neste mes.",
                usage);
        }

        if (operation is AiOperation.QuizOptions && usage.SuggestionsUsedToday >= usage.SuggestionsDailyLimit)
        {
            throw new ApiException(
                StatusCodes.Status429TooManyRequests,
                ErrorCodes.AiQuotaExceeded,
                "Voce atingiu o limite diario de sugestoes de alternativas do seu plano.",
                usage);
        }

        return usage;
    }

    public (DateTimeOffset MonthStartUtc, DateTimeOffset ResetsAtUtc, DateTimeOffset DayStartUtc) GetPeriodBounds(DateTimeOffset instant)
    {
        var local = instant.ToOffset(_displayOffset);
        var monthStartLocal = new DateTimeOffset(local.Year, local.Month, 1, 0, 0, 0, _displayOffset);
        var nextMonthStartLocal = monthStartLocal.AddMonths(1);
        var dayStartLocal = new DateTimeOffset(local.Year, local.Month, local.Day, 0, 0, 0, _displayOffset);

        return (monthStartLocal.ToUniversalTime(), nextMonthStartLocal.ToUniversalTime(), dayStartLocal.ToUniversalTime());
    }
}
