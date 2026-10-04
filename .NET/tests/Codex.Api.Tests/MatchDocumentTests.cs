using Codex.Api.Contracts.Matches;
using Codex.Api.Documents;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Microsoft.EntityFrameworkCore;
using MongoDB.Bson;

namespace Codex.Api.Tests;

/// <summary>
/// O snapshot da partida encerrada — <c>docs/contracts/postgresql/migracao-dados.md</c> secao 5.
///
/// <b>Estes testes so sao possiveis enquanto a escrita for dupla</b> (passos 3 e 4 da secao 8.2).
/// Comparar o documento com o que o Postgres calcula e a unica verificacao de verdade que a
/// migracao tem, e ela desaparece no passo 5, quando o lado relacional deixar de existir. Por isso
/// eles sao escritos agora, e nao depois.
/// </summary>
public class MatchDocumentTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly StartMatchRequest Live = new("live");

    /* ------------------------------------------------------------------ cenario */

    private static async Task<(RoomTestContext Ctx, MatchDto Match, List<Participant> Players)> PlayedAsync(
        int phaseCount = 2,
        int playerCount = 2)
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPlayableSet(ctx.Leader, "Frações", phaseCount));

        var players = Enumerable.Range(1, playerCount)
            .Select(i => ctx.AddParticipant($"Aluno {i}", userId: ctx.AddUser($"Aluno {i}", $"aluno{i}@escola.br").Id))
            .ToList();

        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);

        // Todo mundo responde todas as fases: o primeiro acerta, os demais erram. Assim ha
        // pontuacao diferente de zero, acerto e erro no mesmo documento.
        //
        // O `advance` entre as fases e o do lider: o ultimo envio fecha a fase, mas nao avanca
        // sozinho. Depois da ultima, FinishIfLastPhaseAsync encerra a partida — e e esse
        // encerramento que grava o documento.
        for (var phase = 0; phase < phaseCount; phase++)
        {
            if (phase > 0)
            {
                await ctx.Matches.AdvanceAsync(match.Id.ToString(), new AdvanceMatchRequest("next"), ctx.AsLeader, Ct);
            }

            var phaseId = (await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct)).Phase.Id;

            for (var index = 0; index < players.Count; index++)
            {
                await ctx.Submissions.SubmitAsync(
                    match.Id.ToString(),
                    phaseId.ToString(),
                    new SubmitAnswerRequest(new AnswerDto("quiz", OptionId: index is 0 ? "o1" : "o2")),
                    ctx.AsParticipant(players[index].Id),
                    Ct);
            }
        }

        return (ctx, match, players);
    }

    /* ------------------------------------------------------- o snapshot em si */

    [Fact]
    public async Task Finishing_writes_one_match_document_and_one_document_per_participant()
    {
        var (ctx, match, players) = await PlayedAsync();

        var document = await ctx.Documents.FindAsync(match.Id, Ct);

        Assert.NotNull(document);
        Assert.Equal(ctx.Room.Code, document.RoomCode);
        Assert.Equal(ctx.Room.Id, document.RoomId);
        Assert.Equal(ctx.Leader.Id, document.LeaderUserId);
        Assert.Equal(MatchMode.Live, document.Mode);
        Assert.Equal(MatchDocument.CurrentSchemaVersion, document.SchemaVersion);

        var participants = await ctx.Documents.ParticipantsAsync(match.Id, Ct);
        Assert.Equal(players.Count, participants.Count);
        Assert.Equal(players.Select(p => p.Id).Order(), participants.Select(p => p.ParticipantId).Order());
    }

    /// <summary>
    /// O ponto do §2 da arquitetura-dados: o titulo do conjunto e lido de <c>room_queue_sets</c>
    /// meses depois de a partida acabar. E ele que precisa estar aqui dentro para a sala poder
    /// virar efemera.
    /// </summary>
    [Fact]
    public async Task The_document_carries_the_queue_titles_that_the_history_reads_from_the_room()
    {
        var (ctx, match, _) = await PlayedAsync();

        var document = await ctx.Documents.FindAsync(match.Id, Ct);

        var set = Assert.Single(document!.PhaseSets);
        Assert.Equal("Frações", set.Title);
        Assert.Equal(ctx.Db.RoomQueueSets.Single().SourcePhaseSetId, set.SourcePhaseSetId);
    }

    /// <summary>
    /// A decisao da secao 5.4: a fase e congelada <b>uma vez</b> em <c>phases[]</c>, com gabarito, e
    /// a submissao guarda so um ponteiro. Se alguem inverter isso, o custo e multiplicativo e o teto
    /// de 16 MB do Mongo deixa de ser teorico.
    /// </summary>
    [Fact]
    public async Task A_submission_points_at_a_phase_and_never_copies_it()
    {
        var (ctx, match, _) = await PlayedAsync(phaseCount: 2);

        var document = await ctx.Documents.FindAsync(match.Id, Ct);
        var participants = await ctx.Documents.ParticipantsAsync(match.Id, Ct);

        // O conteudo existe exatamente uma vez por fase, no documento da partida.
        Assert.All(document!.Phases, phase => Assert.Equal("Qual fracao e equivalente a 2/3?", phase.Content.Question));

        // E o ponteiro de cada submissao resolve contra ele.
        var phaseIds = document.Phases.Select(p => p.PhaseId).ToHashSet();
        Assert.All(
            participants.SelectMany(p => p.Submissions),
            submission => Assert.Contains(submission.PhaseId, phaseIds));
    }

    /// <summary>
    /// <c>maxScore</c> sai de <see cref="PhaseGrading.MaxScore"/>, que e a mesma formula da nota com
    /// bonus de tempo cheio — e nao uma segunda copia da conta.
    /// </summary>
    [Fact]
    public async Task Max_score_of_a_phase_is_base_points_times_the_multiplier()
    {
        var (ctx, match, _) = await PlayedAsync(phaseCount: 1);

        var document = await ctx.Documents.FindAsync(match.Id, Ct);
        var phase = Assert.Single(document!.Phases);
        var source = ctx.Db.RoomQueuePhases.Single();

        Assert.Equal(PhaseGrading.MaxScore(source), phase.MaxScore);
        Assert.Equal((int)(source.BasePoints * source.PointsMultiplier), phase.MaxScore);
    }

    /* ------------------------------------------- a comparacao com o Postgres */

    /// <summary>
    /// <b>O teste que so existe durante a escrita dupla.</b> Os agregados gravados no documento tem
    /// que ser os mesmos que <c>MatchStatsService</c> calcula do Postgres — e a unica prova de que
    /// migrar a leitura (passo 4) nao vai mudar numero nenhum na tela.
    /// </summary>
    [Fact]
    public async Task Document_aggregates_match_what_the_relational_side_computes()
    {
        var (ctx, match, _) = await PlayedAsync(phaseCount: 2, playerCount: 3);

        var entity = await ctx.Db.Matches.Include(m => m.Room).SingleAsync(m => m.Id == match.Id, Ct);
        var document = await ctx.Documents.FindAsync(match.Id, Ct);
        var participants = await ctx.Documents.ParticipantsAsync(match.Id, Ct);

        var approved = await ctx.Db.Participants
            .CountAsync(p => p.RoomId == ctx.Room.Id && p.Status == ParticipantStatus.Approved, Ct);
        Assert.Equal(approved, document!.Stats.ParticipantCount);

        // A soma das pontuacoes por pessoa bate com a soma das submissoes pontuadas do Postgres.
        var relationalScore = await ctx.Db.Submissions
            .Where(s => s.MatchId == match.Id && s.Score != null)
            .SumAsync(s => s.Score!.Value, Ct);
        Assert.Equal(relationalScore, participants.Sum(p => p.TotalScore));

        // E a media do documento e a mesma que o placar da turma mostra ao vivo — o invariante que
        // MatchStatsService ja protege entre teamAvgScore e scoreboard.avgScore.
        var anyPlayer = await ctx.Db.Participants.SingleAsync(p => p.Id == participants[0].ParticipantId, Ct);
        var scoreboard = await ctx.MatchStats.GetScoreboardAsync(entity, anyPlayer, Ct);
        Assert.Equal(scoreboard.AvgScore, document.Stats.AvgScore);
    }

    /// <summary>
    /// A taxa de acerto tambem, e por um motivo especifico: o historico arredondava com
    /// <c>Math.Round</c> puro (bancario) enquanto o painel do lider usa
    /// <c>MidpointRounding.AwayFromZero</c>. O documento adotou a grafia do painel, e este teste e
    /// o que impede a divergencia de voltar.
    ///
    /// Um acerto em tres corrigidos da 33,33 — nao e um caso de fronteira, e uma sala comum.
    /// </summary>
    [Fact]
    public async Task Document_accuracy_matches_the_leader_panel()
    {
        var (ctx, match, _) = await PlayedAsync(phaseCount: 1, playerCount: 3);

        var entity = await ctx.Db.Matches.Include(m => m.Room).SingleAsync(m => m.Id == match.Id, Ct);
        var phase = await ctx.Db.RoomQueuePhases.SingleAsync(p => p.RoomId == ctx.Room.Id, Ct);
        var panel = await ctx.MatchStats.GetStatsAsync(entity, phase, Ct);

        var document = await ctx.Documents.FindAsync(match.Id, Ct);

        Assert.Equal(33, panel.AccuracyRate);
        Assert.Equal(panel.AccuracyRate, document!.Stats.AccuracyRate);
        Assert.Equal(panel.AccuracyRate, Assert.Single(document.Stats.PhaseAccuracy));
        Assert.Equal(panel.TeamAvgScore, document.Stats.AvgScore);
    }

    /// <summary>
    /// O podio sai do documento na mesma ordem que <c>MatchStatsService.GetPodiumAsync</c> devolve:
    /// pontuacao, depois menor tempo somado, depois ordem de entrada.
    /// </summary>
    [Fact]
    public async Task Participants_come_back_in_podium_order()
    {
        var (ctx, match, _) = await PlayedAsync(phaseCount: 2, playerCount: 3);

        var entity = await ctx.Db.Matches.Include(m => m.Room).SingleAsync(m => m.Id == match.Id, Ct);
        var podium = await ctx.MatchStats.GetPodiumAsync(entity, Ct);
        var participants = await ctx.Documents.ParticipantsAsync(match.Id, Ct);

        Assert.Equal(
            podium.Select(p => p.ParticipantId),
            participants.Take(podium.Count).Select(p => p.ParticipantId));
    }

    /* -------------------------------------------------------------- commit */

    /// <summary>
    /// Encerrar e idempotente, e o commit tambem: o segundo clique do lider nao pode duplicar
    /// participante nem mover numero nenhum.
    /// </summary>
    [Fact]
    public async Task Finishing_twice_leaves_exactly_one_document_per_participant()
    {
        var (ctx, match, players) = await PlayedAsync(phaseCount: 1, playerCount: 2);

        var before = await ctx.Documents.FindAsync(match.Id, Ct);
        await ctx.Matches.FinishAsync(match.Id.ToString(), ctx.AsLeader, Ct);
        var after = await ctx.Documents.FindAsync(match.Id, Ct);

        Assert.Equal(players.Count, (await ctx.Documents.ParticipantsAsync(match.Id, Ct)).Count);
        Assert.Equal(before!.FinishedAt, after!.FinishedAt);
        Assert.Equal(before.Stats.AvgScore, after.Stats.AvgScore);
    }

    /// <summary>
    /// Montar o snapshot duas vezes tem que dar o mesmo resultado — o requisito de idempotencia da
    /// secao 7, que e o que permite refazer o commit depois de uma falha de rede.
    ///
    /// A comparacao e sobre o <b>BSON serializado</b>, e nao sobre os records: a igualdade
    /// sintetizada de um record compara cada campo com <c>EqualityComparer.Default</c>, e para uma
    /// <c>List</c> isso e identidade de referencia — duas montagens identicas nunca seriam iguais.
    /// Comparar o que de fato vai para o banco tambem exercita o serializador.
    /// </summary>
    [Fact]
    public async Task Building_the_snapshot_twice_produces_the_same_documents()
    {
        var (ctx, match, _) = await PlayedAsync(phaseCount: 2, playerCount: 2);
        var entity = await ctx.Db.Matches.Include(m => m.Room).SingleAsync(m => m.Id == match.Id, Ct);

        var first = await ctx.MatchDocuments.BuildAsync(entity, Ct);
        var second = await ctx.MatchDocuments.BuildAsync(entity, Ct);

        Assert.Equal(Bson(first.Document), Bson(second.Document));
        Assert.Equal(
            first.Participants.Select(Bson),
            second.Participants.Select(Bson));
    }

    /* ------------------------------------------------------- serializacao */

    /// <summary>
    /// <b>Uma so grafia para cada valor.</b> O Postgres guarda <c>Quiz</c> na coluna e
    /// <c>"quiz"</c> dentro do <c>AnswerJson</c> da mesma linha — duas grafias do mesmo valor no
    /// mesmo banco, o detalhe mais facil de errar numa query manual. O store de documentos nasce
    /// depois disso e usa o vocabulario do contrato, inclusive o kebab-case que so o
    /// <c>MatchMode</c> tem.
    /// </summary>
    [Fact]
    public async Task The_document_speaks_the_same_vocabulary_as_the_contract()
    {
        var (ctx, match, _) = await PlayedAsync(phaseCount: 1, playerCount: 1);

        var json = Bson((await ctx.Documents.FindAsync(match.Id, Ct))!);
        var participant = Bson(Assert.Single(await ctx.Documents.ParticipantsAsync(match.Id, Ct)));

        // Nomes de campo em camelCase, como o JSON do contrato.
        Assert.Contains("\"roomCode\"", json);
        Assert.Contains("\"leaderUserId\"", json);
        Assert.Contains("\"phaseSets\"", json);

        // Enums na grafia da API, nao na do C#.
        Assert.Contains("\"mode\" : \"live\"", json);
        Assert.Contains("\"kind\" : \"quiz\"", json);
        Assert.Contains("\"grading\" : \"graded\"", participant);

        // E nulo omitido: uma fase quiz nao guarda os campos de outros kinds.
        Assert.DoesNotContain("starterCode", json);
        Assert.DoesNotContain("expectedAnswer", json);
    }

    /// <summary>
    /// O ponteiro da secao 5.4, agora no BSON: a submissao gravada nao carrega enunciado,
    /// alternativa nem gabarito — so o id da fase e os dois numeros denormalizados.
    /// </summary>
    [Fact]
    public async Task A_serialized_submission_carries_no_phase_content()
    {
        var (ctx, match, _) = await PlayedAsync(phaseCount: 1, playerCount: 1);

        var participant = Bson(Assert.Single(await ctx.Documents.ParticipantsAsync(match.Id, Ct)));

        Assert.Contains("\"phaseId\"", participant);
        Assert.Contains("\"maxScore\"", participant);
        Assert.DoesNotContain("Qual fracao", participant);
        Assert.DoesNotContain("correctIndexes", participant);
        Assert.DoesNotContain("options", participant);
    }

    /// <summary>O BSON de verdade, com as convencoes que o store registra.</summary>
    private static string Bson<T>(T document)
    {
        DocumentConventions.Register();
        return document.ToJson();
    }

    /// <summary>
    /// Convidado entra no documento com <c>userId</c> nulo: ele tem pontuacao e aparece no podio,
    /// mas nao tem historico — o indice <c>{ userId, matchId }</c> simplesmente nao o alcanca.
    /// </summary>
    [Fact]
    public async Task A_guest_is_snapshotted_without_a_user_id()
    {
        var ctx = new RoomTestContext();
        await ctx.EnqueueAsync(ctx.AddPlayableSet(ctx.Leader, "Frações", phaseCount: 1));
        var guest = ctx.AddParticipant("Convidado");

        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var phaseId = (await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct)).Phase.Id;
        await ctx.Submissions.SubmitAsync(
            match.Id.ToString(),
            phaseId.ToString(),
            new SubmitAnswerRequest(new AnswerDto("quiz", OptionId: "o1")),
            ctx.AsParticipant(guest.Id),
            Ct);

        var participant = Assert.Single(await ctx.Documents.ParticipantsAsync(match.Id, Ct));

        Assert.Null(participant.UserId);
        Assert.Equal("Convidado", participant.DisplayName);
        Assert.True(participant.TotalScore > 0);
    }

    /// <summary>
    /// Fases <c>text</c> e <c>code</c> voltam <c>pending</c> para sempre (nao ha corretor). O
    /// documento precisa contar isso separado: taxa de acerto e sobre o que foi <b>corrigido</b>, e
    /// uma fase sem correcao nenhuma sai como <c>null</c>, que nao e o mesmo que 0%.
    /// </summary>
    [Fact]
    public async Task A_phase_nobody_graded_has_null_accuracy_and_not_zero()
    {
        var ctx = new RoomTestContext();
        var content = new PhaseContent(Question: "Explique.", ExpectedAnswer: "Porque sim.");
        await ctx.EnqueueAsync(ctx.AddPhaseSet(ctx.Leader, "Dissertativas", PhaseKind.Text, content));
        var player = ctx.AddParticipant("Ana");

        var match = await ctx.Matches.StartAsync(ctx.Room.Code, Live, ctx.AsLeader, Ct);
        var phaseId = (await ctx.Matches.GetCurrentPhaseAsync(match.Id.ToString(), ctx.AsLeader, Ct)).Phase.Id;
        await ctx.Submissions.SubmitAsync(
            match.Id.ToString(),
            phaseId.ToString(),
            new SubmitAnswerRequest(new AnswerDto("text", Value: "Porque sim.")),
            ctx.AsParticipant(player.Id),
            Ct);

        var document = await ctx.Documents.FindAsync(match.Id, Ct);
        var participant = Assert.Single(await ctx.Documents.ParticipantsAsync(match.Id, Ct));

        Assert.Null(Assert.Single(document!.Stats.PhaseAccuracy));
        Assert.Equal(0, document.Stats.AccuracyRate);
        Assert.Equal(1, participant.PendingCount);
        Assert.Equal(0, participant.GradedCount);
    }
}
