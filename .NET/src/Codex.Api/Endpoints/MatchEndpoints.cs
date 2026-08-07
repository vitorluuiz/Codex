using System.Security.Claims;
using Codex.Api.Contracts.Matches;
using Codex.Api.Services;

namespace Codex.Api.Endpoints;

/// <summary>
/// api-rest.md secoes 7 a 10 — a partida, as respostas, a comparacao e o painel do lider.
///
/// Duas raizes diferentes, e por isso um arquivo so: <c>/rooms/{code}/match</c> (comecar e ler,
/// chaveado pelo codigo da sala, que e o que a tela tem em maos) e <c>/matches/{matchId}/…</c> (todo
/// o resto). Separa-las em dois arquivos esconderia que sao a mesma feature.
///
/// Sem <c>RequireAuthorization()</c>, como as demais rotas de sala: quem escolhe o erro sao os
/// servicos de acesso, que distinguem <c>MATCH_NOT_FOUND</c> de <c>NOT_ROOM_LEADER</c> — um 401 vazio
/// do pipeline nao saberia decidir.
///
/// <c>{matchId}</c>, <c>{phaseId}</c> e <c>{participantId}</c> sao <c>string</c> e nao <c>:guid</c>,
/// pelo mesmo motivo da secao 6: com a restricao de rota, um id malformado viraria 404 do roteador
/// com corpo vazio; passando reto, o servico responde o mesmo 404 no formato {code, message}.
/// </summary>
public static class MatchEndpoints
{
    public static void MapMatchEndpoints(this IEndpointRouteBuilder app)
    {
        MapRoomMatch(app);
        MapPlayerRoutes(app);
        MapLeaderControls(app);
    }

    /// <summary>Secao 7 — o que a tela alcanca pelo codigo da sala.</summary>
    private static void MapRoomMatch(IEndpointRouteBuilder app)
    {
        var room = app.MapGroup("/rooms/{code}/match");

        room.MapPost("", async (string code, StartMatchRequest request, ClaimsPrincipal principal, MatchService matches, CancellationToken ct)
            => Results.Created($"/rooms/{code}/match", await matches.StartAsync(code, request, principal, ct)));

        room.MapGet("", async (string code, ClaimsPrincipal principal, MatchService matches, CancellationToken ct)
            => Results.Ok(await matches.GetByRoomAsync(code, principal, ct)));
    }

    /// <summary>Secoes 7 a 9 — o que o aluno chama durante a partida.</summary>
    private static void MapPlayerRoutes(IEndpointRouteBuilder app)
    {
        var match = app.MapGroup("/matches/{matchId}");

        match.MapGet("/current-phase", async (string matchId, ClaimsPrincipal principal, MatchService matches, CancellationToken ct)
            => Results.Ok(await matches.GetCurrentPhaseAsync(matchId, principal, ct)));

        match.MapPost("/phases/{phaseId}/submissions", async (
            string matchId,
            string phaseId,
            SubmitAnswerRequest request,
            ClaimsPrincipal principal,
            SubmissionService submissions,
            CancellationToken ct) => Results.Created(
                $"/matches/{matchId}/phases/{phaseId}/submissions",
                await submissions.SubmitAsync(matchId, phaseId, request, principal, ct)));

        // 204, o unico da partida: "marca o aluno como pronto" nao tem corpo de resposta no contrato.
        match.MapPost("/phases/{phaseId}/ready", async (
            string matchId,
            string phaseId,
            ClaimsPrincipal principal,
            SubmissionService submissions,
            CancellationToken ct) =>
        {
            await submissions.MarkReadyAsync(matchId, phaseId, principal, ct);
            return Results.NoContent();
        });

        match.MapGet("/phases/{phaseId}/comparison", async (
            string matchId,
            string phaseId,
            ClaimsPrincipal principal,
            SubmissionService submissions,
            CancellationToken ct) => Results.Ok(await submissions.GetComparisonAsync(matchId, phaseId, principal, ct)));

        match.MapGet("/scoreboard/me", async (string matchId, ClaimsPrincipal principal, SubmissionService submissions, CancellationToken ct)
            => Results.Ok(await submissions.GetScoreboardAsync(matchId, principal, ct)));

        match.MapGet("/podium", async (string matchId, ClaimsPrincipal principal, MatchService matches, CancellationToken ct)
            => Results.Ok(await matches.GetPodiumAsync(matchId, principal, ct)));
    }

    /// <summary>Secao 10 — "todos exigem lider".</summary>
    private static void MapLeaderControls(IEndpointRouteBuilder app)
    {
        var match = app.MapGroup("/matches/{matchId}");

        match.MapGet("/phases/{phaseId}/stats", async (
            string matchId,
            string phaseId,
            ClaimsPrincipal principal,
            MatchService matches,
            CancellationToken ct) => Results.Ok(await matches.GetStatsAsync(matchId, phaseId, principal, ct)));

        match.MapPost("/advance", async (
            string matchId,
            AdvanceMatchRequest request,
            ClaimsPrincipal principal,
            MatchService matches,
            CancellationToken ct) =>
        {
            await matches.AdvanceAsync(matchId, request, principal, ct);
            return Results.NoContent();
        });

        match.MapPost("/pause", async (
            string matchId,
            PauseMatchRequest request,
            ClaimsPrincipal principal,
            MatchService matches,
            CancellationToken ct) =>
        {
            await matches.SetPausedAsync(matchId, request, principal, ct);
            return Results.NoContent();
        });

        match.MapPost("/phases/{phaseId}/restart", async (
            string matchId,
            string phaseId,
            ClaimsPrincipal principal,
            MatchService matches,
            CancellationToken ct) =>
        {
            await matches.RestartPhaseAsync(matchId, phaseId, principal, ct);
            return Results.NoContent();
        });

        // Devolve o podio em vez de 204: quem clicou "Encerrar" e justamente quem vai mostra-lo, e o
        // evento match.finished ja o carrega para todo mundo — a rota devolver outra coisa faria o
        // lider ver um podio diferente do da turma se as duas leituras discordassem.
        match.MapPost("/finish", async (string matchId, ClaimsPrincipal principal, MatchService matches, CancellationToken ct)
            => Results.Ok(await matches.FinishAsync(matchId, principal, ct)));

        match.MapPost("/return-to-lobby", async (string matchId, ClaimsPrincipal principal, MatchService matches, CancellationToken ct) =>
        {
            await matches.ReturnToLobbyAsync(matchId, principal, ct);
            return Results.NoContent();
        });

        match.MapDelete("/participants/{participantId}", async (
            string matchId,
            string participantId,
            ClaimsPrincipal principal,
            MatchService matches,
            CancellationToken ct) =>
        {
            await matches.RemovePlayerAsync(matchId, participantId, principal, ct);
            return Results.NoContent();
        });
    }
}
