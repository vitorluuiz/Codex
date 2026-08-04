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
