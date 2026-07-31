namespace Codex.Api.Domain;

public enum UserPlan
{
    Free,
    Intermediate,
    Pro,
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
