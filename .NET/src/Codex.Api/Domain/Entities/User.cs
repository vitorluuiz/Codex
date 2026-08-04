namespace Codex.Api.Domain.Entities;

/// <summary>Conta autenticada (ver api-rest.md secao 2). Distinta de Participant, que cobre convidados sem conta.</summary>
public class User
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string Name { get; set; }
    public required string Email { get; set; }

    /// <summary>Null enquanto o usuario so tiver login via OAuth (nao implementado nesta base).</summary>
    public string? PasswordHash { get; set; }

    public int AvatarIndex { get; set; }
    public UserPlan Plan { get; set; } = UserPlan.Free;

    /// <summary>
    /// Publico para quem a pessoa cria partidas (secao 2). Nenhuma rota escreve este campo
    /// ainda: nem o signup nem o PATCH /users/me o aceitam no contrato, entao toda conta nasce
    /// "teacher" ate existir a tela que pergunta.
    /// </summary>
    public Audience Audience { get; set; } = Audience.Teacher;

    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;

    public ICollection<Room> LedRooms { get; init; } = [];
    public ICollection<PhaseSet> PhaseSets { get; init; } = [];
}
