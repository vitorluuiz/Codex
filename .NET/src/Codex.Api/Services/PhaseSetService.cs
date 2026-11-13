using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Formatting;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Data;
using Codex.Api.Documents;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// Gerencia conjuntos privados (<c>private_phase_sets</c>), biblioteca (<c>user_workspaces</c>),
/// publicação imutável na comunidade (<c>community_phase_sets</c> + <c>community_phases</c>)
/// e clonagem com isolamento por cópia.
/// </summary>
public class PhaseSetService(AppDbContext db, IPhaseSetDocumentStore store, LabelFormatter labels)
{
    public const int MaxResults = 50;

    private const int MaxTitleLength = PhaseLimits.MaxNameLength;
    private const int MaxMetadataLength = 64;
    private const int MaxCoverUrlLength = 512;
    private const string DefaultSubject = "Geral";

    public sealed record ResolvedQueuePhase(
        Guid SourcePhaseId,
        PhaseKind Kind,
        string Name,
        int BasePoints,
        decimal PointsMultiplier,
        int TimeSeconds,
        string ContentJson);

    public sealed record ResolvedQueueSet(
        Guid SourceSetId,
        string Title,
        bool IsCommunity,
        IReadOnlyList<ResolvedQueuePhase> Phases);

    /// <summary>
    /// <c>GET /phase-sets?scope=owned|community&amp;q=</c> — lê exclusivamente do MongoDB.
    /// </summary>
    public async Task<IReadOnlyList<PhaseSetSummaryDto>> ListAsync(
        string? scope,
        string? q,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var source = ParseScope(scope);
        var viewerId = principal.GetUserId();

        if (source is PhaseSetSource.Owned)
        {
            var ownerId = viewerId ?? throw AccountRequired();
            var sets = await store.ListPrivateSetsByOwnerAsync(ownerId, q, MaxResults, ct);

            return
            [
                .. sets.Select(s => new PhaseSetSummaryDto(
                    s.Id,
                    s.Title,
                    s.Summary.PhaseCount,
                    PhaseSetSource.Owned,
                    labels.EditedLabel(ToUtcOffset(s.UpdatedAt)),
                    null)),
            ];
        }

        var communitySets = await store.ListCommunitySetsAsync(
            q,
            subject: null,
            kind: null,
            sort: null,
            excludeAuthorId: viewerId,
            MaxResults,
            ct);

        return
        [
            .. communitySets.Select(s => new PhaseSetSummaryDto(
                s.Id,
                s.Title,
                s.Summary.PhaseCount,
                PhaseSetSource.Community,
                null,
                s.AuthorName)),
        ];
    }

    /// <summary>
    /// <c>GET /phase-sets/library</c> — biblioteca completa para <c>/conjuntos</c> em leitura exclusiva ao MongoDB.
    /// </summary>
    public async Task<PhaseSetLibraryResponse> GetLibraryAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = principal.GetUserId() ?? throw AccountRequired();
        var workspace = await store.GetOrCreateWorkspaceAsync(userId, ct);
        var privateSets = await store.ListPrivateSetsByOwnerAsync(userId, null, MaxResults, ct);
        var communitySets = await store.ListCommunitySetsAsync(
            q: null,
            subject: null,
            kind: null,
            sort: null,
            excludeAuthorId: userId,
            MaxResults,
            ct);

        var ownedEntries = privateSets.Select(ToLibraryEntry);
        var communityEntries = communitySets.Select(ToLibraryEntry);
        var entries = ownedEntries.Concat(communityEntries).ToList();

