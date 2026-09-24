using Codex.Api.Contracts.Matches;
using Codex.Api.Domain;
using MongoDB.Bson.Serialization.Attributes;

namespace Codex.Api.Documents;

/// <summary>
/// Um participante numa partida, com as submissoes dele embutidas — <c>migracao-dados.md</c>
/// secao 5.2.
///
/// <b>Por que bucket por participante e nao tudo num documento so:</b> o teto do Mongo e rigido
/// (16 MB) e o pior caso que a aplicacao aceita e 8 conjuntos x 50 fases x 500 participantes =
/// 200.000 submissoes, o que daria 84 bytes por submissao. Aqui o maior documento possivel tem
/// <b>400</b> submissoes — o maximo que <i>uma</i> pessoa consegue enviar —, e o teto e estrutural,
/// nao estatistico.
/// </summary>
public sealed record MatchParticipantDocument
{
    public const int CurrentSchemaVersion = 1;

    [BsonId]
    public required Guid Id { get; init; }

    public int SchemaVersion { get; init; } = CurrentSchemaVersion;

    public required Guid MatchId { get; init; }

    public required Guid ParticipantId { get; init; }

    /// <summary>
    /// <c>null</c> = convidado. O indice <c>{ userId, matchId }</c> <b>e</b> o historico do
    /// jogador — quem entrou sem conta simplesmente nao aparece nele.
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
/// <see cref="MatchPhaseDocument.PhaseId"/> dentro do mesmo documento de partida, mais os dois
/// numeros que permitem montar uma linha de relatorio sem resolver nada.
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
