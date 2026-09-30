using Codex.Api.Common.Formatting;
using Codex.Api.Contracts.Matches;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.Redis;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>
/// Os numeros da partida: o painel do lider (secao 10), a comparacao com a turma, o placar do aluno
/// e o podio (secao 9).
///
/// So le. Nenhum metodo daqui grava nem publica — o que permite que o publicador de eventos o chame
/// no meio de uma mutacao sem risco de reentrancia.
///
/// <b>Uma restricao nao obvia amarra duas rotas daqui:</b> o <c>ChallengeShell</c> sobrescreve
/// <c>scoreboard.avgScore</c> com <c>stats.teamAvgScore</c> ao receber <c>stats.updated</c>. Os dois
/// numeros <b>tem</b> de ser o mesmo por construcao, e e por isso que ambos saem de
/// <see cref="MatchTotalsAsync"/>, e nao de duas consultas parecidas. Hoje a substituicao nem e
/// observavel (o aluno nao assina o canal do lider), o que so torna a divergencia mais facil de
/// introduzir sem ninguem ver.
/// </summary>
public class MatchStatsService(IRoomRepository repo, Codex.Api.Services.Redis.IMatchRepository matchRepo)
{
    /// <summary>
    /// Acima disto o histograma vira baldes. "Se a turma for grande, agregue em ~15 baldes antes de
    /// enviar" (secao 9) — 30 barras num grafico de 320 px viram um borrao.
    /// </summary>
    private const int MaxHistogramBars = 15;

    /// <summary>
    /// O payload que alimenta o painel inteiro do lider, e o corpo do evento <c>stats.updated</c>.
    /// </summary>
    public async Task<PhaseStatsDto> GetStatsAsync(Match match, RoomQueuePhase phase, CancellationToken ct)
    {
        var players = await ApprovedPlayersAsync(match, ct);
        var submissions = await PhaseSubmissionsAsync(match.Id, phase.Id, ct);
        var totals = await MatchTotalsAsync(match, players, ct);

        var graded = submissions.Where(s => s.Grading is GradingStatus.Graded).ToList();
        var correctCount = graded.Count(s => s.Correct is true);

        var content = PhaseContent.Parse(phase.ContentJson);
        var byParticipant = submissions.ToDictionary(s => s.ParticipantId);

        return new PhaseStatsDto(
            phase.Id,
            submissions.Count,
            players.Count,
            submissions.Count(s => s.ReadyAt is not null),
            // Sobre os corrigidos, e nao sobre a turma: com text/code pendentes, dividir pelo total
            // faria a taxa de acerto cair sozinha a cada resposta que ainda nem foi avaliada.
            graded.Count is 0 ? 0 : (int)Math.Round(100.0 * correctCount / graded.Count, MidpointRounding.AwayFromZero),
            correctCount,
            graded.Count,
            submissions.Count is 0 ? 0 : (int)Math.Round(submissions.Average(s => s.ElapsedSeconds), MidpointRounding.AwayFromZero),
            submissions.Count is 0 ? 0 : submissions.Min(s => s.ElapsedSeconds),
            Average(totals.Values),
            totals.Count is 0 ? 0 : totals.Values.Max(),
            AnswerDistribution(phase, content, submissions),
            GradingDistribution(submissions, graded.Count, correctCount),
            ResponseTimeBuckets(phase, submissions),
            [.. players.Select(player => PlayerRow(player, byParticipant.GetValueOrDefault(player.Id)))]);
    }

