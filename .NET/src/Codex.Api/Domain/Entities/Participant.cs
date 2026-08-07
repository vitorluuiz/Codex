namespace Codex.Api.Domain.Entities;

/// <summary>api-rest.md secao 3-4. Cobre tanto o aluno convidado (UserId nulo) quanto o aluno logado.</summary>
public class Participant
{
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public Guid RoomId { get; set; }
    public Room Room { get; init; } = null!;

    public required string DisplayName { get; set; }

    /// <summary>
    /// Coluna gerada pelo banco (lower(DisplayName)). Existe unicamente para sustentar o indice
    /// unico de nome por sala sem diferenciar maiusculas — nenhum codigo le este valor.
    /// </summary>
    public string DisplayNameNormalized { get; private set; } = string.Empty;

    public int AvatarIndex { get; set; }
    public bool LoggedIn { get; set; }

    public Guid? UserId { get; set; }
    public User? User { get; init; }

    public ParticipantStatus Status { get; set; } = ParticipantStatus.Pending;
    public DateTimeOffset JoinedAt { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>
    /// Desde quando esta pessoa esta na <b>tela de resultados</b> de uma partida encerrada, e ainda
    /// nao voltou ao lobby. <c>null</c> = esta no lobby (ou nunca jogou).
    ///
    /// Marcado para todos os aprovados quando a partida encerra, e limpo por
    /// <c>POST /rooms/{code}/participants/me/return</c> — o "Continuar jogando" do podio. Existe
    /// porque encerrar a partida deixou de arrastar a turma de volta: cada um decide quando sair do
    /// podio, e o lobby precisa mostrar ao lider quem ainda nao voltou.
    ///
    /// <b>Nao e so um adorno de tela.</b> Quem esta aqui nao conta como jogador
    /// (<see cref="Codex.Api.Services.MatchStatsService.CountPlayersAsync"/>): sem isso, uma aba
    /// esquecida no podio entraria no <c>totalPlayers</c> da partida seguinte e a regra "todos
    /// enviaram" nunca fecharia uma fase — exatamente o defeito que este campo veio consertar, um
    /// nivel acima.
    /// </summary>
    public DateTimeOffset? InResultsSince { get; set; }

    public ICollection<Submission> Submissions { get; init; } = [];
}
