using Codex.Api.Contracts.Matches;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Documents;

/// <summary>
/// Monta o snapshot de uma partida encerrada e o entrega ao <see cref="IMatchDocumentStore"/>.
///
/// <b>Passo 3 da secao 8.2 da migracao-dados:</b> aqui quem le ainda e o Postgres. O realtime so
/// vira o produtor do payload no passo 7, e o store recebe o mesmo par de documentos nos dois
/// casos — e por isso que trocar o produtor nao mexe em mais nada.
///
/// <b>Idempotente.</b> Montar duas vezes da o mesmo resultado: nada aqui gera id novo, le relogio
/// ou depende de ordem de chegada. As chaves (<c>matchId</c>, <c>participantId</c>) ja existem e
/// sao estaveis, entao o upsert do store pode ser refeito a vontade.
/// </summary>
public sealed class MatchDocumentWriter(AppDbContext db, IMatchDocumentStore store, ILogger<MatchDocumentWriter> logger)
{
    /// <summary>
    /// <b>Falha nao derruba o encerramento — por enquanto.</b> Enquanto o Postgres continuar
    /// guardando a partida (ate o passo 5), perder o documento e perder uma copia, e transformar
    /// isso num 500 tiraria o podio da turma por causa de um banco secundario fora do ar. A partir
    /// do passo 5 a relacao inverte: o documento passa a ser a unica copia, e esta excecao tem que
    /// deixar de ser engolida.
    /// </summary>
    public async Task CommitAsync(Match match, CancellationToken ct)
    {
        try
        {
            var (document, participants) = await BuildAsync(match, ct);
            await store.CommitAsync(document, participants, ct);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Falha ao gravar o documento da partida {MatchId}.", match.Id);
        }
    }

    /// <summary>
    /// Separado de <see cref="CommitAsync"/> para o teste de escrita dupla poder comparar o
    /// snapshot com o que o Postgres calcula, sem passar pelo store.
    /// </summary>
    public async Task<(MatchDocument Document, IReadOnlyList<MatchParticipantDocument> Participants)> BuildAsync(
        Match match,
        CancellationToken ct)
    {
        var queueSets = await db.RoomQueueSets
            .AsNoTracking()
            .Where(s => s.RoomId == match.RoomId)
            .OrderBy(s => s.OrderIndex)
            .ToListAsync(ct);

        var queuePhases = await db.RoomQueuePhases
            .AsNoTracking()
            .Where(p => p.RoomId == match.RoomId)
            .OrderBy(p => p.OrderIndex)
            .ToListAsync(ct);

        // O mesmo conjunto que MatchStatsService chama de jogadores de uma partida encerrada:
        // aprovados da sala, em ordem de entrada. Quem foi removido no meio nao esta aqui — a
        // linha dele e as submissoes dele ja foram apagadas por RemovePlayerAsync.
        var players = await db.Participants
            .AsNoTracking()
            .Where(p => p.RoomId == match.RoomId && p.Status == ParticipantStatus.Approved)
            .OrderBy(p => p.JoinedAt)
            .ToListAsync(ct);

        var submissions = await db.Submissions
            .AsNoTracking()
            .Where(s => s.MatchId == match.Id)
            .ToListAsync(ct);

        var phases = queuePhases.Select(ToPhaseDocument).ToList();
        var phaseById = phases.ToDictionary(p => p.PhaseId);
        var byParticipant = submissions.ToLookup(s => s.ParticipantId);

        var participants = players
            .Select(player => ToParticipantDocument(match, player, byParticipant[player.Id], phaseById))
            .ToList();

        var document = new MatchDocument
        {
            Id = match.Id,
            RoomCode = match.Room.Code,
            RoomId = match.RoomId,
            LeaderUserId = match.Room.LeaderUserId,
            Mode = match.Mode,
            StartedAt = match.StartedAt.UtcDateTime,
            // Encerrada por construcao: este metodo so e chamado por FinishCoreAsync. O fallback
            // existe para o snapshot nunca gravar um campo obrigatorio como default(DateTime).
            FinishedAt = (match.FinishedAt ?? match.StartedAt).UtcDateTime,
            PhaseSets = queueSets.Select(ToPhaseSetDocument).ToList(),
            Phases = phases,
            Stats = BuildStats(phases, participants),
        };

        return (document, participants);
    }

    private static MatchPhaseSetDocument ToPhaseSetDocument(RoomQueueSet set) => new()
    {
        QueueSetId = set.Id,
        SourcePhaseSetId = set.SourcePhaseSetId,
        Title = set.Title,
        Color = set.Color,
        OrderIndex = set.OrderIndex,
    };

    private static MatchPhaseDocument ToPhaseDocument(RoomQueuePhase phase) => new()
    {
        PhaseId = phase.Id,
        QueueSetId = phase.RoomQueueSetId,
        SourcePhaseId = phase.SourcePhaseId,
        OrderIndex = phase.OrderIndex,
        Kind = phase.Kind,
        Name = phase.Name,
        BasePoints = phase.BasePoints,
        PointsMultiplier = phase.PointsMultiplier,
        TimeSeconds = phase.TimeSeconds,
        MaxScore = PhaseGrading.MaxScore(phase),
        // Copia, nao traducao: o mesmo record que o Postgres guardava como string.
        Content = PhaseContent.Parse(phase.ContentJson),
    };

