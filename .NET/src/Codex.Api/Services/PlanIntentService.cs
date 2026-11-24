using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Billing;
using Codex.Api.Data;
using Codex.Api.Documents;
using Codex.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// Pesquisa provisória de intenção de contratação e percepção de preço na seção
/// "Pagamentos e plano". Persiste 1 documento por usuário na coleção <c>plan_intents</c> do MongoDB.
/// </summary>
public class PlanIntentService(AppDbContext db, IPlanIntentDocumentStore store)
{
    public const int MaxCommentLength = 500;
    public const int MaxExpectedPriceBrl = 100_000;

    public async Task<PlanIntentEnvelopeResponse> GetMineAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = RequireUserId(principal);
        var existing = await store.GetByUserIdAsync(userId, ct);
        return new PlanIntentEnvelopeResponse(existing is null ? null : ToResponse(existing));
    }

    public async Task<PlanIntentResponse> SaveMineAsync(SavePlanIntentRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = RequireUserId(principal);
        ValidateRequest(request);

        var user = await db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId, ct)
            ?? throw new ApiException(StatusCodes.Status403Forbidden, ErrorCodes.AccountRequired, "Conta autenticada não encontrada.");

        var normalizedComment = string.IsNullOrWhiteSpace(request.Comment)
            ? null
            : request.Comment.Trim();

        var expectedPrice = request.PricePerception == PlanPricePerception.Fair
            ? null
            : request.ExpectedPriceBrl;

        var existing = await store.GetByUserIdAsync(userId, ct);
        var now = DateTime.UtcNow;

        var document = new PlanIntentDocument
        {
            UserId = userId,
            UserEmail = user.Email,
            UserName = user.Name,
            Audience = user.Audience,
            CurrentPlan = user.Plan,
            SelectedPlan = request.SelectedPlan,
            SuggestedPriceBrl = SuggestedPriceFor(request.SelectedPlan),
            PricePerception = request.PricePerception,
            SubscriptionIntent = request.SubscriptionIntent,
            ExpectedPriceBrl = expectedPrice,
            Comment = normalizedComment,
            SubmissionCount = existing is null ? 1 : existing.SubmissionCount + 1,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now,
        };

        await store.UpsertAsync(document, ct);
        return ToResponse(document);
    }

    public static int SuggestedPriceFor(UserPlan plan) => plan switch
    {
        UserPlan.Free => 0,
        UserPlan.Intermediate => 11,
        UserPlan.Pro => 35,
        _ => throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "Plano selecionado inválido."),
    };

    private static Guid RequireUserId(ClaimsPrincipal principal)
        => principal.GetUserId()
            ?? throw new ApiException(StatusCodes.Status403Forbidden, ErrorCodes.AccountRequired, "Faça login para acessar esta seção.");

    private static void ValidateRequest(SavePlanIntentRequest request)
    {
        if (!Enum.IsDefined(request.SelectedPlan))
        {
            throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "Plano selecionado inválido.");
        }

        if (!Enum.IsDefined(request.PricePerception))
        {
            throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "Percepção de preço inválida.");
        }

        if (!Enum.IsDefined(request.SubscriptionIntent))
        {
            throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "Intenção de assinatura inválida.");
        }

        if (request.SelectedPlan == UserPlan.Free && request.PricePerception == PlanPricePerception.ExpectedLower)
        {
            throw new ApiException(
                StatusCodes.Status400BadRequest,
                ErrorCodes.ValidationError,
                "Não é possível esperar um preço menor para o plano gratuito.");
        }

        if (request.ExpectedPriceBrl is < 0 or > MaxExpectedPriceBrl)
        {
            throw new ApiException(
                StatusCodes.Status400BadRequest,
                ErrorCodes.ValidationError,
                $"O valor esperado deve estar entre R$ 0 e R$ {MaxExpectedPriceBrl}.");
        }

        if (request.Comment is not null && request.Comment.Trim().Length > MaxCommentLength)
        {
            throw new ApiException(
                StatusCodes.Status400BadRequest,
                ErrorCodes.ValidationError,
                $"O comentário deve ter no máximo {MaxCommentLength} caracteres.");
        }
    }

    private static PlanIntentResponse ToResponse(PlanIntentDocument doc) => new(
        doc.SelectedPlan,
        doc.SuggestedPriceBrl,
        doc.PricePerception,
        doc.SubscriptionIntent,
        doc.ExpectedPriceBrl,
        doc.Comment,
        doc.SubmissionCount,
        new DateTimeOffset(DateTime.SpecifyKind(doc.CreatedAt, DateTimeKind.Utc)),
        new DateTimeOffset(DateTime.SpecifyKind(doc.UpdatedAt, DateTimeKind.Utc)));
}
