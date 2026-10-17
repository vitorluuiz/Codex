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
    /// Nao vem do contrato: e sanidade. Um conjunto e o roteiro de uma aula, e a fila da sala
    /// aceita 8 deles — 50 fases por conjunto ja e mais do que qualquer aula real, e impede que um
    /// POST unico grave dezenas de milhares de linhas.
    /// </summary>
    private const int MaxPhasesPerSet = 50;

    /// <summary>"options entre 2 e 6" (secao 5), repetido aqui porque a UI impedir nao e garantia.</summary>
    private const int MinOptions = 2;
    private const int MaxOptions = 8;

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
        var phases = Validate(request.Phases);

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
        var phases = Validate(request.Phases);

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
        [.. set.Phases.OrderBy(p => p.OrderIndex).Select(ToDraftPhase)]);

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
            IntroShapes: content.IntroShapes);
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
    /// As tres validacoes que o contrato manda o servidor repetir ("a UI ja impede, mas isso nao e
    /// garantia") mais os limites de coluna e de sanidade numerica.
    ///
    /// <b>O que deliberadamente nao e validado: campo em branco.</b> Enunciado vazio, alternativa
    /// vazia, lacuna sem palavra escolhida — tudo isso passa. Isto e um <i>rascunho</i>: o editor
    /// cria a fase com enunciado vazio e o autor sai da tela no meio, e um conjunto que so pode
    /// ser salvo quando estiver perfeito e um conjunto que se perde. O que nao passa e o que e
    /// <i>contraditorio</i> — um quiz cuja resposta certa e "todas", um gabarito posicional com
    /// mais entradas do que lacunas —, porque isso nao e falta de conteudo, e conteudo que nao
    /// pode existir. Quando a partida for implementada (secao 7), quem cobra fase completa e o
    /// inicio da partida, nao o salvamento.
    /// </summary>
    private static IReadOnlyList<DraftPhaseDto> Validate(IReadOnlyList<DraftPhaseDto>? phases)
    {
        // Corpo sem "phases" vira conjunto sem fase — nao e erro: o editor salva o titulo antes de
        // escrever a primeira fase, e a biblioteca mostra "0 fases" sem problema.
        phases ??= [];

        if (phases.Count > MaxPhasesPerSet)
        {
            throw Validation($"um conjunto aceita no maximo {MaxPhasesPerSet} fases.");
        }

        for (var index = 0; index < phases.Count; index++)
        {
            Validate(phases[index], index);
        }

        return phases;
    }

    private static void Validate(DraftPhaseDto phase, int index)
    {
        var name = phase.Name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > MaxTitleLength)
        {
            throw Validation($"phases[{index}].name deve ter entre 1 e {MaxTitleLength} caracteres.");
        }

        if (phase.BasePoints is < 0 or > PhaseLimits.MaxBasePoints)
        {
            throw Validation($"phases[{index}].basePoints deve estar entre 0 e {PhaseLimits.MaxBasePoints}.");
        }

        if (phase.TimeSeconds is < PhaseLimits.MinTimeSeconds or > PhaseLimits.MaxTimeSeconds)
        {
            throw Validation($"phases[{index}].timeSeconds deve estar entre {PhaseLimits.MinTimeSeconds} e {PhaseLimits.MaxTimeSeconds}.");
        }

        if (phase.PointsMultiplier < PhaseLimits.MinPointsMultiplier || phase.PointsMultiplier > PhaseLimits.MaxPointsMultiplier)
        {
            throw Validation($"phases[{index}].pointsMultiplier deve estar entre {PhaseLimits.MinPointsMultiplier} e {PhaseLimits.MaxPointsMultiplier}.");
        }

        if (phase.Theme is { } rawTheme && rawTheme.Trim() is { Length: > 0 } theme && !PhaseLimits.AllowedThemes.Contains(theme))
        {
            throw Validation($"phases[{index}].theme invalido.");
        }

        if (phase.IntroSeconds is { } introSeconds && (introSeconds < PhaseLimits.MinIntroSeconds || introSeconds > PhaseLimits.MaxIntroSeconds))
        {
            throw Validation($"phases[{index}].introSeconds deve estar entre {PhaseLimits.MinIntroSeconds} e {PhaseLimits.MaxIntroSeconds}.");
        }

        if (PhaseLimits.ExceedsLength(phase.IntroTip, PhaseLimits.MaxIntroTipLength))
        {
            throw Validation($"phases[{index}].introTip deve ter no maximo {PhaseLimits.MaxIntroTipLength} caracteres.");
        }

        // Texto livre tem teto desde a migracao de dados: o conteudo da fase e copiado para a fila
        // da sala e, no fim da partida, para dentro de um documento do Mongo (teto rigido de
        // 16 MB) — passando antes pelo Redis, que tem maxmemory. O porque de cada numero esta em
        // PhaseLimits. Campo <i>vazio</i> continua valido: isto aqui e rascunho.
        if (PhaseLimits.ExceedsLength(phase.Question, PhaseLimits.MaxQuestionLength))
        {
            throw Validation($"phases[{index}].question deve ter no maximo {PhaseLimits.MaxQuestionLength} caracteres.");
        }

        switch (phase.Kind)
        {
            case PhaseKind.Quiz:
                ValidateQuiz(phase, index);
                break;

            case PhaseKind.Fill:
                ValidateFill(phase, index);
                break;

            case PhaseKind.Code:
                if (phase.StarterCode is null || phase.TestCases is null)
                {
                    throw Validation($"phases[{index}] do tipo code exige starterCode e testCases.");
                }

                if (PhaseLimits.ExceedsLength(phase.StarterCode, PhaseLimits.MaxStarterCodeLength))
                {
                    throw Validation($"phases[{index}].starterCode deve ter no maximo {PhaseLimits.MaxStarterCodeLength} caracteres.");
                }

                if (PhaseLimits.ExceedsLength(phase.TestCases, PhaseLimits.MaxTestCasesLength))
                {
                    throw Validation($"phases[{index}].testCases deve ter no maximo {PhaseLimits.MaxTestCasesLength} caracteres.");
                }

                break;

            case PhaseKind.Text:
                if (phase.ExpectedAnswer is null)
                {
                    throw Validation($"phases[{index}] do tipo text exige expectedAnswer.");
                }

                if (PhaseLimits.ExceedsLength(phase.ExpectedAnswer, PhaseLimits.MaxExpectedAnswerLength))
                {
                    throw Validation($"phases[{index}].expectedAnswer deve ter no maximo {PhaseLimits.MaxExpectedAnswerLength} caracteres.");
                }

                break;
        }
    }

    private static void ValidateQuiz(DraftPhaseDto phase, int index)
    {
        if (phase.Options is not { } options || phase.CorrectIndexes is not { } correct)
        {
            throw Validation($"phases[{index}] do tipo quiz exige options e correctIndexes.");
        }

        if (options.Count is < MinOptions or > MaxOptions)
        {
            throw Validation($"phases[{index}].options deve ter entre {MinOptions} e {MaxOptions} alternativas.");
        }

        if (options.Any(option => PhaseLimits.ExceedsLength(option, PhaseLimits.MaxOptionLength)))
        {
            throw Validation($"phases[{index}].options aceita no maximo {PhaseLimits.MaxOptionLength} caracteres por alternativa.");
        }

        if (correct.Count is 0)
        {
            throw Validation($"phases[{index}].correctIndexes nao pode ser vazio.");
        }

        if (correct.Any(i => i < 0 || i >= options.Count))
        {
            throw Validation($"phases[{index}].correctIndexes aponta para uma alternativa que nao existe.");
        }

        // Distintos antes de contar: [0,0,0] em quatro alternativas nao e "todas certas", e sem
        // isto passaria pela checagem de baixo por acidente de contagem.
        if (correct.Distinct().Count() != correct.Count)
        {
            throw Validation($"phases[{index}].correctIndexes tem indices repetidos.");
        }

        // "Nunca com todas as alternativas": uma pergunta em que qualquer clique acerta nao mede
        // nada, e o placar da partida contaria como acerto de todo mundo.
        if (correct.Count >= options.Count)
        {
            throw Validation($"phases[{index}].correctIndexes nao pode marcar todas as alternativas.");
        }
    }

    private static void ValidateFill(DraftPhaseDto phase, int index)
    {
        if (phase.Words is not { } words || phase.Blanks is not { } blanks)
        {
            throw Validation($"phases[{index}] do tipo fill exige words e blanks.");
        }

        if (words.Count > PhaseLimits.MaxWords)
        {
            throw Validation($"phases[{index}].words aceita no maximo {PhaseLimits.MaxWords} palavras.");
        }

        if (words.Any(word => PhaseLimits.ExceedsLength(word, PhaseLimits.MaxOptionLength)))
        {
            throw Validation($"phases[{index}].words aceita no maximo {PhaseLimits.MaxOptionLength} caracteres por palavra.");
        }

        // O gabarito e posicional: uma entrada por lacuna, na ordem. Com tamanho diferente do
        // enunciado, nao da para saber qual palavra pertence a qual lacuna — e o editor ja
        // sincroniza os dois a cada tecla (syncBlanks), entao divergir aqui e corpo montado a mao.
        var expected = PhaseContent.CountBlanks(phase.Question);
        if (blanks.Count != expected)
        {
            throw Validation($"phases[{index}].blanks deve ter uma entrada por lacuna do enunciado ({expected}).");
        }

        // Mesma familia do "todas as alternativas certas": uma lacuna cuja resposta nao esta no
        // banco de palavras e uma fase que ninguem consegue acertar. Lacuna ainda em branco
        // (null) continua valida — e so um rascunho pela metade.
        if (blanks.Any(blank => blank is not null && !words.Contains(blank)))
        {
            throw Validation($"phases[{index}].blanks usa uma palavra que nao esta em words.");
        }
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
