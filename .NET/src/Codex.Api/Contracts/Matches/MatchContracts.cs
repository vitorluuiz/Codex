using Codex.Api.Contracts.Phases;
using Codex.Api.Domain;

namespace Codex.Api.Contracts.Matches;

/// <summary>
/// Corpo de <c>POST /rooms/{code}/match</c> (secao 7).
///
/// <c>mode</c> e <b>string</b>, e nao <see cref="MatchMode"/>, pela mesma razao que os ids da secao
/// 6 trafegam como string: um valor desconhecido estouraria no conversor de enum <i>antes</i> de
/// qualquer codigo do app rodar, e responderia <c>500 INTERNAL_ERROR</c> em vez do
/// <c>400 VALIDATION_ERROR</c> do contrato (ver api-implementation-status.md §3).
/// </summary>
public record StartMatchRequest(string? Mode);

/// <summary>Corpo de <c>GET /rooms/{code}/match</c> e resposta do <c>POST</c> (secao 7).</summary>
public record MatchDto(
    Guid Id,
    Guid RoomId,
    MatchMode Mode,
    MatchStatus Status,
    int CurrentPhaseIndex,
    int TotalPhases,
    DateTimeOffset StartedAt);

/// <summary>
/// Corpo de <c>GET /matches/{matchId}/current-phase</c> — "a rota mais importante da tela de
/// Desafios", e o <c>state</c> que vai dentro do evento <c>phase.started</c>.
///
/// <c>secondsLeft</c> e derivado de <c>Match.CurrentPhaseEndsAt</c> na saida, nunca gravado: o
/// contrato de WS §6 e explicito que o servidor raciocina em instante absoluto. Aqui ele sai como
/// contagem porque e o que o front usa para semear o cronometro no primeiro render
/// (<c>ChallengeShell</c> converte de volta para <c>endsAt</c> local).
/// </summary>
public record PhaseStateDto(
    PhaseDto Phase,
    int PhaseNumber,
    int TotalPhases,
    int SecondsLeft,
    bool Paused,
    int SubmittedCount,
    int TotalPlayers,
    SubmissionDto? MySubmission,
    long? StartsAt = null);

/// <summary>
/// Corpo de <c>POST /matches/{id}/advance</c>. <c>direction</c> segue string pelo mesmo motivo de
/// <see cref="StartMatchRequest.Mode"/>.
/// </summary>
public record AdvanceMatchRequest(string? Direction)
{
    public const string Next = "next";
    public const string Previous = "previous";
}

/// <summary>Corpo de <c>POST /matches/{id}/pause</c>.</summary>
public record PauseMatchRequest(bool Paused);
