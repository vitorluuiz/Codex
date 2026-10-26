using System.Security.Claims;
using System.Text.Json.Nodes;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Ai;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.Ai;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Codex.Api.Tests;

public class AiServiceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    [Fact]
    public async Task Generates_quiz_phase_normalizes_duplicates_and_reindexes_correct_answers()
    {
        var ctx = new AiTestContext();

        // Inclui alternativa vazia no indice 0 e duplicada no indice 2; a correta original era o indice 3 ("4")
        ctx.ChatClient.Enqueue("""
        {
          "name": "  Soma basica  ",
          "question": "Quanto e 2 + 2?",
          "basePoints": 500,
          "timeSeconds": 45,
          "pointsMultiplier": 1.0,
          "introTip": "  Some os dois inteiros  ",
          "options": ["  ", "3", "3", "4", "5"],
          "correctIndexes": [3]
        }
        """);

        var response = await ctx.Ai.GeneratePhaseAsync(
            new GeneratePhaseRequest(PhaseKind.Quiz, "Aritmetica basica", AiDifficulty.Easy, "Foco em soma"),
            ctx.AsUser,
            Ct);

        Assert.Equal(PhaseKind.Quiz, response.Phase.Kind);
        Assert.True(response.Phase.FromAI);
        Assert.Equal("Soma basica", response.Phase.Name);
        Assert.Equal("Some os dois inteiros", response.Phase.IntroTip);
        Assert.Equal(["3", "4", "5"], response.Phase.Options);
        // "4" passou do indice 3 para o indice 1 apos remover vazio e duplicado
        Assert.Equal([1], response.Phase.CorrectIndexes);
        Assert.Equal(1, response.Usage.CreditsUsed);

        var gen = await ctx.Db.AiGenerations.SingleAsync(Ct);
        Assert.Equal(AiGenerationStatus.Succeeded, gen.Status);
        Assert.Equal(AiOperation.Phase, gen.Operation);
        Assert.Equal(1, gen.Cost);
    }

    [Fact]
    public async Task Generates_fill_text_and_code_phases_with_expected_normalizations()
    {
        var ctx = new AiTestContext();

        // Fill: modelo esqueceu de incluir " Fotossintese " em words; mapper deve incluir automaticamente
        ctx.ChatClient.Enqueue("""
        {
          "name": "Biologia vegetal",
          "question": "As plantas realizam ___ usando luz ___.",
          "basePoints": 600,
          "timeSeconds": 60,
          "pointsMultiplier": 1.5,
          "introTip": "",
          "words": ["solar", "lunar", "respiracao"],
          "blanks": ["fotossintese", "solar"]
        }
        """);

        var fillResp = await ctx.Ai.GeneratePhaseAsync(
            new GeneratePhaseRequest(PhaseKind.Fill, "Fotossintese"),
            ctx.AsUser,
            Ct);

        Assert.Equal(PhaseKind.Fill, fillResp.Phase.Kind);
        Assert.Equal(["fotossintese", "solar"], fillResp.Phase.Blanks);
        Assert.Contains("fotossintese", fillResp.Phase.Words!);
        Assert.Contains("solar", fillResp.Phase.Words!);
        Assert.Null(fillResp.Phase.IntroTip);

        // Text
        ctx.ChatClient.Enqueue("""
        {
          "name": "Conceito de HTTP",
          "question": "O que significa ser um protocolo stateless?",
          "basePoints": 500,
          "timeSeconds": 90,
          "pointsMultiplier": 1.0,
          "introTip": "",
          "expectedAnswer": "Cada requisicao e independente e o servidor nao guarda estado de sessao entre elas."
        }
        """);

        var textResp = await ctx.Ai.GeneratePhaseAsync(
            new GeneratePhaseRequest(PhaseKind.Text, "Protocolo HTTP"),
            ctx.AsUser,
            Ct);

        Assert.Equal(PhaseKind.Text, textResp.Phase.Kind);
        Assert.StartsWith("Cada requisicao", textResp.Phase.ExpectedAnswer);

        // Code: testCases deve sair string vazia ""
        ctx.ChatClient.Enqueue("""
        {
          "name": "Soma de vetor",
          "question": "Implemente a funcao soma(nums) que retorna a soma dos elementos.",
          "basePoints": 1000,
          "timeSeconds": 180,
          "pointsMultiplier": 1.0,
          "introTip": "",
          "starterCode": "function soma(nums) {\n  // seu codigo aqui\n}"
        }
        """);

        var codeResp = await ctx.Ai.GeneratePhaseAsync(
            new GeneratePhaseRequest(PhaseKind.Code, "Arrays em JS"),
            ctx.AsUser,
            Ct);

        Assert.Equal(PhaseKind.Code, codeResp.Phase.Kind);
        Assert.Contains("// seu codigo aqui", codeResp.Phase.StarterCode);
        Assert.Equal(string.Empty, codeResp.Phase.TestCases);
    }

    [Fact]
    public async Task Retries_once_with_validation_feedback_when_first_model_response_is_invalid()
    {
        var ctx = new AiTestContext();

        // Tentativa 1 invalida: todas as alternativas marcadas como corretas
        ctx.ChatClient.Enqueue("""
        {
          "name": "Quiz invalido",
          "question": "Qual destas e uma linguagem?",
          "basePoints": 500,
          "timeSeconds": 45,
          "pointsMultiplier": 1.0,
          "introTip": "",
          "options": ["C#", "Python"],
          "correctIndexes": [0, 1]
        }
        """);

        // Tentativa 2 corrigida pelo modelo
        ctx.ChatClient.Enqueue("""
        {
          "name": "Quiz corrigido",
          "question": "Qual destas linguagens roda nativamente no CLR (.NET)?",
          "basePoints": 500,
          "timeSeconds": 45,
          "pointsMultiplier": 1.0,
          "introTip": "",
          "options": ["C#", "HTML", "CSS"],
          "correctIndexes": [0]
        }
        """);

        var response = await ctx.Ai.GeneratePhaseAsync(
            new GeneratePhaseRequest(PhaseKind.Quiz, "Plataforma .NET"),
            ctx.AsUser,
            Ct);

        Assert.Equal("Quiz corrigido", response.Phase.Name);
        Assert.Equal(2, ctx.ChatClient.Calls.Count);
        Assert.Contains("ATENCAO: Sua resposta anterior falhou na validacao", ctx.ChatClient.Calls[1].UserPrompt);
    }

    [Fact]
    public async Task Records_failed_generation_with_zero_cost_when_retry_also_fails()
    {
        var ctx = new AiTestContext();

        ctx.ChatClient.Enqueue("""{"invalid": true}""");
        ctx.ChatClient.Enqueue("""{"invalid": true}""");

        var ex = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Ai.GeneratePhaseAsync(new GeneratePhaseRequest(PhaseKind.Quiz, "Topico"), ctx.AsUser, Ct));

        Assert.Equal(502, ex.StatusCode);
        Assert.Equal(ErrorCodes.AiInvalidOutput, ex.Code);

        var gen = await ctx.Db.AiGenerations.SingleAsync(Ct);
        Assert.Equal(AiGenerationStatus.Failed, gen.Status);
        Assert.Equal(0, gen.Cost);
        Assert.Equal(ErrorCodes.AiInvalidOutput, gen.ErrorCode);
    }

    [Fact]
    public async Task Uses_fallback_provider_when_primary_provider_is_unavailable()
    {
        var options = new AiOptions
        {
            FallbackProvider = "cloud",
        };
        options.Providers["cloud"].ApiKey = "gemini-test-key";

        var ctx = new AiTestContext(options);

        ctx.ChatClient.EnqueueException(new AiProviderUnavailableException("LM Studio offline"));
        ctx.ChatClient.Enqueue("""
        {
          "name": "Fase via fallback",
          "question": "O que e polimorfismo?",
          "basePoints": 500,
          "timeSeconds": 60,
          "pointsMultiplier": 1.0,
          "introTip": "",
          "expectedAnswer": "Capacidade de objetos de diferentes classes responderem a mesma mensagem."
        }
        """);

        var response = await ctx.Ai.GeneratePhaseAsync(
            new GeneratePhaseRequest(PhaseKind.Text, "POO"),
            ctx.AsUser,
            Ct);

        Assert.Equal("Fase via fallback", response.Phase.Name);
        var gen = await ctx.Db.AiGenerations.SingleAsync(Ct);
        Assert.Equal("cloud", gen.Provider);
        Assert.Equal("gemini-2.5-flash", gen.Model);
    }

    [Fact]
    public async Task Generates_variations_keeping_source_settings_and_counting_partial_discards()
    {
        var ctx = new AiTestContext();

        // 3 variacoes: 2 validas e 1 invalida (enunciado em branco)
        ctx.ChatClient.Enqueue("""
        {
          "phases": [
            {
              "name": "Variacao 1",
              "question": "Quanto e 3 + 5?",
              "basePoints": 100,
              "timeSeconds": 10,
              "pointsMultiplier": 1.0,
              "introTip": "",
              "options": ["7", "8", "9"],
              "correctIndexes": [1]
            },
            {
              "name": "Variacao quebrada",
              "question": "   ",
              "basePoints": 100,
              "timeSeconds": 10,
              "pointsMultiplier": 1.0,
              "introTip": "",
              "options": ["1"],
              "correctIndexes": [0]
            },
            {
              "name": "Variacao 2",
              "question": "Quanto e 6 + 4?",
              "basePoints": 100,
              "timeSeconds": 10,
              "pointsMultiplier": 1.0,
              "introTip": "",
              "options": ["9", "10", "11"],
              "correctIndexes": [1]
            }
          ]
        }
        """);

        var source = new DraftPhaseDto(
            Id: "src-1",
            Kind: PhaseKind.Quiz,
            Name: "Original",
            BasePoints: 750,
            PointsMultiplier: 1.5m,
            TimeSeconds: 90,
            FromAI: false,
            Question: "Quanto e 2 + 2?",
            Options: ["3", "4", "5"],
            CorrectIndexes: [1],
            Theme: "cyberpunk",
            IntroSeconds: 5);

        var varResp = await ctx.Ai.GenerateVariationsAsync(
            new GenerateVariationsRequest(
                source,
                new AiVariationOptions(Count: 4, KeepSettings: true, Difficulty: AiDifficultyShift.Harder)),
            ctx.AsUser,
            Ct);

        Assert.Equal(2, varResp.Phases.Count);
        Assert.Equal(1, varResp.Discarded);
        // Count = 4 (> 3) custa 2 creditos
        Assert.Equal(2, varResp.Usage.CreditsUsed);

        // KeepSettings = true deve preservar BasePoints, TimeSeconds, PointsMultiplier, Theme e IntroSeconds da fonte
        Assert.All(varResp.Phases, p =>
        {
            Assert.Equal(750, p.BasePoints);
            Assert.Equal(90, p.TimeSeconds);
            Assert.Equal(1.5m, p.PointsMultiplier);
            Assert.Equal("cyberpunk", p.Theme);
            Assert.Equal(5, p.IntroSeconds);
            Assert.True(p.FromAI);
        });
    }

    [Fact]
    public async Task Suggests_quiz_options_filtering_existing_and_enforcing_mode()
    {
        var ctx = new AiTestContext();

        ctx.ChatClient.Enqueue("""
        {
          "suggestions": [
            { "label": "Paris", "isCorrect": false, "rationale": "Ja existe na fase, deve ser filtrada" },
            { "label": "Lyon", "isCorrect": true, "rationale": "Segunda maior area urbana da Franca" },
            { "label": "Marselha", "isCorrect": false, "rationale": "Importante cidade portuaria francesa" }
          ]
        }
        """);

        var result = await ctx.Ai.SuggestQuizOptionsAsync(
            new SuggestQuizOptionsRequest(
                Question: "Qual e a capital da Franca?",
                Options: ["Paris", "Berlim"],
                CorrectIndexes: [0],
                Count: 3,
                Mode: QuizSuggestionMode.Distractors),
            ctx.AsUser,
            Ct);

        Assert.Equal(2, result.Suggestions.Count);
        Assert.DoesNotContain(result.Suggestions, s => s.Label == "Paris");
        // No modo Distractors, todas as sugestoes devem sair com IsCorrect = false mesmo que o modelo mande true
        Assert.All(result.Suggestions, s => Assert.False(s.IsCorrect));
        Assert.Equal(0, result.Usage.CreditsUsed);
        Assert.Equal(1, result.Usage.SuggestionsUsedToday);
    }

    [Fact]
    public async Task Records_user_decision_and_prevents_access_to_other_users_generation()
    {
        var ctx = new AiTestContext();
        ctx.ChatClient.Enqueue("""
        {
          "name": "Fase",
          "question": "Pergunta?",
          "basePoints": 500,
          "timeSeconds": 60,
          "pointsMultiplier": 1.0,
          "introTip": "",
          "expectedAnswer": "Resposta."
        }
        """);

        var generated = await ctx.Ai.GeneratePhaseAsync(
            new GeneratePhaseRequest(PhaseKind.Text, "Topico"),
            ctx.AsUser,
            Ct);

        await ctx.Ai.RecordDecisionAsync(
            generated.GenerationId,
            new AiDecisionRequest(AiDecision.Accepted, AcceptedCount: 1),
            ctx.AsUser,
            Ct);

        var saved = await ctx.Db.AiGenerations.SingleAsync(Ct);
        Assert.Equal(AiDecision.Accepted, saved.Decision);
        Assert.NotNull(saved.DecidedAt);

        var otherPrincipal = new ClaimsPrincipal(
            new ClaimsIdentity([new Claim(CodexClaimTypes.UserId, ctx.OtherUser.Id.ToString())], "test"));

        var notFound = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Ai.RecordDecisionAsync(
                generated.GenerationId,
                new AiDecisionRequest(AiDecision.Discarded),
                otherPrincipal,
                Ct));

        Assert.Equal(404, notFound.StatusCode);
        Assert.Equal(ErrorCodes.AiGenerationNotFound, notFound.Code);
    }

    [Fact]
    public async Task Rejects_second_concurrent_generation_for_same_user_with_AiBusy()
    {
        var ctx = new AiTestContext();
        await using var lease = await ctx.InflightLock.AcquireAsync(ctx.User.Id, Ct);

        var ex = await Assert.ThrowsAsync<ApiException>(() =>
            ctx.Ai.GeneratePhaseAsync(new GeneratePhaseRequest(PhaseKind.Text, "Concorrencia"), ctx.AsUser, Ct));

        Assert.Equal(429, ex.StatusCode);
        Assert.Equal(ErrorCodes.AiBusy, ex.Code);
    }

    private sealed class AiTestContext
    {
        public AppDbContext Db { get; }
        public User User { get; }
        public User OtherUser { get; }
        public ClaimsPrincipal AsUser { get; }
        public FakeAiChatClient ChatClient { get; } = new();
        public InMemoryAiInflightLock InflightLock { get; }
        public AiService Ai { get; }

        public AiTestContext(AiOptions? customOptions = null)
        {
            var dbOptions = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;
            Db = new AppDbContext(dbOptions);

            User = new User
            {
                Id = Guid.NewGuid(),
                Name = "Prof. Lucas",
                Email = "lucas@escola.br",
                Plan = UserPlan.Free,
            };
            OtherUser = new User
            {
                Id = Guid.NewGuid(),
                Name = "Prof. Carla",
                Email = "carla@escola.br",
                Plan = UserPlan.Pro,
            };
            Db.Users.AddRange(User, OtherUser);
            Db.SaveChanges();

            AsUser = new ClaimsPrincipal(
                new ClaimsIdentity([new Claim(CodexClaimTypes.UserId, User.Id.ToString())], "test"));

            var aiOptions = customOptions ?? new AiOptions();
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["CodexApi:DisplayUtcOffsetHours"] = "-3",
                })
                .Build();

            var router = new AiProviderRouter(aiOptions);
            var quota = new AiQuotaService(Db, aiOptions, config);
            InflightLock = new InMemoryAiInflightLock(aiOptions);

            Ai = new AiService(
                Db,
                aiOptions,
                router,
                quota,
                InflightLock,
                ChatClient,
                NullLogger<AiService>.Instance);
        }
    }

    private sealed class FakeAiChatClient : IAiChatClient
    {
        private readonly Queue<Func<AiChatResult>> _responses = new();

        public List<(AiProviderOptions Provider, string SystemPrompt, string UserPrompt)> Calls { get; } = [];

        public void Enqueue(string json, int promptTokens = 100, int completionTokens = 50)
        {
            _responses.Enqueue(() => new AiChatResult(json, promptTokens, completionTokens, LatencyMs: 12));
        }

        public void EnqueueException(Exception ex)
        {
            _responses.Enqueue(() => throw ex);
        }

        public Task<AiChatResult> CompleteJsonAsync(
            AiProviderOptions provider,
            string systemPrompt,
            string userPrompt,
            JsonObject jsonSchema,
            CancellationToken ct)
        {
            Calls.Add((provider, systemPrompt, userPrompt));
            if (_responses.Count == 0)
            {
                throw new InvalidOperationException("Nenhuma resposta simulada na fila de FakeAiChatClient.");
            }

            return Task.FromResult(_responses.Dequeue()());
        }
    }
}
