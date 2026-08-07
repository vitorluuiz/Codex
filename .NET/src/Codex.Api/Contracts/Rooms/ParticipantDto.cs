using Codex.Api.Domain;

namespace Codex.Api.Contracts.Rooms;

/// <summary>
/// Formato exato de "participant" em api-rest.md secao 3 e do item de GET /rooms/{code}/participants
/// (secao 4), mais <c>inResults</c>.
/// </summary>
/// <param name="InResults">
/// <c>true</c> enquanto a pessoa esta na tela de resultados de uma partida encerrada e ainda nao
/// voltou ao lobby. <b>Nao esta no contrato</b> — foi acrescentado junto com o encerramento
/// automatico da partida, que deixou de arrastar a turma de volta ao lobby: sem este campo o lider
/// nao teria como saber quem ainda nao voltou, e a lista mostraria como presente quem esta olhando
/// o podio.
/// </param>
public record ParticipantDto(
    Guid Id,
    Guid RoomId,
    string DisplayName,
    int AvatarIndex,
    bool LoggedIn,
    Guid? UserId,
    ParticipantStatus Status,
    DateTimeOffset JoinedAt,
    bool InResults);