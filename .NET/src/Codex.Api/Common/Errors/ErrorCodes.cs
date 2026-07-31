namespace Codex.Api.Common.Errors;

/// <summary>
/// Codigos estaveis do contrato de erro (api-rest.md secao 1: "a UI escolhe o texto pelo
/// code, nunca pela message"). Mantenha esta lista em paridade com a tabela da secao 1 e com
/// os codigos citados ao longo do documento (ex.: TOO_MANY_SETS na secao 6).
/// </summary>
public static class ErrorCodes
{
    public const string InvalidCredentials = "INVALID_CREDENTIALS";
    public const string EmailAlreadyUsed = "EMAIL_ALREADY_USED";
    public const string RoomNotFound = "ROOM_NOT_FOUND";
    public const string RoomLocked = "ROOM_LOCKED";
    public const string AccountRequired = "ACCOUNT_REQUIRED";
    public const string UsernameTaken = "USERNAME_TAKEN";
    public const string RoomFull = "ROOM_FULL";
    public const string NotRoomLeader = "NOT_ROOM_LEADER";
    public const string PhaseAlreadySubmitted = "PHASE_ALREADY_SUBMITTED";
    public const string RateLimited = "RATE_LIMITED";

    public const string TooManySets = "TOO_MANY_SETS";
    public const string QueueMismatch = "QUEUE_MISMATCH";
    public const string EmptyQueue = "EMPTY_QUEUE";
    public const string NoPlayers = "NO_PLAYERS";
    public const string PhaseClosed = "PHASE_CLOSED";
    public const string PhaseStillOpen = "PHASE_STILL_OPEN";
    public const string InvalidDirection = "INVALID_DIRECTION";
}
