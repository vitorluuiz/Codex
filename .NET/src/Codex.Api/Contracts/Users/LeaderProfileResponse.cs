using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Domain;

namespace Codex.Api.Contracts.Users;

/// <summary>Formato exato de GET /users/{userId}/profile (api-rest.md secao 2).</summary>
public record LeaderProfileResponse(
    UserDto User,
    IReadOnlyList<PhaseSetSummaryDto> Sets,
    IReadOnlyList<LeaderMatchSummaryDto> Matches);

/// <summary>
/// Uma linha do historico de partidas.
///
/// "A linha do historico ja traz os numeros do relatorio resumido (accuracyRate,
/// durationLabel). A lista e o dialogo 'Ver relatorio' leem do mesmo objeto — abrir o dialogo
/// nao custa uma segunda ida ao servidor" (secao 2). Por isso os agregados vem aqui e nao numa
/// rota de relatorio separada.
/// </summary>
public record LeaderMatchSummaryDto(
    Guid Id,
    string SetTitle,
    MatchMode Mode,
    string PlayedAtLabel,
    int ParticipantCount,
    int AvgScore,
    int MaxAvgScore,
    int MaxScore,
    int AccuracyRate,
    IReadOnlyList<int?> PhaseAccuracy,
    IReadOnlyList<int?> PhaseAvgScore,
    string DurationLabel);