        var subjects = workspace.Subjects
            .Concat(privateSets.Select(s => s.Subject))
            .Concat(communitySets.Select(s => s.Subject))
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(s => s, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var folders = workspace.Folders
            .Concat(privateSets.Where(s => !string.IsNullOrWhiteSpace(s.Folder)).Select(s => s.Folder!))
            .Select(f => f.Trim())
            .Where(f => f.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new PhaseSetLibraryResponse(entries, subjects, folders, workspace.CoverUrl);
    }

    /// <summary>GET /phase-sets/{setId}/draft — conjunto privado na íntegra.</summary>
    public async Task<PhaseSetDraftResponse> GetDraftAsync(string setId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var doc = await FindOwnedAsync(setId, principal, ct);
        return ToDraft(doc);
    }

    /// <summary>POST /phase-sets — cria conjunto privado em <c>private_phase_sets</c>.</summary>
    public async Task<PhaseSetDraftResponse> CreateAsync(SavePhaseSetRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var ownerId = principal.GetUserId() ?? throw AccountRequired();
        var title = NormalizeTitle(request.Title);
        var subject = NormalizeSubject(request.Subject);
        var folder = NormalizeOptionalTag(request.Folder, "folder");
        var coverUrl = NormalizeCoverUrl(request.CoverUrl);
        var validated = PhaseDraftValidator.Validate(request.Phases);

        var now = DateTime.UtcNow;
        var items = BuildPrivateItems(validated, existingIds: null);
        var summary = ComputeSummary(items, useCount: 0, submissionsCount: 0, correctSubmissionsCount: 0);

        var doc = new PrivatePhaseSetDocument
        {
            Id = Guid.CreateVersion7(),
            OwnerId = ownerId,
            Title = title,
            Subject = subject,
            Folder = folder,
            CoverUrl = coverUrl,
            CreatedAt = now,
            UpdatedAt = now,
            Summary = summary,
            Phases = items,
        };

        await store.UpsertPrivateSetAsync(doc, ct);
        await SyncWorkspaceMetadataAsync(ownerId, subject, folder, ct);

        return ToDraft(doc);
    }

    /// <summary>PUT /phase-sets/{setId}/draft — substitui fases e atualiza summary no MongoDB.</summary>
    public async Task<PhaseSetDraftResponse> ReplaceDraftAsync(
        string setId,
        SavePhaseSetRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var doc = await FindOwnedAsync(setId, principal, ct);
        var title = NormalizeTitle(request.Title);
        var subject = request.Subject is null ? doc.Subject : NormalizeSubject(request.Subject);
        var folder = request.Folder is null ? doc.Folder : NormalizeOptionalTag(request.Folder, "folder");
        var coverUrl = request.CoverUrl is null ? doc.CoverUrl : NormalizeCoverUrl(request.CoverUrl);
        var validated = PhaseDraftValidator.Validate(request.Phases);

        var existingIds = doc.Phases.ToDictionary(p => p.Id);
        var items = BuildPrivateItems(validated, existingIds);

        doc.Title = title;
        doc.Subject = subject;
        doc.Folder = folder;
        doc.CoverUrl = coverUrl;
        doc.UpdatedAt = DateTime.UtcNow;
        doc.Phases = items;
        doc.Summary = ComputeSummary(
            items,
            doc.Summary.UseCount,
            doc.Summary.SubmissionsCount,
            doc.Summary.CorrectSubmissionsCount);

        await store.UpsertPrivateSetAsync(doc, ct);
        await SyncWorkspaceMetadataAsync(doc.OwnerId, doc.Subject, doc.Folder, ct);

        return ToDraft(doc);
    }

    /// <summary>PATCH /phase-sets/{setId} — renomeia e/ou atualiza metadados organizacionais.</summary>
    public async Task<PhaseSetSummaryDto> RenameAsync(
        string setId,
        RenamePhaseSetRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var doc = await FindOwnedAsync(setId, principal, ct);

        if (request.Title is not null || (request.Subject is null && request.Folder is null && request.CoverUrl is null))
        {
            doc.Title = NormalizeTitle(request.Title);
        }

        if (request.Subject is not null)
        {
            doc.Subject = NormalizeSubject(request.Subject);
        }

        if (request.Folder is not null)
        {
            doc.Folder = NormalizeOptionalTag(request.Folder, "folder");
        }

        if (request.CoverUrl is not null)
        {
            doc.CoverUrl = NormalizeCoverUrl(request.CoverUrl);
        }

        doc.UpdatedAt = DateTime.UtcNow;
        await store.UpsertPrivateSetAsync(doc, ct);
        await SyncWorkspaceMetadataAsync(doc.OwnerId, doc.Subject, doc.Folder, ct);

        return new PhaseSetSummaryDto(
            doc.Id,
            doc.Title,
            doc.Summary.PhaseCount,
            PhaseSetSource.Owned,
            labels.EditedLabel(ToUtcOffset(doc.UpdatedAt)),
            null);
    }

    /// <summary>
    /// DELETE /phase-sets/{setId} → 204. Exclui apenas de <c>private_phase_sets</c>,
    /// sem afetar versões já publicadas na comunidade nem filas de salas ativas.
    /// </summary>
    public async Task DeleteAsync(string setId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var doc = await FindOwnedAsync(setId, principal, ct);
        await store.DeletePrivateSetAsync(doc.Id, doc.OwnerId, ct);
    }

    /// <summary>
    /// POST /phase-sets/{setId}/publish — publica versão imutável em <c>community_phases</c> (PostgreSQL)
    /// com deduplicação por hash, e após commit grava o ponteiro ordenado <c>phaseIds[]</c> em <c>community_phase_sets</c> (MongoDB).
    /// </summary>
    public async Task<PhaseSetLibraryEntryDto> PublishAsync(string setId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var doc = await FindOwnedAsync(setId, principal, ct);
        var author = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == doc.OwnerId, ct)
                     ?? throw AccountRequired();

        if (doc.Phases.Count is 0)
        {
            throw new ApiException(
                StatusCodes.Status409Conflict,
                ErrorCodes.IncompletePhase,
                "O conjunto precisa ter pelo menos uma fase completa para ser publicado.");
        }

        var ordered = doc.Phases.OrderBy(p => p.OrderIndex).ToList();
        var contents = new List<PhaseContent>(ordered.Count);

        foreach (var item in ordered)
        {
            var content = PhaseContentHasher.ToContent(item.Content);
            PhaseGrading.EnsureComplete(item.Kind, item.Name, item.OrderIndex, content);
            contents.Add(content);
        }

        var originIds = ordered
            .Where(p => p.OriginCommunityPhaseId.HasValue)
            .Select(p => p.OriginCommunityPhaseId!.Value)
            .Distinct()
            .ToList();

        var existingOrigins = originIds.Count > 0
            ? await db.CommunityPhases
                .AsNoTracking()
                .Where(cp => originIds.Contains(cp.Id) && cp.Status == CommunityResourceStatus.Published)
                .ToDictionaryAsync(cp => cp.Id, ct)
            : new Dictionary<Guid, CommunityPhase>();

        var nextVersion = (doc.PublishedVersion ?? 0) + 1;
        var phaseIds = new List<Guid>(ordered.Count);

        for (var i = 0; i < ordered.Count; i++)
        {
            var item = ordered[i];
            var content = contents[i];
            var hash = PhaseContentHasher.Compute(
                item.Kind,
                item.Name,
                item.BasePoints,
                item.PointsMultiplier,
                item.TimeSeconds,
                content);

            if (item.OriginCommunityPhaseId is { } originId
                && existingOrigins.TryGetValue(originId, out var existingPhase)
                && string.Equals(existingPhase.ContentHash, hash, StringComparison.Ordinal))
            {
                item.ContentHash = hash;
                phaseIds.Add(originId);
                continue;
            }

            var newPhase = new CommunityPhase
            {
                Id = Guid.CreateVersion7(),
                AuthorId = author.Id,
                AuthorName = author.Name,
                OriginPhaseId = item.OriginCommunityPhaseId,
                SourceDraftPhaseId = item.Id,
                Version = nextVersion,
                Kind = item.Kind,
                Subject = doc.Subject,
                Name = item.Name,
                QuestionPreview = PhaseContentHasher.BuildQuestionPreview(content.Question),
                BasePoints = item.BasePoints,
                PointsMultiplier = item.PointsMultiplier,
                TimeSeconds = item.TimeSeconds,
                ContentJson = content.ToJson(),
                ContentHash = hash,
                Status = CommunityResourceStatus.Published,
                PublishedAt = DateTimeOffset.UtcNow,
            };

            db.CommunityPhases.Add(newPhase);
            item.OriginCommunityPhaseId = newPhase.Id;
            item.ContentHash = hash;
            phaseIds.Add(newPhase.Id);
        }

        await db.SaveChangesAsync(ct);

        var publishedDoc = new CommunityPhaseSetDocument
        {
            Id = Guid.CreateVersion7(),
            SourcePrivateSetId = doc.Id,
            Version = nextVersion,
            AuthorId = author.Id,
            AuthorName = author.Name,
            Title = doc.Title,
            Subject = doc.Subject,
            CoverUrl = doc.CoverUrl,
            Status = CommunityResourceStatus.Published,
            PublishedAt = DateTime.UtcNow,
            PhaseIds = phaseIds,
            Summary = ComputeSummary(ordered, useCount: 0, submissionsCount: 0, correctSubmissionsCount: 0),
        };

        await store.InsertCommunitySetAsync(publishedDoc, ct);

        doc.PublishedSetId = publishedDoc.Id;
        doc.PublishedVersion = nextVersion;
        await store.UpsertPrivateSetAsync(doc, ct);

        return ToLibraryEntry(publishedDoc);
    }

