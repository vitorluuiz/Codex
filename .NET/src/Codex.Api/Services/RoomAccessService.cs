using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// Resolucao de sala por codigo + as tres perguntas de autorizacao que as secoes 3-4 do
/// api-rest.md fazem o tempo todo: "existe?", "quem chamou e o lider?" e "quem chamou esta
/// nesta sala?".
///
/// api-init.md previa isso como um filtro de endpoint. Virou um servico porque o filtro
/// precisaria carregar a sala para decidir e o handler precisa da mesma sala logo em seguida —
/// seriam duas consultas pelo mesmo registro em toda rota de lider. Aqui a checagem devolve a
/// entidade que ja foi carregada.
/// </summary>
public class RoomAccessService(AppDbContext db)
{
    /// <summary>
    /// Sala ativa com aquele codigo. Codigos sao reciclados quando a sala expira (secao 13),
    /// entao "o codigo 482913" pode existir varias vezes na tabela: vale a mais recente que
    /// ainda nao expirou. Codigo fora do formato nem chega ao banco — e 404 igual, para nao
    /// dar ao atacante um sinal diferente entre "malformado" e "nao existe".
    /// </summary>
    public async Task<Room> GetActiveRoomAsync(string code, CancellationToken ct)
    {
        var normalized = code?.Trim() ?? string.Empty;
        if (normalized.Length is not 6 || !normalized.All(char.IsAsciiDigit))
        {
            throw RoomNotFound();
        }

        var now = DateTimeOffset.UtcNow;
        var room = await db.Rooms
            .Include(r => r.Leader)
            .Where(r => r.Code == normalized && (r.ExpiresAt == null || r.ExpiresAt > now))
            .OrderByDescending(r => r.CreatedAt)
            .FirstOrDefaultAsync(ct);

        return room ?? throw RoomNotFound();
    }

    /// <summary>
    /// Rotas de lider (PATCH /rooms/{code}, aprovar/recusar/remover, ?status=pending).
    /// "Rotas de lider exigem que o userId seja o dono da sala" (secao 1) — um token de
    /// participante nunca passa aqui, mesmo que o participante esteja logado.
    /// </summary>
    public async Task<Room> GetRoomAsLeaderAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await GetActiveRoomAsync(code, ct);
        EnsureLeader(room, principal);
        return room;
    }

    public static void EnsureLeader(Room room, ClaimsPrincipal principal)
    {
        if (principal.GetUserId() != room.LeaderUserId)
        {
            throw new ApiException(StatusCodes.Status403Forbidden, ErrorCodes.NotRoomLeader, "Esta acao e restrita ao apresentador da sala.");
        }
    }

    /// <summary>
    /// GET /rooms/{code}: o doc diz "nunca confie no front para esconder dado de lider", e o
    /// mesmo raciocinio vale para a sala inteira — o codigo de 6 digitos e a unica credencial
    /// da sala, entao quem nao entrou (nem e o lider) nao le a sala. Responde ROOM_NOT_FOUND e
    /// nao 403 de proposito: nao confirma para um estranho que o codigo existe, e a UI ja tem
    /// dialogo para esse code.
    /// </summary>
    public async Task<Room> GetRoomAsMemberAsync(string code, ClaimsPrincipal principal, CancellationToken ct)
    {
        var room = await GetActiveRoomAsync(code, ct);

        if (principal.GetUserId() == room.LeaderUserId)
        {
            return room;
        }

        if (principal.GetParticipantId() is { } participantId)
        {
            // Pendente tambem le a sala: e dela que sai o nome do lider na tela
            // "Aguardando ... iniciar a partida" enquanto o aluno espera aprovacao.
            var isMember = await db.Participants.AnyAsync(
                p => p.Id == participantId && p.RoomId == room.Id && p.Status != ParticipantStatus.Rejected, ct);

            if (isMember)
            {
                return room;
            }
        }

        throw RoomNotFound();
    }

    private static ApiException RoomNotFound()
        => new(StatusCodes.Status404NotFound, ErrorCodes.RoomNotFound, "Sala nao encontrada.");
}
