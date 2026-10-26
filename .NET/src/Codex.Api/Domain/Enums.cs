namespace Codex.Api.Domain;

public enum UserPlan
{
    Free,
    Intermediate,
    Pro,
}

/// <summary>
/// api-rest.md secao 2: "so troca o vocabulario da interface ('Participantes' vira
/// 'Candidatos'). Nao e permissao — nao decida nada com base nele no servidor."
/// </summary>
public enum Audience
{
    Teacher,
    Recruiter,
}

/// <summary>Provedores de login social previstos no contrato (api-rest.md secao 2) e ja desenhados no front (ProviderIcons.tsx).</summary>
public enum OAuthProvider
{
    Google,
    Microsoft,
    GitHub,
}

public enum RoomStatus
{
    Lobby,
    Running,
    Finished,
}

public enum MatchMode
{
    Live,
    SelfPaced,
}

public enum MatchStatus
{
    Running,
    Paused,
    Finished,
}

public enum ParticipantStatus
{
    Pending,
    Approved,
    Rejected,
}

public enum PhaseKind
{
    Quiz,
    Fill,
    Text,
    Code,
}

public enum PhaseSetVisibility
{
    Private,
    Community,
}

public enum GradingStatus
{
    Graded,
    Pending,
}

public enum AiOperation
{
    Phase,
    Variations,
    QuizOptions,
}

public enum AiGenerationStatus
{
    Pending,
    Succeeded,
    Failed,
}

public enum AiDecision
{
    Undecided,
    Accepted,
    Partial,
    Discarded,
}

public enum AiDifficulty
{
    Easy,
    Medium,
    Hard,
}

public enum AiVariationAspect
{
    Wording,
    Values,
    Context,
    Distractors,
}

public enum AiDifficultyShift
{
    Same,
    Easier,
    Harder,
}

public enum QuizSuggestionMode
{
    Distractors,
    Correct,
    Any,
}
