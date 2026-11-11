using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Formatting;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// api-rest.md secao 5 — a biblioteca de conjuntos e o editor.
///
/// Todas as rotas de escrita daqui sao "do autor": quem nao e dono do conjunto recebe
/// PHASE_SET_NOT_FOUND, e nao NOT_ROOM_LEADER (que e de sala) nem 403. O motivo esta em
/// <see cref="FindOwnedAsync"/>.
///
/// E a primeira leva que precisa <b>entender</b> o <c>ContentJson</c>: ate agora ele so tinha
/// sido gravado por SQL e copiado literal para a fila. O formato guardado esta em
/// <see cref="PhaseContent"/>.
/// </summary>
public class PhaseSetService(AppDbContext db, LabelFormatter labels)
{
    /// <summary>
    /// Teto de linhas de <c>GET /phase-sets</c>. O contrato nao pagina esta rota e o seletor de
    /// conjuntos nao tem "carregar mais" — mesmo criterio do historico de partidas do perfil.
    /// A busca por <c>q</c> e o que faz a biblioteca da comunidade caber aqui.
    /// </summary>
    public const int MaxResults = 50;

    /// <summary>Igual ao HasMaxLength(160) de phase_sets.Title e phases.Name — cortar aqui devolve VALIDATION_ERROR em vez de estourar no INSERT.</summary>
    private const int MaxTitleLength = PhaseLimits.MaxNameLength;

    /// <summary>
    /// GET /phase-sets?scope=owned|community&amp;q= — o seletor "Escolher conjunto de fases" e a
    /// aba de biblioteca do perfil.
    ///
    /// <c>scope</c> decide as duas coisas de uma vez: quais conjuntos entram e qual
    /// <see cref="PhaseSetSource"/> sai em cada linha. Nao e redundancia — "source e relativo a
    /// quem olha, nao e atributo do conjunto" (mesma regra ja fixada pelo perfil): o conjunto que
    /// o autor publicou aparece como <c>owned</c> ("editado ha 2 dias") para ele e como
    /// <c>community</c> ("por Prof. Marcos") para os outros.
    ///
    /// <b>A aba comunidade esconde os conjuntos do proprio usuario</b>, que ja estao inteiros na
    /// aba "meus". Sem isso o mesmo conjunto sairia duas vezes no mesmo seletor, com rotulos
    /// diferentes, e o autor teria que descobrir que sao o mesmo.
    /// </summary>
    public async Task<IReadOnlyList<PhaseSetSummaryDto>> ListAsync(
        string? scope,
        string? q,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var source = ParseScope(scope);
        var viewerId = principal.GetUserId();
        var query = db.PhaseSets.AsNoTracking();

        if (source is PhaseSetSource.Owned)
        {
            // "Meus conjuntos" sem conta nao e uma lista vazia, e um pedido sem sujeito — mesmo
            // criterio do GET /users/me/profile.
            var ownerId = viewerId ?? throw AccountRequired();
            query = query.Where(s => s.OwnerId == ownerId);
        }
        else
        {
            query = query.Where(s => s.Visibility == PhaseSetVisibility.Community);

            if (viewerId is { } id)
            {
                query = query.Where(s => s.OwnerId != id);
            }
        }

        var search = q?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            // ToLower() e nao EF.Functions.ILike: o ILike so existe no Npgsql e os testes rodam em
            // InMemory. Traduz para lower(title) LIKE lower(...) no Postgres, que e o que a busca
            // do seletor precisa.
            var lowered = search.ToLower();
            query = query.Where(s => s.Title.ToLower().Contains(lowered));
        }

        var sets = await query
            .OrderByDescending(s => s.UpdatedAt)
            .Take(MaxResults)
            .Select(s => new
            {
                s.Id,
                s.Title,
                s.UpdatedAt,
                AuthorName = s.Owner.Name,
                PhaseCount = s.Phases.Count,
            })
            .ToListAsync(ct);

