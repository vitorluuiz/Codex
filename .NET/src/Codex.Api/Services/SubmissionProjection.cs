using System.Text.Json;
using Codex.Api.Common.Json;
using Codex.Api.Contracts.Matches;
using Codex.Api.Domain.Entities;

namespace Codex.Api.Services;

/// <summary>
/// A linha de <c>submissions</c> na forma do contrato (secao 8).
///
/// Num lugar so, como <see cref="PhaseProjection"/>, porque tres saidas devolvem a mesma submissao:
/// a resposta do <c>POST …/submissions</c>, o <c>mySubmission</c> do <c>current-phase</c> e o corpo
/// do evento <c>submission.graded</c> quando ele ganhar produtor. Se divergissem, a pessoa que
/// recarregou a pagina veria uma correcao diferente da que acabou de receber.
/// </summary>
public static class SubmissionProjection
{
    public static SubmissionDto ToDto(Submission submission) => new(
        submission.Id,
        submission.RoomQueuePhaseId,
        submission.ParticipantId,
        AnswerDto.Parse(submission.AnswerJson),
        submission.SubmittedAt,
        submission.ElapsedSeconds,
        submission.Grading,
        submission.Correct,
        submission.Score,
        submission.Explanation,
        Deserialize<IReadOnlyList<AiSuggestionDto>>(submission.AiSuggestionsJson),
        Deserialize<TestsPassedDto>(submission.TestsPassedJson));

    /// <summary>
    /// Os dois campos de <c>code</c> sao <c>jsonb</c> e ninguem os escreve ainda (dependem do
    /// corretor de IA e do sandbox). Colunas nulas viram campos nulos; JSON corrompido tambem, em
    /// vez de excecao — a mesma politica de <c>PhaseContent.Parse</c>, pelo mesmo motivo: uma linha
    /// ruim degrada uma submissao, nao a tela da turma inteira.
    /// </summary>
    private static T? Deserialize<T>(string? json) where T : class
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(json, CodexJsonOptions.Create());
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