    private static MatchParticipantDocument ToParticipantDocument(
        Match match,
        Participant player,
        IEnumerable<Submission> submissions,
        IReadOnlyDictionary<Guid, MatchPhaseDocument> phaseById)
    {
        var rows = submissions
            .Where(s => phaseById.ContainsKey(s.RoomQueuePhaseId))
            .Select(s => ToSubmissionDocument(s, phaseById[s.RoomQueuePhaseId]))
            .OrderBy(s => s.PhaseOrderIndex)
            .ToList();

        return new MatchParticipantDocument
        {
            // O id do participante e o id do documento: uma pessoa, uma linha por partida — o que
            // sobrou, neste nivel, do indice unico (MatchId, PhaseId, ParticipantId) do Postgres.
            Id = player.Id,
            MatchId = match.Id,
            ParticipantId = player.Id,
            UserId = player.UserId,
            DisplayName = player.DisplayName,
            AvatarIndex = player.AvatarIndex,
            JoinedAt = player.JoinedAt.UtcDateTime,
            TotalScore = rows.Sum(s => s.Score ?? 0),
            GradedCount = rows.Count(s => s.Grading is GradingStatus.Graded),
            CorrectCount = rows.Count(s => s.Correct is true),
            PendingCount = rows.Count(s => s.Grading is GradingStatus.Pending),
            TotalElapsedSeconds = rows.Sum(s => s.ElapsedSeconds),
            Submissions = rows,
        };
    }

    /// <summary>
    /// Passa por <see cref="SubmissionProjection"/> em vez de reler as colunas cruas: os tres
    /// campos do corretor de IA (<c>explanation</c>, <c>aiSuggestions</c>, <c>testsPassed</c>) sao
    /// <c>jsonb</c> que ninguem escreve ainda, e a projecao ja e o unico lugar que sabe desserializa-los
    /// com a politica certa — JSON corrompido degrada aquela submissao em vez de derrubar o commit.
    /// </summary>
    private static MatchSubmissionDocument ToSubmissionDocument(Submission submission, MatchPhaseDocument phase)
    {
        var dto = SubmissionProjection.ToDto(submission);

        return new MatchSubmissionDocument
        {
            PhaseId = phase.PhaseId,
            PhaseOrderIndex = phase.OrderIndex,
            MaxScore = phase.MaxScore,
            Answer = dto.Answer,
            SubmittedAt = submission.SubmittedAt.UtcDateTime,
            ElapsedSeconds = submission.ElapsedSeconds,
            ReadyAt = submission.ReadyAt?.UtcDateTime,
            Grading = dto.Grading,
            Correct = dto.Correct,
            Score = dto.Score,
            Explanation = dto.Explanation,
            AiSuggestions = dto.AiSuggestions,
            TestsPassed = dto.TestsPassed,
        };
    }

    /// <summary>
    /// Os agregados, calculados <b>uma vez</b> a partir dos documentos de participante que acabaram
    /// de ser montados — nunca de uma segunda consulta, e nunca recalculados depois. Sao uma copia
    /// denormalizada, e a unica forma de ela nao virar uma segunda verdade e ter uma so origem.
    ///
    /// Duas definicoes herdadas de <c>MatchStatsService</c>, de proposito: a media e <b>por pessoa
    /// aprovada</b> (com zero explicito para quem nao pontuou, senao seria "a media de quem
    /// respondeu"), e a taxa de acerto e sobre o que foi <b>corrigido</b>, nao sobre o que foi
    /// enviado — uma resposta de <c>text</c> sem corretor nao conta como erro.
    /// </summary>
    private static MatchStatsDocument BuildStats(
        IReadOnlyList<MatchPhaseDocument> phases,
        IReadOnlyList<MatchParticipantDocument> participants)
    {
        var graded = participants.Sum(p => p.GradedCount);
        var correct = participants.Sum(p => p.CorrectCount);

        var byPhase = participants
            .SelectMany(p => p.Submissions)
            .ToLookup(s => s.PhaseId);

        return new MatchStatsDocument
        {
            ParticipantCount = participants.Count,
            AvgScore = Average(participants.Select(p => p.TotalScore)),
            MaxScore = phases.Sum(p => p.MaxScore),
            AccuracyRate = Percentage(correct, graded),
            PhaseAccuracy = phases.Select(phase => PhaseAccuracy(byPhase[phase.PhaseId])).ToList(),
            PhaseAvgScore = phases.Select(phase => PhaseAvgScore(byPhase[phase.PhaseId])).ToList(),
        };
    }

    /// <summary><c>null</c> quando nada foi corrigido naquela fase — o que e diferente de 0%.</summary>
    private static int? PhaseAccuracy(IEnumerable<MatchSubmissionDocument> rows)
    {
        var list = rows.Where(s => s.Grading is GradingStatus.Graded).ToList();
        return list.Count is 0 ? null : Percentage(list.Count(s => s.Correct is true), list.Count);
    }

    private static int? PhaseAvgScore(IEnumerable<MatchSubmissionDocument> rows)
    {
        var list = rows.Where(s => s.Score is not null).ToList();
        return list.Count is 0 ? null : Average(list.Select(s => s.Score!.Value));
    }

    /// <summary>
    /// <c>AwayFromZero</c>, como <c>MatchStatsService.Average</c> e <c>PhaseGrading.Score</c> — e
    /// nao o arredondamento bancario que <c>UserProfileService</c> usa no historico. Os dois
    /// convivem hoje e discordam por 1 ponto exatamente nos casos terminados em ,5; o documento tem
    /// uma so grafia para o mesmo numero.
    /// </summary>
    private static int Average(IEnumerable<int> values)
    {
        var list = values as IReadOnlyCollection<int> ?? [.. values];
        return list.Count is 0 ? 0 : (int)Math.Round(list.Average(), MidpointRounding.AwayFromZero);
    }

    private static int Percentage(int part, int total)
        => total is 0 ? 0 : (int)Math.Round(part * 100.0 / total, MidpointRounding.AwayFromZero);
}
