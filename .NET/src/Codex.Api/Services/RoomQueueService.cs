using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Realtime;
using Codex.Api.Contracts.Phases;
using Codex.Api.Contracts.Realtime;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// A fila de fases da sala (api-rest.md secao 6) e a copia PhaseSet -> fila que a alimenta
/// (decisao 1 da secao 13: "a fila copia a fase, nao referencia").
///
/// A copia nasceu antes do resto da secao 6, porque o POST /rooms com "setId" precisava dela
/// primeiro — o contrato pede que a sala ja nasca com as fases do conjunto enfileiradas.
/// <c>POST /rooms/{code}/queue/sets</c> chama esse mesmo <see cref="AppendSetAsync"/>: a regra de
/// cor e de limite e uma so, senao a sala criada com conjunto e a sala que recebeu o conjunto
/// depois divergiriam.
///
/// <b>A forma de toda mutacao daqui e a mesma</b>, e vale a pena ler uma vez: resolve a sala como
/// lider → exige lobby → muta → <see cref="SaveAndPublishAsync"/> (que grava, incrementa a revisao
/// e publica <c>queue.updated</c>) → devolve <see cref="GetQueueAsync(Guid,CancellationToken)"/>.
/// A fila inteira de volta nao e REST "puro" por design: "todas as mutacoes desta secao devolvem a
/// fila inteira recalculada", para nao haver um refetch por clique e porque cor e indice sao
/// decididos no servidor.
/// </summary>
public class RoomQueueService(AppDbContext db, RoomAccessService roomAccess, IRealtimeEventPublisher realtime)
{
    /// <summary>
    /// "color e atribuida pelo servidor a partir de uma paleta fixa de 8 tons, sem repetir
    /// dentro da mesma sala" (secao 6). Sao tokens que existem de fato em
    /// nextjs/src/styles/tokens/colors.css — o front so repassa a string, entao um token
    /// inventado aqui viraria uma cor vazia la.
    /// </summary>
    public static readonly IReadOnlyList<string> Palette =
    [
        "var(--blue-500)",
        "var(--pink-500)",
        "var(--amber-500)",
        "var(--green-500)",
        "var(--violet-500)",
        "var(--blue-700)",
        "var(--red-500)",
        "var(--green-600)",
    ];

    /// <summary>"Maximo de 8 conjuntos por sala (409 TOO_MANY_SETS)" (secao 6) — o mesmo numero de cores da paleta, e nao por coincidencia.</summary>
    public const int MaxSetsPerRoom = 8;

