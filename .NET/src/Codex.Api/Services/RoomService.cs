using System.Security.Claims;
using System.Security.Cryptography;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// api-rest.md secao 3 (GET /rooms/{code}/availability) e secao 4 (POST /rooms, GET/PATCH
/// /rooms/{code}). As regras de "da pra entrar nesta sala?" vivem aqui porque sao consultadas
/// duas vezes: no availability e de novo no POST de participante — o passo 1 e conveniencia de
/// UX, nao autorizacao, entao o passo 2 nao pode confiar que ele rodou.
/// </summary>
public class RoomService(AppDbContext db, RoomAccessService roomAccess, RoomQueueService queue)
{
    /// <summary>Limite superior de capacity aceito no PATCH. Nao vem do doc: e sanidade contra digitacao/abuso.</summary>
    private const int MaxCapacity = 500;

    /// <summary>
    /// Capacidade com que a sala nasce. O contrato nao define — 20 e o valor dos exemplos da
    /// secao 3 e 4, e o lider ajusta pelo PATCH sem sair do lobby.
    /// </summary>
    private const int DefaultCapacity = 20;

    /// <summary>
    /// Quantas vezes tentar um codigo livre antes de desistir. Com 10^6 codigos e a ordem de
    /// grandeza de salas simultaneas que este produto tem, a chance de 8 colisoes seguidas e
    /// desprezivel; o limite existe para o loop nao virar infinito no dia em que o espaco encher.
    /// </summary>
    private const int CodeGenerationAttempts = 8;

    /// <summary>
    /// POST /rooms (secao 4): abre uma sala nova com quem chamou como lider.
    ///
    /// Exige conta. O contrato nao diz o que responder a um convidado que tente criar sala, mas
    /// "leader" e um <c>userId</c> em todo o resto do documento (RoomLeaderDto, "rotas de lider
    /// exigem que o userId seja o dono da sala") — sem conta nao ha o que gravar ali.
    /// ACCOUNT_REQUIRED e o code certo porque o dialogo dele ("Conta necessaria") descreve
    /// exatamente o que falta.
    /// </summary>
    public async Task<RoomDto> CreateAsync(CreateRoomRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = principal.GetUserId() ?? throw AccountRequired();
        var leader = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw AccountRequired();

        // Resolve o conjunto antes de gravar qualquer coisa: um setId invalido nao pode deixar
        // uma sala orfa para tras.
        PhaseSet? phaseSet = null;
        if (request.SetId is { } setId)
        {
            phaseSet = await db.PhaseSets
                           .FirstOrDefaultAsync(
                               s => s.Id == setId && (s.OwnerId == userId || s.Visibility == PhaseSetVisibility.Community), ct)
                       ?? throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.PhaseSetNotFound, "Conjunto de fases nao encontrado.");
        }

        var room = new Room
        {
            Code = await GenerateCodeAsync(ct),
            Capacity = DefaultCapacity,
            LeaderUserId = userId,
            Leader = leader,
        };
        db.Rooms.Add(room);

        if (phaseSet is not null)
        {
            await queue.AppendSetAsync(room.Id, phaseSet, ct);
        }

        // Um unico SaveChanges: sala e fila entram juntas ou nao entram. E o que sustenta a
        // promessa do contrato de que "o lobby nao abre vazio".
        await db.SaveChangesAsync(ct);