    /// <summary>
    /// POST /phase-sets/{setId}/copy — resolve <c>phaseIds[]</c> em lote do PostgreSQL (<c>ANY(@phaseIds)</c>)
    /// e cria uma cópia privada editável isolada no MongoDB.
    /// </summary>
    public async Task<PhaseSetDraftResponse> CopyAsync(string setId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var ownerId = principal.GetUserId() ?? throw AccountRequired();

        if (!Guid.TryParse(setId, out var id))
        {
            throw NotFound();
        }

        var now = DateTime.UtcNow;
        var communityDoc = await store.GetCommunitySetAsync(id, ct);
        if (communityDoc is { Status: CommunityResourceStatus.Published })
        {
            var phaseMap = communityDoc.PhaseIds.Count > 0
                ? await db.CommunityPhases
                    .AsNoTracking()
                    .Where(p => communityDoc.PhaseIds.Contains(p.Id))
                    .ToDictionaryAsync(p => p.Id, ct)
                : new Dictionary<Guid, CommunityPhase>();

            var copiedItems = new List<PrivatePhaseItemDocument>(communityDoc.PhaseIds.Count);
            foreach (var phaseId in communityDoc.PhaseIds)
            {
                if (!phaseMap.TryGetValue(phaseId, out var cp))
                {
                    continue;
                }

                var content = PhaseContent.Parse(cp.ContentJson);
                copiedItems.Add(new PrivatePhaseItemDocument
                {
                    Id = Guid.CreateVersion7(),
                    OriginCommunityPhaseId = cp.Id,
                    ContentHash = cp.ContentHash,
                    Kind = cp.Kind,
                    Name = cp.Name,
                    BasePoints = cp.BasePoints,
                    PointsMultiplier = cp.PointsMultiplier,
                    TimeSeconds = cp.TimeSeconds,
                    OrderIndex = copiedItems.Count,
                    Content = PhaseContentHasher.FromContent(content),
                });
            }

            var copyFromCommunity = new PrivatePhaseSetDocument
            {
                Id = Guid.CreateVersion7(),
                OwnerId = ownerId,
                Title = communityDoc.Title,
                Subject = communityDoc.Subject,
                Folder = null,
                CoverUrl = communityDoc.CoverUrl,
                CreatedAt = now,
                UpdatedAt = now,
                Summary = ComputeSummary(copiedItems, useCount: 0, submissionsCount: 0, correctSubmissionsCount: 0),
                Phases = copiedItems,
            };

            await store.UpsertPrivateSetAsync(copyFromCommunity, ct);
            await store.IncrementSetUseCountAsync(communityDoc.Id, isCommunity: true, ct);
            await SyncWorkspaceMetadataAsync(ownerId, copyFromCommunity.Subject, copyFromCommunity.Folder, ct);

            return ToDraft(copyFromCommunity);
        }

        var privateDoc = await store.GetPrivateSetAsync(id, ct);
        if (privateDoc is not null && privateDoc.OwnerId == ownerId)
        {
            var clonedItems = privateDoc.Phases
                .OrderBy(p => p.OrderIndex)
                .Select((p, index) => new PrivatePhaseItemDocument
                {
                    Id = Guid.CreateVersion7(),
                    OriginCommunityPhaseId = p.OriginCommunityPhaseId,
                    ContentHash = p.ContentHash,
                    Kind = p.Kind,
                    Name = p.Name,
                    BasePoints = p.BasePoints,
                    PointsMultiplier = p.PointsMultiplier,
                    TimeSeconds = p.TimeSeconds,
                    OrderIndex = index,
                    Content = p.Content with { },
                })
                .ToList();

            var copyFromPrivate = new PrivatePhaseSetDocument
            {
                Id = Guid.CreateVersion7(),
                OwnerId = ownerId,
                Title = privateDoc.Title,
                Subject = privateDoc.Subject,
                Folder = privateDoc.Folder,
                CoverUrl = privateDoc.CoverUrl,
                CreatedAt = now,
                UpdatedAt = now,
                Summary = ComputeSummary(clonedItems, useCount: 0, submissionsCount: 0, correctSubmissionsCount: 0),
                Phases = clonedItems,
            };

            await store.UpsertPrivateSetAsync(copyFromPrivate, ct);
            return ToDraft(copyFromPrivate);
        }

        throw NotFound();
    }

