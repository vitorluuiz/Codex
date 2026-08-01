using Codex.Api.Domain;

namespace Codex.Api.Contracts.Rooms;

/// <summary>Formato exato de GET /rooms/{code} (api-rest.md secao 4).</summary>
public record RoomDto(
    Guid Id,
    string Code,
    RoomStatus Status,
    MatchMode? MatchMode,
    int Capacity,
    bool Locked,
    bool RequireAccount,
    RoomLeaderDto Leader,
    DateTimeOffset CreatedAt);

/// <summary>
/// So id e name: o front usa "leader.id" para decidir entre visao de lider e de jogador, e
/// "leader.name" no texto "Aguardando ... iniciar a partida" (secao 3). Email e plano do lider
/// nao aparecem em nenhum pixel, entao nao saem daqui.
/// </summary>
public record RoomLeaderDto(Guid Id, string Name);