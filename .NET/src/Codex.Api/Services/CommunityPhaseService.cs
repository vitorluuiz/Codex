using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// Catálogo avulso de desafios da comunidade (<c>community_phases</c> no PostgreSQL), com busca
/// escalável por índices B-Tree compostos e Full-Text Search (<c>GIN</c>).
/// </summary>
public class CommunityPhaseService(AppDbContext db)
{
    private const int DefaultLimit = 30;
    private const int MaxLimit = 50;
    private const int MaxSubjectLength = 64;
    private const string DefaultSubject = "Geral";

    public async Task<CommunityPhaseCatalogResponse> SearchAsync(
        string? q,
        string? subject,
        string? kind,
        string? sort,
        int? limit,
        int? cursor,
        CancellationToken ct)
    {
        var pageSize = limit switch
        {
            null => DefaultLimit,
            < 1 or > MaxLimit => throw Validation($"limit deve estar entre 1 e {MaxLimit}."),
            _ => limit.Value,
        };

        var offset = cursor switch
        {
            null => 0,
            < 0 => throw Validation("cursor deve ser maior ou igual a zero."),
            _ => cursor.Value,
        };

        PhaseKind? parsedKind = null;
        if (!string.IsNullOrWhiteSpace(kind))
        {
            if (!Enum.TryParse<PhaseKind>(kind.Trim(), ignoreCase: true, out var k))
            {
                throw Validation("kind deve ser quiz, fill, text ou code.");
            }

            parsedKind = k;
        }

        var sortMode = sort?.Trim().ToLowerInvariant() switch
        {
            null or "" or "recent" => "recent",
            "popular" => "popular",
            _ => throw Validation("sort deve ser popular ou recent."),
        };

        var query = db.CommunityPhases
            .AsNoTracking()
            .Where(p => p.Status == CommunityResourceStatus.Published);

        if (!string.IsNullOrWhiteSpace(subject))
        {
            var normalizedSubject = subject.Trim();
            query = query.Where(p => p.Subject == normalizedSubject);
        }

        if (parsedKind is { } kindFilter)
        {
            query = query.Where(p => p.Kind == kindFilter);
        }

        var search = q?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            var isNpgsql = string.Equals(
                db.Database.ProviderName,
                "Npgsql.EntityFrameworkCore.PostgreSQL",
                StringComparison.OrdinalIgnoreCase);

            if (isNpgsql)
            {
                var pattern = $"%{search}%";
                query = query.Where(p =>
                    EF.Functions.ToTsVector("portuguese", p.Name + " " + p.QuestionPreview)
                        .Matches(EF.Functions.WebSearchToTsQuery("portuguese", search))
                    || EF.Functions.ILike(p.Name, pattern)
                    || EF.Functions.ILike(p.QuestionPreview, pattern));
            }
            else
            {
                query = query.Where(p =>
                    p.Name.Contains(search, StringComparison.OrdinalIgnoreCase)
                    || p.QuestionPreview.Contains(search, StringComparison.OrdinalIgnoreCase));
            }
        }

        query = sortMode == "popular"
            ? query.OrderByDescending(p => p.UseCount).ThenByDescending(p => p.PublishedAt)
            : query.OrderByDescending(p => p.PublishedAt);

        var rows = await query
            .Skip(offset)
            .Take(pageSize + 1)
            .ToListAsync(ct);

        int? nextOffset = rows.Count > pageSize ? offset + pageSize : null;
        if (rows.Count > pageSize)
        {
            rows.RemoveAt(rows.Count - 1);
        }

        var subjects = await db.CommunityPhases
            .AsNoTracking()
            .Where(p => p.Status == CommunityResourceStatus.Published && p.Subject != "")
            .Select(p => p.Subject)
            .Distinct()
            .OrderBy(s => s)
            .ToListAsync(ct);

