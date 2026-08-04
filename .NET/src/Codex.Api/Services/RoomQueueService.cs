using System.Security.Claims;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Data;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// A fila de fases da sala (api-rest.md secao 6) e a copia PhaseSet -> fila que a alimenta
/// (decisao 1 da secao 13: "a fila copia a fase, nao referencia").
///
/// A copia nasceu antes do resto da secao 6, porque o POST /rooms com "setId" precisava dela
/// primeiro — o contrato pede que a sala ja nasca com as fases do conjunto enfileiradas. Quando
/// POST /rooms/{code}/queue/sets for escrito, ele chama este mesmo metodo: a regra de cor e de
/// limite tem que ser uma so, senao a sala criada com conjunto e a sala que recebeu o conjunto
/// depois divergem.
/// </summary>
public class RoomQueueService(AppDbContext db, RoomAccessService roomAccess)
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
}