    /// <summary>
    /// Resolve um conjunto (privado do usuário no MongoDB ou publicado na comunidade com lookup em lote
    /// em <c>community_phases</c>) para copiar para a fila congelada de uma sala.
    /// </summary>
    public async Task<ResolvedQueueSet> ResolveSetForQueueAsync(Guid setId, Guid? viewerUserId, CancellationToken ct)
    {
        var privateDoc = await store.GetPrivateSetAsync(setId, ct);
        if (privateDoc is not null)
        {
            if (viewerUserId is not { } ownerId || privateDoc.OwnerId != ownerId)
            {
                throw NotFound();
            }

            var resolvedPrivate = privateDoc.Phases
                .OrderBy(p => p.OrderIndex)
                .Select(p => new ResolvedQueuePhase(
                    p.Id,
                    p.Kind,
                    p.Name,
                    p.BasePoints,
                    p.PointsMultiplier,
                    p.TimeSeconds,
                    PhaseContentHasher.ToContent(p.Content).ToJson()))
                .ToList();

            return new ResolvedQueueSet(privateDoc.Id, privateDoc.Title, IsCommunity: false, resolvedPrivate);
        }

        var communityDoc = await store.GetCommunitySetAsync(setId, ct);
        if (communityDoc is { Status: CommunityResourceStatus.Published })
        {
            var phaseMap = communityDoc.PhaseIds.Count > 0
                ? await db.CommunityPhases
                    .AsNoTracking()
                    .Where(p => communityDoc.PhaseIds.Contains(p.Id))
                    .ToDictionaryAsync(p => p.Id, ct)
                : new Dictionary<Guid, CommunityPhase>();

            var resolvedCommunity = new List<ResolvedQueuePhase>(communityDoc.PhaseIds.Count);
            foreach (var phaseId in communityDoc.PhaseIds)
            {
                if (!phaseMap.TryGetValue(phaseId, out var cp))
                {
                    continue;
                }

                resolvedCommunity.Add(new ResolvedQueuePhase(
                    cp.Id,
                    cp.Kind,
                    cp.Name,
                    cp.BasePoints,
                    cp.PointsMultiplier,
                    cp.TimeSeconds,
                    cp.ContentJson));
            }

            return new ResolvedQueueSet(communityDoc.Id, communityDoc.Title, IsCommunity: true, resolvedCommunity);
        }

        throw NotFound();
    }

