using System.Text.Json.Nodes;
using Codex.Api.Domain;

namespace Codex.Api.Services.Ai;

/// <summary>
/// Schemas JSON enviados em <c>response_format.json_schema</c> para provedores compativeis com
/// Structured Outputs (OpenAI, Gemini OpenAI-compat, LM Studio).
/// </summary>
public static class AiSchemas
{
    public static JsonObject ForPhase(PhaseKind kind) => BuildPhaseSchema(kind);

    public static JsonObject ForVariations(PhaseKind kind, int count) => new()
    {
        ["type"] = "object",
        ["additionalProperties"] = false,
        ["required"] = new JsonArray("phases"),
        ["properties"] = new JsonObject
        {
            ["phases"] = new JsonObject
            {
                ["type"] = "array",
                ["minItems"] = 1,
                ["maxItems"] = count,
                ["items"] = BuildPhaseSchema(kind),
            },
        },
    };

    public static JsonObject ForQuizOptions(int count) => new()
    {
        ["type"] = "object",
        ["additionalProperties"] = false,
        ["required"] = new JsonArray("suggestions"),
        ["properties"] = new JsonObject
        {
            ["suggestions"] = new JsonObject
            {
                ["type"] = "array",
                ["minItems"] = 1,
                ["maxItems"] = count,
                ["items"] = new JsonObject
                {
                    ["type"] = "object",
                    ["additionalProperties"] = false,
                    ["required"] = new JsonArray("label", "isCorrect", "rationale"),
                    ["properties"] = new JsonObject
                    {
                        ["label"] = new JsonObject
                        {
                            ["type"] = "string",
                            ["maxLength"] = PhaseLimits.MaxOptionLength,
                        },
                        ["isCorrect"] = new JsonObject
                        {
                            ["type"] = "boolean",
                        },
                        ["rationale"] = new JsonObject
                        {
                            ["type"] = "string",
                            ["maxLength"] = 120,
                        },
                    },
                },
            },
        },
    };

    private static JsonObject BuildPhaseSchema(PhaseKind kind)
    {
        var properties = new JsonObject
        {
            ["name"] = new JsonObject
            {
                ["type"] = "string",
                ["maxLength"] = PhaseLimits.MaxNameLength,
            },
            ["question"] = new JsonObject
            {
                ["type"] = "string",
                ["maxLength"] = PhaseLimits.MaxQuestionLength,
            },
            ["introTip"] = new JsonObject
            {
                ["type"] = "string",
                ["maxLength"] = PhaseLimits.MaxIntroTipLength,
            },
        };

        var required = new JsonArray(
            "name",
            "question",
            "introTip");

        switch (kind)
        {
            case PhaseKind.Quiz:
                properties["options"] = new JsonObject
                {
                    ["type"] = "array",
                    ["minItems"] = PhaseDraftValidator.MinOptions,
                    ["maxItems"] = PhaseDraftValidator.MaxOptions,
                    ["items"] = new JsonObject
                    {
                        ["type"] = "string",
                        ["maxLength"] = PhaseLimits.MaxOptionLength,
                    },
                };
                properties["correctIndexes"] = new JsonObject
                {
                    ["type"] = "array",
                    ["minItems"] = 1,
                    ["items"] = new JsonObject
                    {
                        ["type"] = "integer",
                        ["minimum"] = 0,
                    },
                };
                required.Add("options");
                required.Add("correctIndexes");
                break;

            case PhaseKind.Fill:
                properties["words"] = new JsonObject
                {
                    ["type"] = "array",
                    ["minItems"] = 1,
                    ["maxItems"] = PhaseLimits.MaxWords,
                    ["items"] = new JsonObject
                    {
                        ["type"] = "string",
                        ["maxLength"] = PhaseLimits.MaxOptionLength,
                    },
                };
                properties["blanks"] = new JsonObject
                {
                    ["type"] = "array",
                    ["minItems"] = 1,
                    ["items"] = new JsonObject
                    {
                        ["type"] = "string",
                        ["maxLength"] = PhaseLimits.MaxOptionLength,
                    },
                };
                required.Add("words");
                required.Add("blanks");
                break;

            case PhaseKind.Text:
                properties["expectedAnswer"] = new JsonObject
                {
                    ["type"] = "string",
                    ["maxLength"] = PhaseLimits.MaxExpectedAnswerLength,
                };
                required.Add("expectedAnswer");
                break;

            case PhaseKind.Code:
                properties["starterCode"] = new JsonObject
                {
                    ["type"] = "string",
                    ["maxLength"] = PhaseLimits.MaxStarterCodeLength,
                };
                required.Add("starterCode");
                break;
        }

        return new JsonObject
        {
            ["type"] = "object",
            ["additionalProperties"] = false,
            ["required"] = required,
            ["properties"] = properties,
        };
    }
}
