namespace Codex.Api.Contracts.PhaseSets;

/// <summary>
/// De onde o conjunto vem <b>do ponto de vista de quem esta olhando</b> — nao e um atributo do
/// conjunto. O mesmo PhaseSet e "owned" no perfil do autor e "community" no perfil visto por
/// outra pessoa, que e exatamente o que o front usa para decidir entre "editado ha 2 dias" e
/// "por Prof. Marcos".
/// </summary>
public enum PhaseSetSource
{
    Owned,
    Community,
}

/// <summary>
/// Formato exato de PhaseSetSummary (api-rest.md secao 5), usado tambem em "sets" do
/// GET /users/{userId}/profile.
///
/// UpdatedLabel e AuthorName sao mutuamente exclusivos por construcao: um so aparece em "owned"
/// e o outro so em "community".
/// </summary>
public record PhaseSetSummaryDto(
    Guid Id,
    string Title,
    int PhaseCount,
    PhaseSetSource Source,
    string? UpdatedLabel,
    string? AuthorName);
