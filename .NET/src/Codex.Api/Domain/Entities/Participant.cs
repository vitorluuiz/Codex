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

    public ICollection<Submission> Submissions { get; init; } = [];
}