    private async Task<PrivatePhaseSetDocument> FindOwnedAsync(string setId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var ownerId = principal.GetUserId() ?? throw AccountRequired();

        if (!Guid.TryParse(setId, out var id))
        {
            throw NotFound();
        }

        var doc = await store.GetPrivateSetAsync(id, ct);
        if (doc is null || doc.OwnerId != ownerId)
        {
            throw NotFound();
        }

        return doc;
    }

    private async Task SyncWorkspaceMetadataAsync(Guid userId, string subject, string? folder, CancellationToken ct)
    {
        var needsSubject = !string.Equals(subject, DefaultSubject, StringComparison.OrdinalIgnoreCase);
        var needsFolder = !string.IsNullOrWhiteSpace(folder);
        if (!needsSubject && !needsFolder)
        {
            return;
        }

        var workspace = await store.GetOrCreateWorkspaceAsync(userId, ct);
        var changed = false;

        if (needsSubject && !workspace.Subjects.Contains(subject, StringComparer.OrdinalIgnoreCase))
        {
            workspace.Subjects.Add(subject);
            changed = true;
        }

        if (needsFolder && !workspace.Folders.Contains(folder!, StringComparer.OrdinalIgnoreCase))
        {
            workspace.Folders.Add(folder!);
            changed = true;
        }

        if (changed)
        {
            workspace.UpdatedAt = DateTime.UtcNow;
            await store.UpsertWorkspaceAsync(workspace, ct);
        }
    }