    /// <summary>
    /// GET /rooms/{code}/queue (secao 6).
    ///
    /// Rota de lider: a fila e o roteiro da aula, com os nomes das fases que ainda nao foram
    /// jogadas. Um participante que a lesse saberia o que vem pela frente — e a tabela de acesso
    /// da secao 14 lista "todas as de /queue/*" so no lobby do lider. Nao-lider leva
    /// NOT_ROOM_LEADER; codigo que nao resolve leva ROOM_NOT_FOUND, os dois vindos do
    /// RoomAccessService.
    ///
    /// Fila vazia e resposta valida (duas listas vazias, 200), nao 404: sala recem-criada sem
    /// "setId" esta exatamente nesse estado, e o lobby precisa abrir para o lider poder
    /// adicionar o primeiro conjunto.
    /// </summary>
    public async Task<RoomQueueResponse> GetQueueAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);
        return await GetQueueAsync(room.Id, ct);
    }

    /// <summary>
    /// A fila montada a partir do id da sala, sem checar autorizacao — para quem ja resolveu a
    /// sala. E o retorno de "todas as mutacoes desta secao devolvem a fila inteira recalculada"
    /// (secao 6): elas ja terao a sala em maos quando chegarem aqui.
    /// </summary>
    public async Task<RoomQueueResponse> GetQueueAsync(Guid roomId, CancellationToken ct)
    {
        // Ordenado por OrderIndex, nao por Id: a fila e reordenavel por arrastar-e-soltar
        // (PUT /queue/order), entao a ordem de insercao deixa de valer no primeiro arrasto.
        var phases = await db.RoomQueuePhases
            .AsNoTracking()
            .Where(p => p.RoomId == roomId)
            .OrderBy(p => p.OrderIndex)
            .Select(p => new RoomQueuePhaseDto(
                p.Id,
                p.RoomQueueSetId,
                p.Name,
                p.Kind,
                p.BasePoints,
                p.PointsMultiplier,
                p.TimeSeconds))
            .ToListAsync(ct);

        // phaseCount sai da lista que ja foi carregada, em vez de uma subconsulta por conjunto:
        // e o mesmo numero, e assim nao ha como as duas leituras discordarem entre si.
        var phaseCounts = phases
            .GroupBy(p => p.SetId)
            .ToDictionary(group => group.Key, group => group.Count());

        var sets = await db.RoomQueueSets
            .AsNoTracking()
            .Where(s => s.RoomId == roomId)
            .OrderBy(s => s.OrderIndex)
            .Select(s => new { s.Id, s.Title, s.Color })
            .ToListAsync(ct);

        return new RoomQueueResponse(
            [.. sets.Select(s => new RoomQueueSetDto(s.Id, s.Title, s.Color, phaseCounts.GetValueOrDefault(s.Id)))],
            phases);
    }

    /// <summary>
    /// Acrescenta todas as fases do conjunto ao fim da fila da sala.
    ///
    /// Nao chama SaveChanges: quem chama decide o momento. No POST /rooms isso importa — a sala e
    /// a fila entram na mesma transacao, entao nao existe o estado intermediario "sala criada com
    /// fila vazia" se a copia falhar.
    /// </summary>
    public async Task<RoomQueueSet> AppendSetAsync(Guid roomId, PhaseSet phaseSet, CancellationToken ct)
    {
        var existingColors = await db.RoomQueueSets
            .Where(s => s.RoomId == roomId)
            .Select(s => s.Color)
            .ToListAsync(ct);

        if (existingColors.Count >= MaxSetsPerRoom)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.TooManySets, $"Uma sala aceita no maximo {MaxSetsPerRoom} conjuntos na fila.");
        }

        // A paleta tem exatamente MaxSetsPerRoom cores e a checagem acima ja garantiu que sobra
        // pelo menos uma, mas o fallback existe para o dia em que alguem mexer num dos dois
        // numeros sem olhar o outro.
        var color = Palette.FirstOrDefault(c => !existingColors.Contains(c))
                    ?? Palette[existingColors.Count % Palette.Count];

        var nextSetOrder = existingColors.Count;
        var nextPhaseOrder = await db.RoomQueuePhases.CountAsync(p => p.RoomId == roomId, ct);

        var queueSet = new RoomQueueSet
        {
            RoomId = roomId,
            SourcePhaseSetId = phaseSet.Id,
            Title = phaseSet.Title,
            Color = color,
            OrderIndex = nextSetOrder,
        };
        db.RoomQueueSets.Add(queueSet);

        var phases = await db.Phases
            .AsNoTracking()
            .Where(p => p.PhaseSetId == phaseSet.Id)
            .OrderBy(p => p.OrderIndex)
            .ToListAsync(ct);

        foreach (var phase in phases)
        {
            db.RoomQueuePhases.Add(new RoomQueuePhase
            {
                RoomId = roomId,
                RoomQueueSetId = queueSet.Id,
                SourcePhaseId = phase.Id,
                Kind = phase.Kind,
                Name = phase.Name,
                BasePoints = phase.BasePoints,
                PointsMultiplier = phase.PointsMultiplier,
                TimeSeconds = phase.TimeSeconds,
                // A copia e literal, incluindo o gabarito: editar o conjunto original depois nao
                // pode mudar uma partida em andamento debaixo dos alunos.
                ContentJson = phase.ContentJson,
                OrderIndex = nextPhaseOrder++,
            });
        }

        return queueSet;
    }

    /// <summary>
    /// POST /rooms/{code}/queue/sets — "acrescenta todas as fases do conjunto ao fim da fila".
    ///
    /// Que conjunto o lider pode enfileirar e a mesma regra do <c>setId</c> do POST /rooms: o dele,
    /// ou um publicado na comunidade. Nao e a regra do editor (que so aceita o proprio, porque la
    /// se ve gabarito): jogar o conjunto de outra pessoa numa sala e o caso de uso central da aba
    /// "Comunidade" do seletor.
    ///
    /// <b>O mesmo conjunto pode entrar duas vezes.</b> Nao ha checagem de duplicata, porque
    /// <c>setId</c> na resposta e o id da <i>linha da fila</i> — duas linhas distintas, com cores
    /// distintas, e cada uma removivel sozinha. Uma sala que repete um conjunto para uma segunda
    /// rodada e um uso legitimo; o teto de 8 continua valendo.
    /// </summary>
    public async Task<RoomQueueResponse> AddSetAsync(string code, AddQueueSetRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);
        var userId = principal.GetUserId();

        if (!Guid.TryParse(request.SetId, out var setId))
        {
            throw PhaseSetNotFound();
        }

        var phaseSet = await db.PhaseSets
                           .FirstOrDefaultAsync(
                               s => s.Id == setId && (s.OwnerId == userId || s.Visibility == PhaseSetVisibility.Community), ct)
                       ?? throw PhaseSetNotFound();

        await AppendSetAsync(room.Id, phaseSet, ct);

        return await SaveAndPublishAsync(room, ct);
    }

    /// <summary>
    /// DELETE /rooms/{code}/queue/sets/{setId} — "remove o conjunto e todas as fases dele".
    ///
    /// A cascata e do banco (<c>RoomQueuePhaseConfiguration</c>), mas as fases sao removidas aqui
    /// explicitamente: o EF InMemory dos testes nao aplica cascata, e mais importante, a renumeracao
    /// logo abaixo precisa enxergar a fila ja sem elas.
    /// </summary>
    public async Task<RoomQueueResponse> RemoveSetAsync(string code, string setId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);
        var queueSet = await FindSetAsync(room.Id, setId, ct);

        db.RoomQueuePhases.RemoveRange(await db.RoomQueuePhases.Where(p => p.RoomQueueSetId == queueSet.Id).ToListAsync(ct));
        db.RoomQueueSets.Remove(queueSet);

        await ResequenceAsync(room.Id, ct);

        return await SaveAndPublishAsync(room, ct);
    }

    /// <summary>
    /// PATCH /rooms/{code}/queue/sets/{setId} — "aplica os tres valores a todas as fases daquele
    /// conjunto de uma vez".
    ///
    /// E atalho de edicao em massa, nao um padrao guardado no conjunto: fase adicionada depois
    /// (outro conjunto, ou este mesmo enfileirado de novo) nao herda nada daqui. Guardar o valor na
    /// linha do conjunto criaria uma segunda verdade sobre os pontos de uma fase, e a fila ja tem a
    /// dela — que e a que a partida executa.
    /// </summary>
    public async Task<RoomQueueResponse> UpdateSetAsync(
        string code,
        string setId,
        UpdateQueueSetRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);
        var queueSet = await FindSetAsync(room.Id, setId, ct);

        var basePoints = ValidateBasePoints(request.BasePoints);
        var multiplier = ValidateMultiplier(request.PointsMultiplier);
        var timeSeconds = ValidateTimeSeconds(request.TimeSeconds);

        var phases = await db.RoomQueuePhases.Where(p => p.RoomQueueSetId == queueSet.Id).ToListAsync(ct);

        foreach (var phase in phases)
        {
            phase.BasePoints = basePoints ?? phase.BasePoints;
            phase.PointsMultiplier = multiplier ?? phase.PointsMultiplier;
            phase.TimeSeconds = timeSeconds ?? phase.TimeSeconds;
        }

        return await SaveAndPublishAsync(room, ct);
    }

    /// <summary>
    /// PATCH /rooms/{code}/queue/phases/{phaseId} — "todos os campos sao opcionais".
    ///
    /// Escreve na <b>copia</b> da fase que vive na fila desta sala. O conjunto de origem nao e
    /// tocado: e a mesma razao de a copia existir (editar o conjunto depois nao pode mudar uma
    /// partida em andamento), lida no outro sentido — ajustar a fase para esta turma nao pode
    /// reescrever a biblioteca do autor, nem a fila de outra sala que enfileirou o mesmo conjunto.
    /// </summary>
    public async Task<RoomQueueResponse> UpdatePhaseAsync(
        string code,
        string phaseId,
        UpdateQueuePhaseRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);
        var phase = await FindPhaseAsync(room.Id, phaseId, tracked: true, ct);

        var basePoints = ValidateBasePoints(request.BasePoints);
        var multiplier = ValidateMultiplier(request.PointsMultiplier);
        var timeSeconds = ValidateTimeSeconds(request.TimeSeconds);

        if (request.Name is { } rawName)
        {
            var name = rawName.Trim();
            if (name.Length is 0 || name.Length > PhaseLimits.MaxNameLength)
            {
                throw Validation($"name deve ter entre 1 e {PhaseLimits.MaxNameLength} caracteres.");
            }

            phase.Name = name;
        }

        phase.BasePoints = basePoints ?? phase.BasePoints;
        phase.PointsMultiplier = multiplier ?? phase.PointsMultiplier;
        phase.TimeSeconds = timeSeconds ?? phase.TimeSeconds;

        if (request.ExpectedAnswer is { } expectedAnswer)
        {
            if (phase.Kind is not (PhaseKind.Text or PhaseKind.Code))
            {
                throw Validation("expectedAnswer so vale para fases text e code.");
            }

            // Reserializa o conteudo inteiro a partir do que estava gravado, em vez de remendar a
            // string: o ContentJson e a forma de autoria completa da fase (PhaseContent), e um
            // patch textual perderia os campos do kind na primeira mudanca de formato.
            phase.ContentJson = (PhaseContent.Parse(phase.ContentJson) with { ExpectedAnswer = expectedAnswer }).ToJson();
        }

        return await SaveAndPublishAsync(room, ct);
    }

    /// <summary>
    /// DELETE /rooms/{code}/queue/phases/{phaseId}.
    ///
    /// <b>Tirar a ultima fase de um conjunto tira o conjunto tambem.</b> O contrato nao diz, mas a
    /// linha vazia que sobraria nao e neutra: ela ocupa uma das 8 vagas e uma das 8 cores, e o
    /// painel a mostraria como "0 fases" sem nada a fazer com ela. Sumir descreve o que de fato
    /// aconteceu — nao ha mais nada daquele conjunto na fila — e o lider pode adiciona-lo de novo.
    /// </summary>
    public async Task<RoomQueueResponse> RemovePhaseAsync(string code, string phaseId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);
        var phase = await FindPhaseAsync(room.Id, phaseId, tracked: true, ct);

        db.RoomQueuePhases.Remove(phase);

        var siblings = await db.RoomQueuePhases
            .CountAsync(p => p.RoomQueueSetId == phase.RoomQueueSetId && p.Id != phase.Id, ct);

        if (siblings is 0)
        {
            db.RoomQueueSets.Remove(await db.RoomQueueSets.FirstAsync(s => s.Id == phase.RoomQueueSetId, ct));
        }

        await ResequenceAsync(room.Id, ct);

        return await SaveAndPublishAsync(room, ct);
    }

    /// <summary>
    /// PUT /rooms/{code}/queue/order — arrastar-e-soltar.
    ///
    /// "A lista precisa conter <b>exatamente</b> os ids atuais da fila (409 QUEUE_MISMATCH se
    /// divergir — protege contra dois navegadores reordenando ao mesmo tempo)."
    ///
    /// A comparacao e pelo conjunto de ids, e nao por um numero de revisao, porque e o que o
    /// contrato descreve e porque e o teste que de fato protege o dado: se o outro navegador
    /// adicionou, removeu ou trocou de conjunto, os ids nao batem e a reordenacao para. O caso que
    /// escapa e o de duas reordenacoes simultaneas sobre a mesma fila — a ultima vence, e o
    /// resultado e uma ordem que alguem escolheu, nao um embaralhamento. Trocar isso por revisao no
    /// corpo seria mudanca de contrato na rota (ver api-queue-log.md §3).
    /// </summary>
    public async Task<RoomQueueResponse> ReorderAsync(
        string code,
        ReorderQueueRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var room = await GetEditableRoomAsync(code, principal, ct);

        var phases = await db.RoomQueuePhases
            .Where(p => p.RoomId == room.Id)
            .OrderBy(p => p.OrderIndex)
            .ToListAsync(ct);

        var requested = request.PhaseIds ?? [];

        // Ordem preservada (e nao um HashSet direto) para detectar id repetido: ["a","a"] tem os
        // mesmos elementos distintos que ["a"], e sem contar daria "bateu" para uma lista que nao
        // descreve fila nenhuma.
        var requestedIds = requested
            .Select(id => Guid.TryParse(id, out var parsed) ? parsed : (Guid?)null)
            .ToList();

        if (requestedIds.Count != phases.Count
            || requestedIds.Any(id => id is null)
            || !requestedIds.Select(id => id!.Value).ToHashSet().SetEquals(phases.Select(p => p.Id)))
        {
            throw new ApiException(
                StatusCodes.Status409Conflict,
                ErrorCodes.QueueMismatch,
                "A fila mudou desde que esta tela foi carregada.");
        }

        var byId = phases.ToDictionary(p => p.Id);
        for (var index = 0; index < requestedIds.Count; index++)
        {
            byId[requestedIds[index]!.Value].OrderIndex = index;
        }

        return await SaveAndPublishAsync(room, ct);
    }

    /// <summary>
    /// GET /rooms/{code}/queue/phases/{phaseId} — o modal "Ver desafio".
    ///
    /// A unica rota da secao 6 que devolve gabarito, e por isso a unica que precisa da conversao
    /// <see cref="PhaseProjection"/>: o payload da fila e so nome, tipo e os tres numeros. Rota de
    /// lider como todas as de <c>/queue/*</c>, e <c>includeAnswers: true</c> por consequencia —
    /// "so o lider pode chamar".
    /// </summary>
    public async Task<PhaseDto> GetPhaseDetailAsync(string code, string phaseId, ClaimsPrincipal principal, CancellationToken ct)
    {
        // Sem EnsureEditable: ler o desafio nao muda nada, e continuar podendo conferir a fase
        // depois que a partida comecou e o proprio ponto de haver uma previa do lider.
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);
        var phase = await FindPhaseAsync(room.Id, phaseId, tracked: false, ct);

        return PhaseProjection.ToPhase(phase, includeAnswers: true);
    }

    /// <summary>
    /// A sala, se quem chamou for o lider <b>e</b> ela ainda estiver no lobby.
    ///
    /// O contrato nao fala em travar a fila durante a partida — a secao 7 nem existe ainda —, mas a
    /// secao 14 lista "todas as de /queue/*" so no lobby do lider, e reordenar a fila embaixo de uma
    /// partida em andamento moveria a fase corrente por baixo dos alunos. Como nada hoje tira a sala
    /// de <c>lobby</c>, esta guarda nao muda nenhum comportamento existente: ela esta aqui para a
    /// secao 7 encostar sem precisar lembrar de escreve-la.
    /// </summary>
    private async Task<Room> GetEditableRoomAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);

        if (room.Status is not RoomStatus.Lobby)
        {
            throw new ApiException(
                StatusCodes.Status409Conflict,
                ErrorCodes.MatchAlreadyStarted,
                "A fila so pode ser alterada antes de a partida comecar.");
        }

        return room;
    }

    /// <summary>
    /// Grava, incrementa a revisao e publica <c>queue.updated</c> — nessa ordem, porque publicar
    /// antes do SaveChanges entregaria ao cliente um estado que ainda pode sumir.
    ///
    /// O evento vai para o canal da sala (websocket-contract.md §5 lista <c>queue.updated</c> em
    /// "Lobby — canal room:{code}") e leva <b>so a revisao</b>: "a fila so interessa ao lider, e ele
    /// e quem acabou de muda-la; mandar a fila inteira para 28 alunos que nao a enxergam seria
    /// desperdicio puro". O que o lider ganha com isso e a segunda aba dele — a que nao clicou —
    /// sabendo que precisa refazer o GET.
    /// </summary>
    private async Task<RoomQueueResponse> SaveAndPublishAsync(Room room, CancellationToken ct)
    {
        room.QueueRevision++;
        await db.SaveChangesAsync(ct);

        await realtime.PublishAsync(
            room.Code,
            RealtimeChannels.Room(room.Code),
            new QueueUpdatedEvent(room.QueueRevision),
            ct);

        return await GetQueueAsync(room.Id, ct);
    }

    /// <summary>
    /// Reescreve <c>OrderIndex</c> de fases e conjuntos como 0..n-1, preservando a ordem relativa.
    ///
    /// Roda depois de toda remocao porque <see cref="AppendSetAsync"/> calcula a proxima posicao
    /// <i>contando</i> as linhas existentes. Sem isto, apagar a fase do meio e adicionar um conjunto
    /// novo daria a ele uma posicao ja ocupada, e a fila passaria a ter duas fases empatadas com uma
    /// ordem que so o banco decide.
    /// </summary>
    private async Task ResequenceAsync(Guid roomId, CancellationToken ct)
    {
        var phases = await db.RoomQueuePhases
            .Where(p => p.RoomId == roomId)
            .OrderBy(p => p.OrderIndex)
            .ToListAsync(ct);

        var order = 0;
        foreach (var phase in phases.Where(p => db.Entry(p).State is not EntityState.Deleted))
        {
            phase.OrderIndex = order++;
        }

        var sets = await db.RoomQueueSets
            .Where(s => s.RoomId == roomId)
            .OrderBy(s => s.OrderIndex)
            .ToListAsync(ct);

        order = 0;
        foreach (var set in sets.Where(s => db.Entry(s).State is not EntityState.Deleted))
        {
            set.OrderIndex = order++;
        }
    }

    private async Task<RoomQueueSet> FindSetAsync(Guid roomId, string setId, CancellationToken ct)
    {
        // Id malformado e 404, e nao 400: para quem esta olhando, um id que nao resolve e um
        // conjunto que nao esta nesta fila. Mesmo criterio da secao 5.
        if (!Guid.TryParse(setId, out var id))
        {
            throw PhaseSetNotFound();
        }

        return await db.RoomQueueSets.FirstOrDefaultAsync(s => s.Id == id && s.RoomId == roomId, ct)
               ?? throw PhaseSetNotFound();
    }

    private async Task<RoomQueuePhase> FindPhaseAsync(Guid roomId, string phaseId, bool tracked, CancellationToken ct)
    {
        if (!Guid.TryParse(phaseId, out var id))
        {
            throw PhaseNotFound();
        }

        var query = tracked ? db.RoomQueuePhases : db.RoomQueuePhases.AsNoTracking();

        // Filtrado por RoomId, e nao so pelo id: o id da fase da fila e global, entao sem isto o
        // lider de uma sala leria (e editaria) a fase da fila de outra.
        return await query.FirstOrDefaultAsync(p => p.Id == id && p.RoomId == roomId, ct)
               ?? throw PhaseNotFound();
    }

    private static int? ValidateBasePoints(int? basePoints)
        => basePoints is null || basePoints is >= 0 and <= PhaseLimits.MaxBasePoints
            ? basePoints
            : throw Validation($"basePoints deve estar entre 0 e {PhaseLimits.MaxBasePoints}.");

    private static int? ValidateTimeSeconds(int? timeSeconds)
        => timeSeconds is null || timeSeconds is >= PhaseLimits.MinTimeSeconds and <= PhaseLimits.MaxTimeSeconds
            ? timeSeconds
            : throw Validation($"timeSeconds deve estar entre {PhaseLimits.MinTimeSeconds} e {PhaseLimits.MaxTimeSeconds}.");

    private static decimal? ValidateMultiplier(decimal? multiplier)
        => multiplier is null
            ? null
            : multiplier >= PhaseLimits.MinPointsMultiplier && multiplier <= PhaseLimits.MaxPointsMultiplier
                ? PhaseLimits.RoundMultiplier(multiplier.Value)
                : throw Validation($"pointsMultiplier deve estar entre {PhaseLimits.MinPointsMultiplier} e {PhaseLimits.MaxPointsMultiplier}.");

    private static ApiException PhaseSetNotFound()
        => new(StatusCodes.Status404NotFound, ErrorCodes.PhaseSetNotFound, "Conjunto de fases nao encontrado nesta fila.");

    private static ApiException PhaseNotFound()
        => new(StatusCodes.Status404NotFound, ErrorCodes.PhaseNotFound, "Fase nao encontrada nesta fila.");

    private static ApiException Validation(string message)
        => new(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, message);
}