    /// <summary>
    /// A tela "Como voce se compara aos outros jogadores". Quem chama ja garantiu que a fase fechou —
    /// e aqui que o gabarito finalmente sai.
    /// </summary>
    public async Task<PhaseComparisonDto> GetComparisonAsync(Match match, RoomQueuePhase phase, Participant player, CancellationToken ct)
    {
        var players = await ApprovedPlayersAsync(match, ct);
        var submissions = await PhaseSubmissionsAsync(match.Id, phase.Id, ct);
        var totals = await MatchTotalsAsync(match, players, ct);

        var mine = submissions.FirstOrDefault(s => s.ParticipantId == player.Id);
        var phaseScore = mine?.Score ?? 0;

        // Denominador sao os <i>outros</i>: "percentual de jogadores que a pessoa superou". Sozinha na
        // fase, ela superou todos os outros que existem — nenhum —, e 100 descreve isso melhor que 0.
        var others = Math.Max(submissions.Count - 1, 0);
        var beaten = submissions.Count(s => s.ParticipantId != player.Id && (s.Score ?? 0) < phaseScore);

        return new PhaseComparisonDto(
            totals.GetValueOrDefault(player.Id),
            phaseScore,
            others is 0 ? 100 : (int)Math.Round(100.0 * beaten / others, MidpointRounding.AwayFromZero),
            Histogram(submissions, player.Id),
            PhaseGrading.CorrectAnswerLabel(phase),
            mine?.Correct);
    }

    /// <summary>"Os dois numeros do canto da barra superior" (secao 9).</summary>
    public async Task<PlayerScoreboardDto> GetScoreboardAsync(Match match, Participant player, CancellationToken ct)
    {
        var players = await ApprovedPlayersAsync(match, ct);
        var totals = await MatchTotalsAsync(match, players, ct);

        return new PlayerScoreboardDto(totals.GetValueOrDefault(player.Id), Average(totals.Values));
    }

    /// <summary>
    /// O podio, no maximo 3 posicoes.
    ///
    /// Empate desempata por <b>menor tempo somado</b> e, persistindo, por ordem de entrada na sala:
    /// sem criterio nenhum, duas pessoas com a mesma pontuacao trocariam de degrau a cada leitura,
    /// porque a ordem viria do banco. Quem respondeu mais rapido pelo mesmo tanto de acerto e o
    /// desempate que a propria formula de pontuacao ja premia.
    /// </summary>
    public async Task<IReadOnlyList<PodiumEntryDto>> GetPodiumAsync(Match match, CancellationToken ct)
    {
        var players = await ApprovedPlayersAsync(match, ct);
        var totals = await MatchTotalsAsync(match, players, ct);

        var phasesData = await repo.GetQueuePhasesAsync(match.RoomId.ToString(), ct);
        var allSubs = new List<Submission>();
        foreach (var ph in phasesData)
        {
            allSubs.AddRange(await matchRepo.GetSubmissionsAsync(match.Id.ToString(), ph.Id, ct));
        }

        var elapsed = allSubs
            .GroupBy(s => s.ParticipantId)
            .ToDictionary(g => g.Key, g => g.Sum(s => s.ElapsedSeconds));

        return
        [
            .. players
                .OrderByDescending(p => totals.GetValueOrDefault(p.Id))
                .ThenBy(p => elapsed.GetValueOrDefault(p.Id, int.MaxValue))
                .ThenBy(p => p.JoinedAt)
                .Take(3)
                // avatarUrl e sempre nulo: o schema so tem avatarIndex, e nao ha upload de foto em
                // lugar nenhum do produto. O campo existe no contrato, entao sai.
                .Select(p => new PodiumEntryDto(p.Id, p.DisplayName, totals.GetValueOrDefault(p.Id), p.AvatarIndex, null)),
        ];
    }

    /// <summary>
    /// Pontuacao acumulada de cada jogador <b>aprovado</b> na partida inteira, com zero para quem
    /// ainda nao pontuou.
    ///
    /// O zero explicito importa: e o que faz a media ser "a media da turma" e nao "a media de quem
    /// respondeu". Numa fase em que 5 de 28 responderam, as duas contas diferem por um fator de 5, e
    /// o aluno leria que esta muito abaixo da turma quando esta na frente dela.
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, int>> MatchTotalsAsync(
        Match match,
        IReadOnlyList<Participant> players,
        CancellationToken ct)
    {
        var phasesData = await repo.GetQueuePhasesAsync(match.RoomId.ToString(), ct);
        var allSubs = new List<Submission>();
        foreach (var ph in phasesData)
        {
            allSubs.AddRange(await matchRepo.GetSubmissionsAsync(match.Id.ToString(), ph.Id, ct));
        }

        var scored = allSubs
            .Where(s => s.Score != null)
            .GroupBy(s => s.ParticipantId)
            .ToDictionary(g => g.Key, g => g.Sum(s => s.Score!.Value));

        return players.ToDictionary(p => p.Id, p => scored.GetValueOrDefault(p.Id));
    }