    private static List<PrivatePhaseItemDocument> BuildPrivateItems(
        IReadOnlyList<DraftPhaseDto> phases,
        Dictionary<Guid, PrivatePhaseItemDocument>? existingIds)
    {
        var result = new List<PrivatePhaseItemDocument>(phases.Count);

        for (var index = 0; index < phases.Count; index++)
        {
            var incoming = phases[index];
            var phaseId = existingIds is not null
                          && Guid.TryParse(incoming.Id, out var parsed)
                          && existingIds.Remove(parsed, out _)
                ? parsed
                : Guid.CreateVersion7();

            var name = incoming.Name!.Trim();
            var multiplier = PhaseLimits.RoundMultiplier(incoming.PointsMultiplier);
            var content = PhaseContent.From(incoming);
            var hash = PhaseContentHasher.Compute(
                incoming.Kind,
                name,
                incoming.BasePoints,
                multiplier,
                incoming.TimeSeconds,
                content);

            result.Add(new PrivatePhaseItemDocument
            {
                Id = phaseId,
                OriginCommunityPhaseId = incoming.OriginCommunityPhaseId,
                ContentHash = hash,
                Kind = incoming.Kind,
                Name = name,
                BasePoints = incoming.BasePoints,
                PointsMultiplier = multiplier,
                TimeSeconds = incoming.TimeSeconds,
                OrderIndex = index,
                Content = PhaseContentHasher.FromContent(content),
            });
        }

        return result;
    }

    private static PhaseSetSummarySubdocument ComputeSummary(
        IReadOnlyList<PrivatePhaseItemDocument> items,
        long useCount,
        long submissionsCount,
        long correctSubmissionsCount)
        => PhaseSetSummarySubdocument.Compute(
            [.. items.Select(p => (p.Kind, p.TimeSeconds))],
            useCount,
            submissionsCount,
            correctSubmissionsCount);

    private static PhaseSetDraftResponse ToDraft(PrivatePhaseSetDocument doc) => new(
        doc.Id,
        doc.Title,
        [.. doc.Phases.OrderBy(p => p.OrderIndex).Select(ToDraftPhase)],
        new PhaseLimitsDto(),
        doc.Subject,
        doc.Folder,
        doc.CoverUrl);

    private static DraftPhaseDto ToDraftPhase(PrivatePhaseItemDocument phase)
    {
        var content = PhaseContentHasher.ToContent(phase.Content);

        return new DraftPhaseDto(
            phase.Id.ToString(),
            phase.Kind,
            phase.Name,
            phase.BasePoints,
            phase.PointsMultiplier,
            phase.TimeSeconds,
            content.FromAI,
            content.Question ?? string.Empty,
            Options: phase.Kind is PhaseKind.Quiz ? content.Options ?? [] : null,
            CorrectIndexes: phase.Kind is PhaseKind.Quiz ? content.CorrectIndexes ?? [] : null,
            Words: phase.Kind is PhaseKind.Fill ? content.Words ?? [] : null,
            Blanks: phase.Kind is PhaseKind.Fill ? content.Blanks ?? [] : null,
            StarterCode: phase.Kind is PhaseKind.Code ? content.StarterCode ?? string.Empty : null,
            TestCases: phase.Kind is PhaseKind.Code ? content.TestCases ?? string.Empty : null,
            ExpectedAnswer: phase.Kind is PhaseKind.Text ? content.ExpectedAnswer ?? string.Empty : null,
            Theme: content.Theme,
            ShowFeedbackAnimation: content.ShowFeedbackAnimation,
            IntroSeconds: content.IntroSeconds,
            IntroTip: content.IntroTip,
            IntroSound: content.IntroSound,
            IntroShapes: content.IntroShapes,
            VariationSettings: content.VariationSettings,
            OriginCommunityPhaseId: phase.OriginCommunityPhaseId);
    }

