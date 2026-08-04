using Codex.Api.Domain;

namespace Codex.Api.Contracts;

/// <summary>
/// Formato exato de "user" em api-rest.md secao 2.
///
/// "Email" pode sair vazio no perfil de outra pessoa (secao 2, GET /users/{userId}/profile) —
/// o front so o exibe, nao decide nada com ele.
/// </summary>
public record UserDto(Guid Id, string Name, string Email, int AvatarIndex, UserPlan Plan, Audience Audience);
