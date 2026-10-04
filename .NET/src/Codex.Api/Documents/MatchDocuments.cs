using Codex.Api.Contracts.Matches;
using Codex.Api.Domain;
using Codex.Api.Services;
using MongoDB.Bson.Serialization.Attributes;

namespace Codex.Api.Documents;

/// <summary>
/// A partida finalizada, como ela e guardada — <c>migracao-dados.md</c> secao 5.1.
///
/// <b>Autossuficiente de proposito.</b> Nada aqui aponta para uma sala, uma fila ou uma fase da
/// biblioteca: e isso que permite a sala ser efemera (secao 8.1 do mesmo documento). As unicas
/// referencias para fora sao <see cref="LeaderUserId"/> e o <c>UserId</c> de cada participante,
/// que apontam para <c>users</c> no Postgres — e sao <i>linhagem</i>, nao FK: apagar a conta nao
/// pode apagar a partida que a turma jogou.
///
/// <b>Datas sao <see cref="DateTime"/> em UTC</b>, e nao <c>DateTimeOffset</c>: o BSON nao tem
/// tipo com offset, e todo instante do sistema ja nasce de <c>DateTimeOffset.UtcNow</c>. Guardar
/// o par [ticks, offset] que o driver usaria por padrao tornaria <c>sort({ finishedAt: -1 })</c>
/// uma ordenacao sobre array.
/// </summary>
public sealed record MatchDocument
{
    /// <summary>Versao do formato. Existe desde a primeira linha para uma mudanca futura nao ter que adivinhar.</summary>
    public const int CurrentSchemaVersion = 1;

    [BsonId]
    public required Guid Id { get; init; }

    public int SchemaVersion { get; init; } = CurrentSchemaVersion;

    public required string RoomCode { get; init; }

    /// <summary>Linhagem. A sala pode nao existir mais — e normalmente nao existe.</summary>
    public required Guid RoomId { get; init; }

    public required Guid LeaderUserId { get; init; }

    public required MatchMode Mode { get; init; }

    public required DateTime StartedAt { get; init; }

    public required DateTime FinishedAt { get; init; }

    public required IReadOnlyList<MatchPhaseSetDocument> PhaseSets { get; init; }

    public required IReadOnlyList<MatchPhaseDocument> Phases { get; init; }

    public required MatchStatsDocument Stats { get; init; }
}

/// <summary>Um conjunto que estava na fila quando a partida rodou. O <c>SetTitle</c> do historico sai daqui.</summary>
public sealed record MatchPhaseSetDocument
{
    public required Guid QueueSetId { get; init; }

    /// <summary>O conjunto da biblioteca de onde esta copia veio. Sem FK, como sempre foi.</summary>
    public required Guid SourcePhaseSetId { get; init; }

    public required string Title { get; init; }

    public required string Color { get; init; }

    public required int OrderIndex { get; init; }
}

/// <summary>
/// Uma fase jogada, congelada com gabarito. <b>E a unica copia do conteudo no documento</b>: a
/// submissao guarda so um ponteiro para <see cref="PhaseId"/> (secao 5.4).
/// </summary>
public sealed record MatchPhaseDocument
{
    public required Guid PhaseId { get; init; }

    public required Guid QueueSetId { get; init; }

    public required Guid SourcePhaseId { get; init; }

    public required int OrderIndex { get; init; }

    public required PhaseKind Kind { get; init; }

    public required string Name { get; init; }

    public required int BasePoints { get; init; }

    public required decimal PointsMultiplier { get; init; }

    public required int TimeSeconds { get; init; }

    /// <summary>
    /// A nota maxima desta fase, de <see cref="PhaseGrading.MaxScore"/> — acerto total com bonus
    /// de tempo cheio. Fica gravada para o relatorio nao ter que refazer a conta com uma formula
    /// que pode ter mudado desde entao.
    /// </summary>
    public required int MaxScore { get; init; }

    /// <summary>
    /// O mesmo <see cref="PhaseContent"/> que o Postgres guarda em <c>ContentJson</c> — copia, nao
    /// traducao. E o que faz o relatorio resolver um <c>optionId</c> posicional contra o array de
    /// opcoes exato contra o qual a pessoa respondeu.
    /// </summary>
    public required PhaseContent Content { get; init; }
}

/// <summary>
/// Os agregados da partida. <b>Calculados uma vez, no commit</b>, do mesmo payload em memoria que
/// gera os documentos de participante — nunca recalculados, nunca corrigidos por um <c>$set</c>.
/// Sao uma copia denormalizada de numeros cuja fonte e <c>match_participants</c>, e existem porque
/// <c>LeaderMatchSummaryDto</c> nao tem nenhum campo por participante alem da contagem: assim uma
/// leitura de <c>matches</c> resolve a tela de historico inteira.
/// </summary>
public sealed record MatchStatsDocument
{
    public required int ParticipantCount { get; init; }

    /// <summary>Media <b>por pessoa aprovada</b>, com zero explicito para quem nao pontuou — a mesma de <c>MatchStatsService.MatchTotalsAsync</c>.</summary>
    public required int AvgScore { get; init; }

    /// <summary>A maior pontuacao possivel na partida: a soma dos <c>MaxScore</c> das fases.</summary>
    public required int MaxScore { get; init; }

    /// <summary>Sobre o que foi <b>corrigido</b>, nao sobre o que foi enviado: um <c>text</c> pendente nao conta como erro.</summary>
    public required int AccuracyRate { get; init; }

    /// <summary>Por fase, na ordem de <c>Phases</c>. <c>null</c> = ninguem respondeu, ou nada foi corrigido.</summary>
    public required IReadOnlyList<int?> PhaseAccuracy { get; init; }

    public required IReadOnlyList<int?> PhaseAvgScore { get; init; }
}