    private PhaseSetLibraryEntryDto ToLibraryEntry(PrivatePhaseSetDocument doc) => new(
        doc.Id,
        doc.Title,
        doc.Summary.PhaseCount,
        PhaseSetSource.Owned,
        labels.EditedLabel(ToUtcOffset(doc.UpdatedAt)),
        null,
        doc.Summary.PhaseKindCounts,
        doc.Summary.AccuracyRate,
        LabelFormatter.DurationLabel(TimeSpan.FromSeconds(doc.Summary.TotalTimeSeconds)),
        doc.Subject,
        doc.Folder,
        doc.Summary.UseCount,
        doc.CoverUrl,
        doc.PublishedVersion);

    private static PhaseSetLibraryEntryDto ToLibraryEntry(CommunityPhaseSetDocument doc) => new(
        doc.Id,
        doc.Title,
        doc.Summary.PhaseCount,
        PhaseSetSource.Community,
        null,
        doc.AuthorName,
        doc.Summary.PhaseKindCounts,
        doc.Summary.AccuracyRate,
        LabelFormatter.DurationLabel(TimeSpan.FromSeconds(doc.Summary.TotalTimeSeconds)),
        doc.Subject,
        null,
        doc.Summary.UseCount,
        doc.CoverUrl,
        doc.Version);

    private static DateTimeOffset ToUtcOffset(DateTime utc)
        => new(DateTime.SpecifyKind(utc, DateTimeKind.Utc));

    private static string NormalizeTitle(string? title)
    {
        var normalized = title?.Trim();

        return string.IsNullOrEmpty(normalized) || normalized.Length > MaxTitleLength
            ? throw Validation($"title deve ter entre 1 e {MaxTitleLength} caracteres.")
            : normalized;
    }

    private static string NormalizeSubject(string? subject)
    {
        var normalized = subject?.Trim();
        if (string.IsNullOrEmpty(normalized))
        {
            return DefaultSubject;
        }

        if (normalized.Length > MaxMetadataLength)
        {
            throw Validation($"subject deve ter no maximo {MaxMetadataLength} caracteres.");
        }

        return normalized;
    }

    private static string? NormalizeOptionalTag(string? value, string fieldName)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrEmpty(normalized))
        {
            return null;
        }

        if (normalized.Length > MaxMetadataLength)
        {
            throw Validation($"{fieldName} deve ter no maximo {MaxMetadataLength} caracteres.");
        }

        return normalized;
    }

    private static string? NormalizeCoverUrl(string? value)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrEmpty(normalized))
        {
            return null;
        }

        if (normalized.Length > MaxCoverUrlLength)
        {
            throw Validation($"coverUrl deve ter no maximo {MaxCoverUrlLength} caracteres.");
        }

        return normalized;
    }

    private static PhaseSetSource ParseScope(string? scope) => scope?.Trim().ToLowerInvariant() switch
    {
        null or "" or "owned" => PhaseSetSource.Owned,
        "community" => PhaseSetSource.Community,
        _ => throw Validation("scope deve ser owned ou community."),
    };

    private static ApiException AccountRequired()
        => new(StatusCodes.Status403Forbidden, ErrorCodes.AccountRequired, "E preciso ter uma conta para acessar conjuntos de fases.");

    private static ApiException NotFound()
        => new(StatusCodes.Status404NotFound, ErrorCodes.PhaseSetNotFound, "Conjunto de fases nao encontrado.");

    private static ApiException Validation(string message)
        => new(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, message);
}