        return [.. sets.Select(s => new PhaseSetSummaryDto(
            s.Id,
            s.Title,
            s.PhaseCount,
            source,
            source is PhaseSetSource.Owned ? labels.EditedLabel(s.UpdatedAt) : null,
            source is PhaseSetSource.Owned ? null : s.AuthorName))];
    }

    /// <summary>GET /phase-sets/{setId}/draft — a tela do editor inteira, em uma chamada.</summary>
    public async Task<PhaseSetDraftResponse> GetDraftAsync(string setId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var set = await FindOwnedAsync(setId, principal, tracked: false, ct);
        return ToDraft(set);
    }

    /// <summary>
    /// POST /phase-sets — o "Salvar" de um conjunto que ainda nao existe (<c>id: null</c> no
    /// rascunho do front).
    ///
    /// Nasce <c>private</c>: publicar na comunidade e uma acao separada, que o contrato ainda nao
    /// tem rota para fazer. Ninguem publica sem pedir.
    /// </summary>
    public async Task<PhaseSetDraftResponse> CreateAsync(SavePhaseSetRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var ownerId = principal.GetUserId() ?? throw AccountRequired();
        var title = NormalizeTitle(request.Title);
        var phases = PhaseDraftValidator.Validate(request.Phases);

        var set = new PhaseSet
        {
            Title = title,
            OwnerId = ownerId,
            Visibility = PhaseSetVisibility.Private,
        };
        db.PhaseSets.Add(set);

        for (var index = 0; index < phases.Count; index++)
        {
            var phase = new Phase { PhaseSetId = set.Id, Name = string.Empty, ContentJson = string.Empty };
            Apply(phase, phases[index], index);
            // So no DbSet: o change tracker faz o fixup e coloca a fase em set.Phases sozinho.
            // Adicionar nos dois lugares punha a mesma fase duas vezes na navegacao — e e de la
            // que a resposta e montada.
            db.Phases.Add(phase);
        }

        await db.SaveChangesAsync(ct);

        return ToDraft(set);
    }

    /// <summary>
    /// PUT /phase-sets/{setId}/draft — o "Salvar" de um conjunto que ja existe. O corpo e o
    /// conjunto inteiro, entao o que nao veio no array foi apagado no editor e sai daqui tambem.
    ///
    /// <b>Fase que ja tem id definitivo e atualizada no lugar, nao recriada.</b> O contrato so
    /// exige que ids <c>draft_*</c> voltem trocados pelos definitivos, mas apagar e reinserir tudo
    /// daria um id novo a cada gravada — e <c>RoomQueuePhase.SourcePhaseId</c>, que e a unica
    /// pista de qual fase da biblioteca originou a fase de uma partida, apontaria para um id que
    /// nao existe mais depois da primeira correcao de digitacao.
    /// </summary>
    public async Task<PhaseSetDraftResponse> ReplaceDraftAsync(
        string setId,
        SavePhaseSetRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var set = await FindOwnedAsync(setId, principal, tracked: true, ct);
        var title = NormalizeTitle(request.Title);
        var phases = PhaseDraftValidator.Validate(request.Phases);

        set.Title = title;
        set.UpdatedAt = DateTimeOffset.UtcNow;

        // Consumido conforme cada id do corpo e reconhecido: o que sobrar no fim foi removido no
        // editor. Consumir tambem impede que duas fases do corpo reivindiquem a mesma linha — a
        // segunda cai como fase nova, em vez de sobrescrever a primeira em silencio.
        var existing = set.Phases.ToDictionary(p => p.Id);

        for (var index = 0; index < phases.Count; index++)
        {
            var incoming = phases[index];
            Phase phase;

            if (Guid.TryParse(incoming.Id, out var id) && existing.Remove(id, out var tracked))
            {
                phase = tracked;
            }
            else
            {
                // Id "draft_*", ausente, ou de fase de outro conjunto: nasce agora. Um id de outra
                // pessoa nao pode ser adotado por este conjunto — seria roubar a fase dela.
                phase = new Phase { PhaseSetId = set.Id, Name = string.Empty, ContentJson = string.Empty };
                db.Phases.Add(phase);
            }

            Apply(phase, incoming, index);
        }

        foreach (var removed in existing.Values)
        {
            set.Phases.Remove(removed);
            db.Phases.Remove(removed);
        }

        await db.SaveChangesAsync(ct);

        return ToDraft(set);
    }

    /// <summary>
    /// PATCH /phase-sets/{setId} — o dialogo de renomear. Devolve o PhaseSetSummary porque e o que
    /// a linha da biblioteca precisa para se redesenhar sem refetch.
    ///
    /// Renomear conta como editar: mexe no <c>UpdatedAt</c>, entao o <c>updatedLabel</c> que volta
    /// e "editado agora". O contrario faria a lista reordenar de um jeito que o autor nao explica.
    /// </summary>
    public async Task<PhaseSetSummaryDto> RenameAsync(
        string setId,
        RenamePhaseSetRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var set = await FindOwnedAsync(setId, principal, tracked: true, ct);

        set.Title = NormalizeTitle(request.Title);
        set.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        return new PhaseSetSummaryDto(
            set.Id,
            set.Title,
            set.Phases.Count,
            PhaseSetSource.Owned,
            labels.EditedLabel(set.UpdatedAt),
            null);
    }

    /// <summary>
    /// DELETE /phase-sets/{setId} → 204.
    ///
    /// "Nao afeta partidas passadas: a fila copia a fase em vez de referencia-la" — e por isso que
    /// <c>RoomQueueSet.SourcePhaseSetId</c> e um Guid solto, sem FK (decisao 1 da secao 13).
    /// Apagar aqui nao toca em sala nenhuma, nem na que esta com o conjunto na fila agora.
    /// </summary>
    public async Task DeleteAsync(string setId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var set = await FindOwnedAsync(setId, principal, tracked: true, ct);

        db.PhaseSets.Remove(set);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// O conjunto, se quem chamou for o dono dele.
    ///
    /// Quem nao e dono recebe <b>404 PHASE_SET_NOT_FOUND</b>, e nao 403: todas as rotas que passam
    /// por aqui sao de autoria, e o front so monta esses links a partir da propria biblioteca.
    /// Responder 403 confirmaria a existencia de um conjunto privado de outra pessoa para quem
    /// varresse ids — e nao daria ao autor legitimo nenhuma acao a mais.
    ///
    /// Vale tambem para o conjunto <c>community</c> de outro autor: da para joga-lo numa sala
    /// (POST /rooms com setId), nao para abrir o editor dele.
    /// </summary>
    private async Task<PhaseSet> FindOwnedAsync(string setId, ClaimsPrincipal principal, bool tracked, CancellationToken ct)
    {
        var ownerId = principal.GetUserId() ?? throw AccountRequired();

        // Id malformado e 404 pelo mesmo motivo do GET /users/{userId}/profile: para quem esta
        // olhando, um id que nao resolve e um conjunto que nao existe.
        if (!Guid.TryParse(setId, out var id))
        {
            throw NotFound();
        }

        var query = tracked ? db.PhaseSets : db.PhaseSets.AsNoTracking();

        return await query
                   .Include(s => s.Phases)
                   .FirstOrDefaultAsync(s => s.Id == id && s.OwnerId == ownerId, ct)
               ?? throw NotFound();
    }

    private PhaseSetDraftResponse ToDraft(PhaseSet set) => new(
        set.Id,
        set.Title,
        [.. set.Phases.OrderBy(p => p.OrderIndex).Select(ToDraftPhase)],
        new PhaseLimitsDto());

    /// <summary>
    /// A fase como o editor a recebe de volta: colunas + o que estava no <c>ContentJson</c>.
    ///
    /// Os campos de outros kinds continuam nulos e, por causa do JsonIgnore de
    /// <see cref="DraftPhaseDto"/>, nem aparecem no corpo — uma fase de quiz nao devolve
    /// <c>blanks: null</c>, que em types.ts nao seria uma QuizDraftPhase valida.
    /// </summary>
    private static DraftPhaseDto ToDraftPhase(Phase phase)
    {
        var content = PhaseContent.Parse(phase.ContentJson);

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
            VariationSettings: content.VariationSettings);
    }

    private static void Apply(Phase phase, DraftPhaseDto incoming, int order)
    {
        phase.Kind = incoming.Kind;
        phase.Name = incoming.Name!.Trim();
        phase.BasePoints = incoming.BasePoints;
        phase.PointsMultiplier = PhaseLimits.RoundMultiplier(incoming.PointsMultiplier);
        phase.TimeSeconds = incoming.TimeSeconds;
        // "A ordem das fases e a ordem do array": a posicao no corpo e a unica fonte, e por isso
        // nao existe campo de ordem no DraftPhase para sair de sincronia com o rail.
        phase.OrderIndex = order;
        phase.ContentJson = PhaseContent.From(incoming).ToJson();
    }

    private static string NormalizeTitle(string? title)
    {
        var normalized = title?.Trim();

        return string.IsNullOrEmpty(normalized) || normalized.Length > MaxTitleLength
            ? throw Validation($"title deve ter entre 1 e {MaxTitleLength} caracteres.")
            : normalized;
    }

    /// <summary>
    /// <c>scope</c> ausente e "owned": o seletor abre na aba "meus conjuntos", e a rota so e
    /// chamada por quem tem conta. Valor desconhecido e erro, e nao um silencioso cai-no-padrao —
    /// devolver a biblioteca do proprio usuario para quem pediu "?scope=todos" seria uma resposta
    /// 200 respondendo outra pergunta.
    /// </summary>
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
