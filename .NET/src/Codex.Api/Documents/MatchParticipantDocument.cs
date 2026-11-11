using Codex.Api.Contracts.Matches;
using Codex.Api.Domain;

namespace Codex.Api.Documents;

/// <summary>
/// Um participante numa partida, com as submissoes dele embutidas — <c>migracao-dados.md</c>
/// secao 5.2.
///
/// <b>Subdocumento, e nao colecao.</b> Vive dentro de <see cref="MatchDocument.Participants"/>:
/// a partida inteira — cabecalho, fases, agregados e a folha de respostas de cada pessoa — e um
/// unico documento em <c>matches</c>. Por isso nao ha <c>_id</c>, <c>schemaVersion</c> nem
/// <c>matchId</c> aqui: os tres sao do documento pai. A unicidade de <see cref="ParticipantId"/>
/// dentro da partida, que antes era um indice unico de <c>match_participants</c>, agora e uma
/// invariante do documento conferida no commit (<see cref="MatchDocument.EnsureParticipantsAreUnique"/>).
///
/// O teto de 16 MB por documento do Mongo foi aceito conscientemente nesta modelagem — ver
/// <c>docs/contracts/mongodb.md</c>.
/// </summary>
public sealed record MatchParticipantDocument
{
    public required Guid ParticipantId { get; init; }

    /// <summary>
    /// <c>null</c> = convidado. O indice multikey <c>{ participants.userId, finishedAt }</c> de
    /// <c>matches</c> <b>e</b> o historico do jogador — quem entrou sem conta simplesmente nao
    /// aparece nele.
    /// </summary>
    public Guid? UserId { get; init; }

    public required string DisplayName { get; init; }

    public required int AvatarIndex { get; init; }

    public required DateTime JoinedAt { get; init; }

    public required int TotalScore { get; init; }

    public required int GradedCount { get; init; }

    public required int CorrectCount { get; init; }

    /// <summary>Fases <c>text</c> e <c>code</c>: enviadas, sem corretor. Contam fora da taxa de acerto.</summary>
    public required int PendingCount { get; init; }

    /// <summary>Soma de <c>ElapsedSeconds</c> — o criterio de desempate do podio.</summary>
    public required int TotalElapsedSeconds { get; init; }

    public required IReadOnlyList<MatchSubmissionDocument> Submissions { get; init; }
}

/// <summary>
/// Uma resposta. <b>Nao carrega copia da fase</b> — so o ponteiro para
/// <see cref="MatchPhaseDocument.PhaseId"/> no <c>phases[]</c> irmao, dentro do mesmo documento de
/// partida, mais os dois numeros que permitem montar uma linha de relatorio sem resolver nada.
///
/// A invariante que isto cria: o relatorio resolve <see cref="Answer"/> <b>sempre</b> contra
/// <c>matches.phases[]</c> da mesma partida, e nunca contra <c>phases</c> nem contra o catalogo
/// publicado. <c>optionId</c> e posicional — "o1" quer dizer "o primeiro item de options" —, entao
/// referenciar para fora do documento faria um relatorio de seis meses atras mudar sozinho quando
/// o autor reordenasse as alternativas.
/// </summary>
public sealed record MatchSubmissionDocument
{
    public required Guid PhaseId { get; init; }

    public required int PhaseOrderIndex { get; init; }

    public required int MaxScore { get; init; }

    public required AnswerDto Answer { get; init; }

    public required DateTime SubmittedAt { get; init; }

    public required int ElapsedSeconds { get; init; }

    public DateTime? ReadyAt { get; init; }

    public required GradingStatus Grading { get; init; }

    public bool? Correct { get; init; }

    public int? Score { get; init; }

    public string? Explanation { get; init; }

    public IReadOnlyList<AiSuggestionDto>? AiSuggestions { get; init; }

    public TestsPassedDto? TestsPassed { get; init; }
}