        return new CommunityPhaseCatalogResponse([.. rows.Select(ToSummary)], nextOffset, subjects);
    }

    public async Task<DraftPhaseDto> GetAsDraftPhaseAsync(string phaseId, CancellationToken ct)
    {
        if (!Guid.TryParse(phaseId, out var id))
        {
            throw PhaseNotFound();
        }

        var cp = await db.CommunityPhases
                     .AsNoTracking()
                     .FirstOrDefaultAsync(p => p.Id == id && p.Status == CommunityResourceStatus.Published, ct)
                 ?? throw PhaseNotFound();

        var content = PhaseContent.Parse(cp.ContentJson);

        return new DraftPhaseDto(
            cp.Id.ToString(),
            cp.Kind,
            cp.Name,
            cp.BasePoints,
            cp.PointsMultiplier,
            cp.TimeSeconds,
            content.FromAI,
            content.Question ?? string.Empty,
            Options: cp.Kind is PhaseKind.Quiz ? content.Options ?? [] : null,
            CorrectIndexes: cp.Kind is PhaseKind.Quiz ? content.CorrectIndexes ?? [] : null,
            Words: cp.Kind is PhaseKind.Fill ? content.Words ?? [] : null,
            Blanks: cp.Kind is PhaseKind.Fill ? content.Blanks ?? [] : null,
            StarterCode: cp.Kind is PhaseKind.Code ? content.StarterCode ?? string.Empty : null,
            TestCases: cp.Kind is PhaseKind.Code ? content.TestCases ?? string.Empty : null,
            ExpectedAnswer: cp.Kind is PhaseKind.Text ? content.ExpectedAnswer ?? string.Empty : null,
            Theme: content.Theme,
            ShowFeedbackAnimation: content.ShowFeedbackAnimation,
            IntroSeconds: content.IntroSeconds,
            IntroTip: content.IntroTip,
            IntroSound: content.IntroSound,
            IntroShapes: content.IntroShapes,
            VariationSettings: content.VariationSettings,
            OriginCommunityPhaseId: cp.Id);
    }

    public async Task<CommunityPhaseSummaryDto> PublishAsync(
        PublishCommunityPhaseRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var userId = principal.GetUserId() ?? throw AccountRequired();
        var author = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct)
                     ?? throw AccountRequired();

        if (request?.Phase is null)
        {
            throw Validation("phase e obrigatorio.");
        }

        var validated = PhaseDraftValidator.Validate([request.Phase])[0];
        var content = PhaseContent.From(validated);
        var name = validated.Name!.Trim();
        var multiplier = PhaseLimits.RoundMultiplier(validated.PointsMultiplier);
        PhaseGrading.EnsureComplete(validated.Kind, name, 0, content);

        var subject = NormalizeSubject(request.Subject);
        var hash = PhaseContentHasher.Compute(
            validated.Kind,
            name,
            validated.BasePoints,
            multiplier,
            validated.TimeSeconds,
            content);

        var entity = new CommunityPhase
        {
            Id = Guid.CreateVersion7(),
            AuthorId = author.Id,
            AuthorName = author.Name,
            OriginPhaseId = request.OriginPhaseId ?? validated.OriginCommunityPhaseId,
            SourceDraftPhaseId = Guid.TryParse(validated.Id, out var draftId) ? draftId : null,
            Version = 1,
            Kind = validated.Kind,
            Subject = subject,
            Difficulty = request.Difficulty,
            Name = name,
            QuestionPreview = PhaseContentHasher.BuildQuestionPreview(content.Question),
            BasePoints = validated.BasePoints,
            PointsMultiplier = multiplier,
            TimeSeconds = validated.TimeSeconds,
            ContentJson = content.ToJson(),
            ContentHash = hash,
            Status = CommunityResourceStatus.Published,
            PublishedAt = DateTimeOffset.UtcNow,
        };

        db.CommunityPhases.Add(entity);
        await db.SaveChangesAsync(ct);

        return ToSummary(entity);
    }

    private static CommunityPhaseSummaryDto ToSummary(CommunityPhase p)
    {
        int? accuracyRate = p.SubmissionsCount > 0
            ? (int)Math.Round(p.CorrectSubmissionsCount * 100.0 / p.SubmissionsCount, MidpointRounding.AwayFromZero)
            : null;

        return new CommunityPhaseSummaryDto(
            p.Id,
            p.Name,
            p.QuestionPreview,
            p.Kind,
            p.Subject,
            p.Difficulty,
            p.AuthorId,
            p.AuthorName,
            p.BasePoints,
            p.PointsMultiplier,
            p.TimeSeconds,
            p.UseCount,
            accuracyRate,
            p.PublishedAt);
    }

    private static string NormalizeSubject(string? subject)
    {
        var normalized = subject?.Trim();
        if (string.IsNullOrEmpty(normalized))
        {
            return DefaultSubject;
        }

        if (normalized.Length > MaxSubjectLength)
        {
            throw Validation($"subject deve ter no maximo {MaxSubjectLength} caracteres.");
        }

        return normalized;
    }

    private static ApiException AccountRequired()
        => new(StatusCodes.Status403Forbidden, ErrorCodes.AccountRequired, "E preciso ter uma conta para publicar na comunidade.");

    private static ApiException PhaseNotFound()
        => new(StatusCodes.Status404NotFound, ErrorCodes.PhaseNotFound, "Desafio da comunidade nao encontrado.");

    private static ApiException Validation(string message)
        => new(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, message);
}