    /// <summary>
    /// Quem jogou <b>esta</b> partida.
    ///
    /// A resposta depende de a partida estar em andamento ou encerrada, e essa distincao nao e
    /// firula — sem ela, cada metade da regra quebra a outra:
    ///
    /// - <b>Em andamento</b>, exclui quem esta na tela de resultados da partida anterior
    ///   (<c>InResultsSince</c>). Sem isso, uma aba esquecida no podio entraria no
    ///   <c>totalPlayers</c> e a regra "todos enviaram" nunca fecharia uma fase — a turma dependeria
    ///   do cronometro por causa de alguem que nem esta olhando.
    /// - <b>Encerrada</b>, inclui todo mundo, porque <see cref="MatchService"/> marca os jogadores
    ///   como "nos resultados" exatamente ao encerrar. Aplicar o filtro aqui esvaziaria o podio da
    ///   partida que acabou de terminar: os jogadores dela sao, por construcao, os que estao no
    ///   podio olhando para ele.
    ///
    /// <b>Efeito colateral conhecido:</b> quem volta ao lobby no meio de uma partida ja em andamento
    /// passa a contar a partir dali, e o <c>totalPlayers</c> daquela fase sobe. A fase ainda fecha
    /// pelo cronometro; travar o conjunto de jogadores no inicio da partida exigiria uma tabela de
    /// participacao, que nao existe.
    /// </summary>
    private async Task<IReadOnlyList<Participant>> ApprovedPlayersAsync(Match match, CancellationToken ct)
    {
        var finished = match.Status is MatchStatus.Finished;
        var pDatas = await repo.GetParticipantsAsync(match.RoomId.ToString(), ct);

        return pDatas
            .Where(p => p.Status == "approved" && (finished || p.InResultsSinceMs == null))
            .Select(p => p.ToEntity(match.RoomId.ToString()))
            .OrderBy(p => p.JoinedAt)
            .ToList();
    }

    private async Task<IReadOnlyList<Submission>> PhaseSubmissionsAsync(Guid matchId, Guid phaseId, CancellationToken ct)
        => await matchRepo.GetSubmissionsAsync(matchId.ToString(), phaseId.ToString(), ct);

    /// <summary>
    /// Quantos jogadores a sala tem — o <c>totalPlayers</c> de todo evento de progresso, e o que o
    /// <c>NO_PLAYERS</c> do inicio da partida conta. Mesmo criterio de
    /// <see cref="ApprovedPlayersAsync"/>: aprovado e no lobby.
    /// </summary>
    public async Task<int> CountPlayersAsync(Guid roomId, CancellationToken ct)
    {
        var pDatas = await repo.GetParticipantsAsync(roomId.ToString(), ct);
        return pDatas.Count(p => p.Status == "approved" && p.InResultsSinceMs == null);
    }

