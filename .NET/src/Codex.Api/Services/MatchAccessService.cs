using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// O <see cref="RoomAccessService"/> das rotas de partida.
///
/// Servico irmao, e nao um metodo a mais la, porque a <b>chave de entrada e outra</b>: as secoes
/// 8-10 sao todas <c>/matches/{matchId}/…</c>, enquanto tudo do lobby e <c>/rooms/{code}/…</c>. Um
/// servico com duas chaves teria dois caminhos de resolucao e uma tabela de autorizacao dobrada.
///
/// As tres perguntas sao as mesmas de sempre ("existe?", "e o lider?", "esta nesta sala?"), mais
/// uma que so a partida faz: <see cref="GetPlayerAsync"/> — "quem chamou <i>joga</i> esta partida?".
/// O lider nao joga.
/// </summary>
public class MatchAccessService(AppDbContext db)
{
    /// <summary>
    /// A partida, se quem chamou for o lider da sala <b>ou</b> alguem que esta nela.
    ///
    /// Id malformado, inexistente e "de uma sala que nao e sua" respondem todos
    /// <c>404 MATCH_NOT_FOUND</c>. Nao ha 403 aqui de proposito, pelo mesmo motivo do
    /// <c>GET /rooms/{code}</c>: a partida nao e mais publica que a sala que a contem, e responder
    /// 403 confirmaria a um estranho que aquele id existe.
    /// </summary>
    public async Task<Match> GetMatchAsMemberAsync(string matchId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var match = await FindAsync(matchId, ct);

        if (principal.GetUserId() == match.Room.LeaderUserId)
        {
            return match;
        }

        if (principal.GetParticipantId() is { } participantId)
        {
            var isMember = await db.Participants.AnyAsync(
                p => p.Id == participantId && p.RoomId == match.RoomId && p.Status != ParticipantStatus.Rejected, ct);

            if (isMember)
            {
                return match;
            }
        }

        throw MatchNotFound();
    }

    /// <summary>Controles da secao 10 e <c>GET …/stats</c> — "todos exigem lider".</summary>
    public async Task<Match> GetMatchAsLeaderAsync(string matchId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var match = await FindAsync(matchId, ct);
        RoomAccessService.EnsureLeader(match.Room, principal);
        return match;
    }

    /// <summary>
    /// A partida <b>e</b> a linha de participante de quem chamou — para as rotas que so um jogador
    /// faz sentido chamar: enviar resposta, marcar pronto, ver a propria comparacao e o proprio
    /// placar.
    ///
    /// Quem nao e participante aprovado (o lider, quem ainda esta pendente, um estranho) leva
    /// <c>404 MATCH_NOT_FOUND</c> e nao um code proprio: o front nunca monta essas chamadas para
    /// essas pessoas, entao chegar aqui e bug de integracao — e a resposta segue a mesma regra do
    /// <see cref="GetMatchAsMemberAsync"/>, "esta partida nao e sua para jogar".
    /// </summary>
    public async Task<(Match Match, Participant Player)> GetPlayerAsync(string matchId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var match = await FindAsync(matchId, ct);

        if (principal.GetParticipantId() is not { } participantId)
        {
            throw MatchNotFound();
        }

        var player = await db.Participants.FirstOrDefaultAsync(
            p => p.Id == participantId && p.RoomId == match.RoomId && p.Status == ParticipantStatus.Approved, ct);

        return (match, player ?? throw MatchNotFound());
    }

    private async Task<Match> FindAsync(string matchId, CancellationToken ct)
    {
        // Id malformado e 404, e nao 400 — mesmo criterio das secoes 5 e 6: para quem esta olhando,
        // um id que nao resolve e um recurso que nao existe.
        if (!Guid.TryParse(matchId, out var id))
        {
            throw MatchNotFound();
        }

        return await db.Matches.Include(m => m.Room).FirstOrDefaultAsync(m => m.Id == id, ct)
               ?? throw MatchNotFound();
    }

    public static ApiException MatchNotFound()
        => new(StatusCodes.Status404NotFound, ErrorCodes.MatchNotFound, "Partida nao encontrada.");
}
