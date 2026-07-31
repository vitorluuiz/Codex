using Codex.Api.Domain;

namespace Codex.Api.Contracts;

/// <summary>Formato exato de "user" em api-rest.md secao 2.</summary>
public record UserDto(Guid Id, string Name, string Email, int AvatarIndex, UserPlan Plan);