    private static int Average(IEnumerable<int> values)
    {
        var list = values as IReadOnlyCollection<int> ?? [.. values];
        return list.Count is 0 ? 0 : (int)Math.Round(list.Average(), MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// A distribuicao por alternativa. Vazia fora de <c>quiz</c> — "nos outros tipos o painel usa
    /// gradingDistribution".
    ///
    /// <c>correct</c> sai de <c>correctIndexes</c> (plural): numa fase com duas alternativas certas,
    /// marcar so a primeira mostraria ao lider uma barra verde e outra vermelha para duas respostas
    /// que o proprio sistema aceitou.
    /// </summary>
    private static IReadOnlyList<AnswerDistributionEntryDto> AnswerDistribution(
        RoomQueuePhase phase,
        PhaseContent content,
        IReadOnlyList<Submission> submissions)
    {
        if (phase.Kind is not PhaseKind.Quiz)
        {
            return [];
        }

        var options = content.Options ?? [];
        var correctIndexes = content.CorrectIndexes ?? [];

        var counts = submissions
            .Select(s => PhaseGrading.OptionIndex(AnswerDto.Parse(s.AnswerJson).OptionId))
            .Where(index => index is not null)
            .GroupBy(index => index!.Value)
            .ToDictionary(g => g.Key, g => g.Count());

        return
        [
            .. options.Select((label, index) => new AnswerDistributionEntryDto(
                PhaseProjection.OptionId(index),
                label,
                counts.GetValueOrDefault(index),
                correctIndexes.Contains(index))),
        ];
    }

    private static IReadOnlyList<GradingDistributionEntryDto> GradingDistribution(
        IReadOnlyList<Submission> submissions,
        int gradedCount,
        int correctCount)
    =>
    [
        new(GradingDistributionEntryDto.Correct, correctCount),
        new(GradingDistributionEntryDto.Incorrect, gradedCount - correctCount),
        // "awaiting" e quem enviou e ainda nao tem nota — hoje, todo envio de text e code.
        new(GradingDistributionEntryDto.Awaiting, submissions.Count - gradedCount),
    ];

    private static IReadOnlyList<ResponseTimeBucketDto> ResponseTimeBuckets(
        RoomQueuePhase phase,
        IReadOnlyList<Submission> submissions)
    {
        var labels = LabelFormatter.ResponseTimeBucketLabels(phase.TimeSeconds);
        var counts = new int[labels.Count];

        foreach (var submission in submissions)
        {
            counts[LabelFormatter.ResponseTimeBucketIndex(submission.ElapsedSeconds, phase.TimeSeconds)]++;
        }

        return [.. labels.Select((label, index) => new ResponseTimeBucketDto(label, counts[index]))];
    }

    private static LeaderPlayerRowDto PlayerRow(Participant player, Submission? submission) => new(
        player.Id,
        player.DisplayName,
        player.AvatarIndex,
        submission is null ? LeaderPlayerRowDto.Pending : LeaderPlayerRowDto.Submitted,
        submission?.ElapsedSeconds,
        submission?.Correct);

    /// <summary>
    /// As barras da comparacao, "ja ordenado por pontuacao e sem nomes (e anonimo por construcao)".
    ///
    /// Acima de <see cref="MaxHistogramBars"/> envios, cada barra passa a ser um balde e leva a media
    /// dele. O formato do contrato nao tem campo de contagem, entao o balde perde quantas pessoas
    /// representa — limitacao registrada, e o motivo de a agregacao so comecar quando desenhar uma
    /// barra por pessoa ja nao caberia na tela.
    /// </summary>
    private static IReadOnlyList<HistogramEntryDto> Histogram(IReadOnlyList<Submission> submissions, Guid playerId)
    {
        var ordered = submissions
            .Select(s => (Score: s.Score ?? 0, IsMe: s.ParticipantId == playerId))
            .OrderBy(entry => entry.Score)
            .ToList();

        if (ordered.Count <= MaxHistogramBars)
        {
            return [.. ordered.Select(entry => new HistogramEntryDto(entry.Score, entry.IsMe))];
        }

        var buckets = new List<HistogramEntryDto>(MaxHistogramBars);

        for (var index = 0; index < MaxHistogramBars; index++)
        {
            var start = index * ordered.Count / MaxHistogramBars;
            var end = (index + 1) * ordered.Count / MaxHistogramBars;
            var slice = ordered.GetRange(start, Math.Max(end - start, 1));

            buckets.Add(new HistogramEntryDto(
                (int)Math.Round(slice.Average(entry => entry.Score), MidpointRounding.AwayFromZero),
                slice.Any(entry => entry.IsMe)));
        }

        return buckets;
    }
}
