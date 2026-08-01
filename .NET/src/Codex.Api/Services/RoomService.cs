using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Rooms;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// api-rest.md secao 3 (GET /rooms/{code}/availability) e secao 4 (GET/PATCH /rooms/{code}).
/// As regras de "da pra entrar nesta sala?" vivem aqui porque sao consultadas duas vezes: no
/// availability e de novo no POST de participante — o passo 1 e conveniencia de UX, nao
/// autorizacao, entao o passo 2 nao pode confiar que ele rodou.
/// </summary>
public class RoomService(AppDbContext db, RoomAccessService roomAccess)
{
    /// <summary>Limite superior de capacity aceito no PATCH. Nao vem do doc: e sanidade contra digitacao/abuso.</summary>
    private const int MaxCapacity = 500;

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