        // Room.ExpiresAt continua sem ser preenchido (ver next-steps.md): o contrato sugere TTL a
        // partir do fim da partida, nao da criacao, e definir isso aqui encurtaria a vida de uma
        // sala que ainda nem comecou.
        return ToDto(room);
    }

    /// <summary>
    /// Codigo de 6 digitos livre entre as salas <b>ativas</b> — nao globalmente unico: a secao 13
    /// e explicita que codigos sao reciclados quando a sala expira, e o indice de rooms.Code nem
    /// e unico por causa disso.
    ///
    /// Aleatorio criptografico, e nao sequencial nem derivado do relogio: o codigo e a unica
    /// credencial da sala (ver api-lobby.md secao 2), entao adivinhar o proximo teria que ser
    /// tao dificil quanto adivinhar um qualquer.
    ///
    /// <b>Limitacao conhecida:</b> entre o SELECT e o INSERT cabe outra sala nascendo com o mesmo
    /// codigo. Uma constraint nao resolveria — a unicidade e sobre "sala ativa", e o predicado
    /// (ExpiresAt > agora) nao e imutavel, entao Postgres nao aceita indice parcial com ele. Com
    /// 10^6 codigos a janela e pequena o bastante para nao valer uma tabela de reserva; se um dia
    /// valer, o lugar de consertar e aqui.
    /// </summary>
    private async Task<string> GenerateCodeAsync(CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;

        for (var attempt = 0; attempt < CodeGenerationAttempts; attempt++)
        {
            var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

            var taken = await db.Rooms.AnyAsync(r => r.Code == code && (r.ExpiresAt == null || r.ExpiresAt > now), ct);
            if (!taken)
            {
                return code;
            }
        }

        // Cai no 500 generico do ApiExceptionHandler, que e o correto: nao ha nada que o usuario
        // possa fazer, e o log precisa gritar que o espaco de codigos encheu.
        throw new InvalidOperationException($"Nao foi possivel gerar um codigo de sala livre em {CodeGenerationAttempts} tentativas.");
    }

    private static ApiException AccountRequired()
        => new(StatusCodes.Status403Forbidden, ErrorCodes.AccountRequired, "E preciso ter uma conta para criar uma sala.");

    public async Task<RoomAvailabilityResponse> GetAvailabilityAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetActiveRoomAsync(code, ct);
        await EnsureJoinableAsync(room, principal, ct);

        return new RoomAvailabilityResponse(room.Code, room.Capacity, room.RequireAccount);
    }

    public async Task<RoomDto> GetRoomAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsMemberAsync(code, principal, ct);
        return ToDto(room);
    }

    public async Task<RoomDto> UpdateAsync(string code, UpdateRoomRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await roomAccess.GetRoomAsLeaderAsync(code, principal, ct);

        if (request.Capacity is { } capacity)
        {
            if (capacity is < 1 or > MaxCapacity)
            {
                throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, $"capacity deve estar entre 1 e {MaxCapacity}.");
            }

            // Diminuir a capacidade abaixo de quem ja esta na sala e permitido: so fecha a
            // porta para novos (ROOM_FULL). Expulsar gente para caber no numero novo seria
            // destrutivo e nao esta em lugar nenhum do contrato.
            room.Capacity = capacity;
        }

        if (request.Locked is { } locked)
        {
            room.Locked = locked;
        }

        if (request.RequireAccount is { } requireAccount)
        {
            room.RequireAccount = requireAccount;
        }

        await db.SaveChangesAsync(ct);

        // TODO(realtime): publicar "room.settings" (secao 4). O canal WebSocket mora no projeto
        // Node separado e o mecanismo de notificacao ainda nao foi decidido — ver api-lobby.md.
        return ToDto(room);
    }

    /// <summary>
    /// Os quatro erros que o availability lista, na ordem em que fazem sentido: existir, estar
    /// aberta, aceitar quem nao tem conta, ter vaga.
    /// </summary>
    public async Task EnsureJoinableAsync(Room room, ClaimsPrincipal principal, CancellationToken ct)
    {
        // Sala ja encerrada nao aceita mais ninguem. Reusa ROOM_LOCKED porque o dialogo "Sala
        // fechada" descreve exatamente essa situacao e o contrato nao tem um code proprio para
        // "partida acabou". Sala em andamento (running) continua aceitando: entrar no meio e
        // legitimo, e o lider desliga isso com "locked".
        if (room.Locked || room.Status is RoomStatus.Finished)
        {
            throw new ApiException(StatusCodes.Status423Locked, ErrorCodes.RoomLocked, "O apresentador travou a entrada.");
        }

        // "So e retornado quando a sala exige conta E quem chamou nao esta autenticado" — por
        // isso esta rota le o Authorization (secao 3).
        if (room.RequireAccount && principal.GetUserId() is null)
        {
            throw new ApiException(StatusCodes.Status403Forbidden, ErrorCodes.AccountRequired, "Esta sala exige uma conta para entrar.");
        }

        if (await CountOccupancyAsync(room.Id, ct) >= room.Capacity)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.RoomFull, "A sala atingiu a capacidade maxima.");
        }
    }

    /// <summary>
    /// Vaga ocupada = participante nao recusado. Pendente conta: ele ja esta na fila de
    /// aprovacao do lider e vira "approved" com um clique, entao ignora-lo deixaria a sala
    /// estourar a capacidade no momento em que o lider aprovasse todo mundo.
    /// </summary>
    public Task<int> CountOccupancyAsync(Guid roomId, CancellationToken ct)
        => db.Participants.CountAsync(p => p.RoomId == roomId && p.Status != ParticipantStatus.Rejected, ct);

    public static RoomDto ToDto(Room room) => new(
        room.Id,
        room.Code,
        room.Status,
        room.MatchMode,
        room.Capacity,
        room.Locked,
        room.RequireAccount,
        new RoomLeaderDto(room.LeaderUserId, room.Leader.Name),
        room.CreatedAt);
}
