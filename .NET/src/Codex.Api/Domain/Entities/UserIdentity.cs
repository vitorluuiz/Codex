using Codex.Api.Domain;

namespace Codex.Api.Domain.Entities;

/// <summary>
/// Vinculo entre uma conta (User) e uma identidade num provedor externo (api-rest.md secao 2,
/// POST /auth/oauth/{provider}/authorize). Tabela separada, e nao colunas em users, porque a
/// mesma conta pode acumular Google, Microsoft e GitHub — e porque o par que identifica a
/// pessoa no provedor (Provider + ProviderUserId) precisa do proprio indice unico.
/// </summary>
public class UserIdentity
{
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public required Guid UserId { get; init; }
    public User? User { get; init; }

    public required OAuthProvider Provider { get; init; }

    /// <summary>Identificador estavel da pessoa no provedor (o <c>sub</c> do OIDC, o <c>id</c> do GitHub). Nunca o email: o email muda, o sub nao.</summary>
    public required string ProviderUserId { get; init; }

    /// <summary>Instantaneo do email no momento do vinculo. Serve para diagnostico; a verdade sobre o email da conta continua em users.</summary>
    public string? Email { get; set; }

    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}
