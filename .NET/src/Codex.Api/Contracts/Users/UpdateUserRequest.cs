namespace Codex.Api.Contracts.Users;

/// <summary>
/// PATCH /users/me (api-rest.md secao 2) — os campos do dialogo "Editar perfil".
///
/// Como no PATCH /rooms/{code}, null significa "nao mexe" e nao "apaga": o dialogo manda os
/// tres juntos, mas nada no contrato obriga isso, e um PATCH que zera o que nao foi enviado e a
/// forma classica de perder o nome de alguem por causa de um campo esquecido.
///
/// "plan" e "audience" ficam de fora de proposito: o contrato nao os lista como editaveis aqui —
/// plano muda por cobranca, nao por formulario.
/// </summary>
public record UpdateUserRequest(string? Name, string? Email, int? AvatarIndex);
