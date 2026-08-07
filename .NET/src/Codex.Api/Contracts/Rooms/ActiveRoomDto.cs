using Codex.Api.Domain;

namespace Codex.Api.Contracts.Rooms;

/// <summary>
/// Em que papel quem chamou esta naquela sala. Nao e uma coluna: e derivado
/// (<c>Room.LeaderUserId == userId</c>), e existe no payload porque o front decide com ele
/// duas coisas — em qual aba do perfil a linha aparece ("Perfil de lider" ou "Perfil de
/// participante") e quais campos da sala ele pode desenhar.
/// </summary>
public enum RoomMembershipRole
{
    Leader,
    Participant,
}

/// <summary>
/// Uma sala que ainda esta de pe e da qual quem chamou faz parte — o que a tela precisa para
/// oferecer "Voltar para a sala" (GET /rooms/active, api-rest.md secao 4).
///
/// Nao e um <see cref="RoomDto"/> reduzido: e uma lista, e o que ela mostra e o cartao de
/// retomada (o que era esta sala, quanta gente tem, quando comecou), nao o estado que o lobby
/// consome. Quem volta chama <c>GET /rooms/{code}</c> normalmente na tela seguinte.
///
/// <b>SetTitle e PhaseCount so saem para o lider.</b> A fila e o roteiro da aula e
/// <c>GET /rooms/{code}/queue</c> responde 403 NOT_ROOM_LEADER a qualquer outro (api-queue-log.md
/// §1); mandar o titulo do conjunto aqui contornaria essa mesma regra por outra rota. Para o
/// participante os dois vem nulos e o cartao se identifica pelo <see cref="LeaderName"/>, que ele
/// ja le no lobby ("Aguardando ... iniciar a partida").
/// </summary>
public record ActiveRoomDto(
    string Code,
    RoomStatus Status,
    MatchMode? MatchMode,
    RoomMembershipRole Role,
    string LeaderName,
    string? SetTitle,
    int? PhaseCount,
    int ParticipantCount,
    string CreatedAtLabel);
