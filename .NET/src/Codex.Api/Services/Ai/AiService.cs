using System.Diagnostics;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Ai;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services.Ai;

/// <summary>
/// Orquestra as tres operacoes de IA do editor de conjuntos:
/// <list type="bullet">
///   <item><description><c>POST /ai/phases/generate</c> — gera 1 fase a partir de tipo + topico + dificuldade + notas.</description></item>
///   <item><description><c>POST /ai/phases/variations</c> — gera de 1 a 5 variacoes de uma fase do rascunho.</description></item>
///   <item><description><c>POST /ai/quiz/options/suggest</c> — sugere alternativas para uma fase quiz.</description></item>
/// </list>
/// Nenhuma fase gerada aqui entra em <c>phases</c>: o servidor devolve <see cref="DraftPhaseDto"/>
/// ou <see cref="QuizOptionSuggestionDto"/> para revisao no editor e grava apenas a telemetria/cota
/// em <c>ai_generations</c>.
/// </summary>
public class AiService(
    AppDbContext db,
    AiOptions options,
    AiProviderRouter router,
    AiQuotaService quota,
    IAiInflightLock inflightLock,
    IAiChatClient chatClient,
    ILogger<AiService> logger)
{
    public const int MaxTopicLength = 200;
    public const int MaxNotesLength = 500;
    public const int MaxVariationsCount = 5;
    public const int MaxQuizSuggestionsCount = 6;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public async Task<AiUsageDto> GetUsageAsync(
        ClaimsPrincipal principal,
        CancellationToken ct,
        DateTimeOffset? now = null)
    {
        var user = await RequireUserAsync(principal, ct);
        return await quota.GetUsageAsync(user, ct, now);
    }

    public async Task<AiPhaseResponse> GeneratePhaseAsync(
        GeneratePhaseRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct,
        DateTimeOffset? now = null)
    {
        var user = await RequireUserAsync(principal, ct);

        var topic = request.Topic?.Trim();
        if (string.IsNullOrEmpty(topic) || topic.Length > MaxTopicLength)
        {
            throw Validation($"topic deve ter entre 1 e {MaxTopicLength} caracteres.");
        }

        var notes = request.Notes?.Trim();
        if (notes is { Length: > MaxNotesLength })
        {
            throw Validation($"notes deve ter no maximo {MaxNotesLength} caracteres.");
        }

        var normalizedRequest = request with
        {
            Topic = topic,
            Notes = string.IsNullOrEmpty(notes) ? null : notes,
        };

        await using var _ = await inflightLock.AcquireAsync(user.Id, ct);

        var (providerName, provider) = router.Resolve(user.Plan);
        var cost = Math.Max(0, options.Costs.Phase);
        var currentUsage = await quota.EnsureAvailableAsync(user, AiOperation.Phase, cost, ct, now);

        var systemPrompt = AiPrompts.BuildPhaseSystemPrompt(normalizedRequest.Kind);
        var userPrompt = AiPrompts.BuildGeneratePhaseUserPrompt(normalizedRequest);
        var schema = AiSchemas.ForPhase(normalizedRequest.Kind);
        var inputJson = JsonSerializer.Serialize(normalizedRequest, JsonOptions);

        var (phase, generation) = await ExecuteAndRecordAsync<DraftPhaseDto>(
            user: user,
            operation: AiOperation.Phase,
            kind: normalizedRequest.Kind,
            cost: cost,
            inputJson: inputJson,
            initialProviderName: providerName,
            initialProvider: provider,
            systemPrompt: systemPrompt,
            userPrompt: userPrompt,
            schema: schema,
            parseAndValidate: json => AiPhaseMapper.MapAndValidatePhase(json, normalizedRequest.Kind),
            serializeResult: dto => JsonSerializer.Serialize(dto, JsonOptions),
            now: now,
            ct: ct);

        return new AiPhaseResponse(
            GenerationId: generation.Id,
            Phase: phase,
            Usage: currentUsage.After(cost));
    }

    public async Task<AiVariationsResponse> GenerateVariationsAsync(
        GenerateVariationsRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct,
        DateTimeOffset? now = null)
    {
        var user = await RequireUserAsync(principal, ct);

        if (request.Source is null)
        {
            throw Validation("source e obrigatorio.");
        }

        var sourceQuestion = request.Source.Question?.Trim();
        if (string.IsNullOrEmpty(sourceQuestion) || sourceQuestion.Length > PhaseLimits.MaxQuestionLength)
        {
            throw Validation($"source.question deve ter entre 1 e {PhaseLimits.MaxQuestionLength} caracteres.");
        }

        var varOptions = request.Options ?? new AiVariationOptions();
        if (varOptions.Count is < 1 or > MaxVariationsCount)
        {
            throw Validation($"options.count deve estar entre 1 e {MaxVariationsCount}.");
        }

        var notes = varOptions.Notes?.Trim();
        if (notes is { Length: > MaxNotesLength })
        {
            throw Validation($"options.notes deve ter no maximo {MaxNotesLength} caracteres.");
        }

        var normalizedOptions = varOptions with
        {
            Notes = string.IsNullOrEmpty(notes) ? null : notes,
        };

        await using var _ = await inflightLock.AcquireAsync(user.Id, ct);

        var (providerName, provider) = router.Resolve(user.Plan);
        var baseVariationCost = Math.Max(0, options.Costs.Variation);
        var cost = normalizedOptions.Count <= 3 ? baseVariationCost : baseVariationCost * 2;

        var currentUsage = await quota.EnsureAvailableAsync(user, AiOperation.Variations, cost, ct, now);

        var systemPrompt = AiPrompts.BuildVariationsSystemPrompt(request.Source.Kind, normalizedOptions.Count);
        var userPrompt = AiPrompts.BuildVariationsUserPrompt(request.Source, normalizedOptions);
        var schema = AiSchemas.ForVariations(request.Source.Kind, normalizedOptions.Count);
        var inputJson = JsonSerializer.Serialize(new
        {
            sourceId = request.Source.Id,
            kind = request.Source.Kind.ToString().ToLowerInvariant(),
            options = normalizedOptions,
        }, JsonOptions);

        var ((phases, discarded), generation) = await ExecuteAndRecordAsync<(IReadOnlyList<DraftPhaseDto> Phases, int Discarded)>(
            user: user,
            operation: AiOperation.Variations,
            kind: request.Source.Kind,
            cost: cost,
            inputJson: inputJson,
            initialProviderName: providerName,
            initialProvider: provider,
            systemPrompt: systemPrompt,
            userPrompt: userPrompt,
            schema: schema,
            parseAndValidate: json => AiPhaseMapper.MapAndValidateVariations(json, request.Source, normalizedOptions),
            serializeResult: tuple => JsonSerializer.Serialize(new { phases = tuple.Phases, discarded = tuple.Discarded }, JsonOptions),
            now: now,
            ct: ct);

        return new AiVariationsResponse(
            GenerationId: generation.Id,
            Phases: phases,
            Discarded: discarded,
            Usage: currentUsage.After(cost));
    }

    public async Task<AiQuizOptionsResponse> SuggestQuizOptionsAsync(
        SuggestQuizOptionsRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct,
        DateTimeOffset? now = null)
    {
        var user = await RequireUserAsync(principal, ct);

        var question = request.Question?.Trim();
        if (string.IsNullOrEmpty(question) || question.Length > PhaseLimits.MaxQuestionLength)
        {
            throw Validation($"question deve ter entre 1 e {PhaseLimits.MaxQuestionLength} caracteres.");
        }

        if (request.Count is < 1 or > MaxQuizSuggestionsCount)
        {
            throw Validation($"count deve estar entre 1 e {MaxQuizSuggestionsCount}.");
        }

        if (request.Options is { Count: > PhaseDraftValidator.MaxOptions })
        {
            throw Validation($"options aceita no maximo {PhaseDraftValidator.MaxOptions} alternativas.");
        }

        if (request.Options is not null &&
            request.Options.Any(o => o is not null && o.Length > PhaseLimits.MaxOptionLength))
        {
            throw Validation($"options aceita no maximo {PhaseLimits.MaxOptionLength} caracteres por alternativa.");
        }

        await using var _ = await inflightLock.AcquireAsync(user.Id, ct);

        var (providerName, provider) = router.Resolve(user.Plan);
        var cost = Math.Max(0, options.Costs.QuizOptions);
        var currentUsage = await quota.EnsureAvailableAsync(user, AiOperation.QuizOptions, cost, ct, now);

        var systemPrompt = AiPrompts.BuildQuizOptionsSystemPrompt();
        var userPrompt = AiPrompts.BuildQuizOptionsUserPrompt(request);
        var schema = AiSchemas.ForQuizOptions(request.Count);
        var inputJson = JsonSerializer.Serialize(new
        {
            questionLength = question.Length,
            existingOptionsCount = request.Options?.Count ?? 0,
            count = request.Count,
            mode = request.Mode.ToString().ToLowerInvariant(),
        }, JsonOptions);

        var (suggestions, generation) = await ExecuteAndRecordAsync<IReadOnlyList<QuizOptionSuggestionDto>>(
            user: user,
            operation: AiOperation.QuizOptions,
            kind: PhaseKind.Quiz,
            cost: cost,
            inputJson: inputJson,
            initialProviderName: providerName,
            initialProvider: provider,
            systemPrompt: systemPrompt,
            userPrompt: userPrompt,
            schema: schema,
            parseAndValidate: json => AiPhaseMapper.MapAndValidateQuizOptions(json, request),
            serializeResult: list => JsonSerializer.Serialize(new { suggestions = list }, JsonOptions),
            now: now,
            ct: ct);

        return new AiQuizOptionsResponse(
            GenerationId: generation.Id,
            Suggestions: suggestions,
            Usage: currentUsage.After(cost, suggestionsDelta: 1));
    }

    public async Task RecordDecisionAsync(
        Guid generationId,
        AiDecisionRequest request,
        ClaimsPrincipal principal,
        CancellationToken ct,
        DateTimeOffset? now = null)
    {
        var user = await RequireUserAsync(principal, ct);

        if (request.AcceptedCount is < 0)
        {
            throw Validation("acceptedCount nao pode ser negativo.");
        }

        var generation = await db.AiGenerations
            .FirstOrDefaultAsync(g => g.Id == generationId && g.UserId == user.Id, ct);

        if (generation is null)
        {
            throw new ApiException(
                StatusCodes.Status404NotFound,
                ErrorCodes.AiGenerationNotFound,
                "Geracao de IA nao encontrada.");
        }

        generation.Decision = request.Decision;
        generation.DecidedAt = now ?? DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);
    }

    private async Task<(T Result, AiGeneration Generation)> ExecuteAndRecordAsync<T>(
        User user,
        AiOperation operation,
        PhaseKind kind,
        int cost,
        string inputJson,
        string initialProviderName,
        AiProviderOptions initialProvider,
        string systemPrompt,
        string userPrompt,
        JsonObject schema,
        Func<string, T> parseAndValidate,
        Func<T, string> serializeResult,
        DateTimeOffset? now,
        CancellationToken ct)
    {
        var activeProviderName = initialProviderName;
        var activeProvider = initialProvider;
        var sw = Stopwatch.StartNew();

        try
        {
            var (parsed, chatResult, usedName, usedProvider) = await CallWithRetryAsync(
                activeProviderName,
                activeProvider,
                systemPrompt,
                userPrompt,
                schema,
                parseAndValidate,
                ct);

            var generation = new AiGeneration
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Operation = operation,
                Kind = kind,
                Provider = usedName,
                Model = usedProvider.Model,
                Status = AiGenerationStatus.Succeeded,
                Cost = cost,
                PromptTokens = chatResult.PromptTokens,
                CompletionTokens = chatResult.CompletionTokens,
                LatencyMs = chatResult.LatencyMs,
                InputJson = inputJson,
                OutputJson = serializeResult(parsed),
                CreatedAt = now ?? DateTimeOffset.UtcNow,
            };

            db.AiGenerations.Add(generation);
            await db.SaveChangesAsync(ct);

            return (parsed, generation);
        }
        catch (Exception ex) when (ex is AiProviderUnavailableException or AiProviderBusyException or ApiException)
        {
            sw.Stop();
            var apiEx = MapProviderException(ex);

            var failedGeneration = new AiGeneration
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Operation = operation,
                Kind = kind,
                Provider = activeProviderName,
                Model = activeProvider.Model,
                Status = AiGenerationStatus.Failed,
                Cost = 0,
                LatencyMs = (int)sw.ElapsedMilliseconds,
                ErrorCode = apiEx.Code,
                InputJson = inputJson,
                CreatedAt = now ?? DateTimeOffset.UtcNow,
            };

            db.AiGenerations.Add(failedGeneration);
            await db.SaveChangesAsync(ct);

            throw apiEx;
        }
    }

    private async Task<(T Parsed, AiChatResult ChatResult, string ProviderName, AiProviderOptions Provider)> CallWithRetryAsync<T>(
        string providerName,
        AiProviderOptions provider,
        string systemPrompt,
        string userPrompt,
        JsonObject schema,
        Func<string, T> parseAndValidate,
        CancellationToken ct)
    {
        var currentName = providerName;
        var currentProvider = provider;
        var currentPrompt = userPrompt;
        Exception? lastValidationError = null;

        for (var attempt = 0; attempt < 2; attempt++)
        {
            AiChatResult chatResult;
            try
            {
                await using var _ = await router.AcquireSlotAsync(currentName, currentProvider, ct);
                chatResult = await chatClient.CompleteJsonAsync(currentProvider, systemPrompt, currentPrompt, schema, ct);
            }
            catch (Exception ex) when (ex is AiProviderUnavailableException or AiProviderBusyException)
            {
                if (router.TryGetFallback(currentName, out var fallbackName, out var fallbackProvider))
                {
                    logger.LogWarning(
                        ex,
                        "Provedor de IA '{Provider}' indisponivel; recorrendo ao fallback '{Fallback}'.",
                        currentName,
                        fallbackName);

                    currentName = fallbackName;
                    currentProvider = fallbackProvider;

                    await using var _ = await router.AcquireSlotAsync(currentName, currentProvider, ct);
                    chatResult = await chatClient.CompleteJsonAsync(currentProvider, systemPrompt, currentPrompt, schema, ct);
                }
                else
                {
                    throw;
                }
            }

            try
            {
                var parsed = parseAndValidate(chatResult.Json);
                return (parsed, chatResult, currentName, currentProvider);
            }
            catch (ApiException ex) when (ex.Code is ErrorCodes.AiInvalidOutput or ErrorCodes.ValidationError)
            {
                lastValidationError = ex;
                logger.LogWarning(
                    "Saida do modelo falhou na validacao (tentativa {Attempt}/2): {Message}",
                    attempt + 1,
                    ex.Message);

                currentPrompt = $"{userPrompt}\n\nATENCAO: Sua resposta anterior falhou na validacao pelo seguinte motivo: {ex.Message}\nCorrija o JSON para respeitar estritamente todas as regras.";
            }
        }

        throw new ApiException(
            StatusCodes.Status502BadGateway,
            ErrorCodes.AiInvalidOutput,
            lastValidationError?.Message ?? "O modelo de IA retornou uma resposta invalida apos nova tentativa.");
    }

    private async Task<User> RequireUserAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = principal.GetUserId() ?? throw AccountRequired();
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);
        return user ?? throw AccountRequired();
    }

    private static ApiException MapProviderException(Exception ex) => ex switch
    {
        ApiException apiEx => apiEx,
        AiProviderBusyException busy => new ApiException(
            StatusCodes.Status503ServiceUnavailable,
            ErrorCodes.AiBusy,
            busy.Message),
        AiProviderUnavailableException unavail => new ApiException(
            StatusCodes.Status503ServiceUnavailable,
            ErrorCodes.AiProviderUnavailable,
            unavail.Message),
        _ => new ApiException(
            StatusCodes.Status503ServiceUnavailable,
            ErrorCodes.AiProviderUnavailable,
            "Nao foi possivel concluir a solicitacao ao provedor de IA."),
    };

    private static ApiException AccountRequired() => new(
        StatusCodes.Status403Forbidden,
        ErrorCodes.AccountRequired,
        "E preciso ter uma conta para usar recursos de IA.");

    private static ApiException Validation(string message) => new(
        StatusCodes.Status400BadRequest,
        ErrorCodes.ValidationError,
        message);
}
