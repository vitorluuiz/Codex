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

    /// <summary>Mesma situacao do EMAIL_ALREADY_USED, mas no PATCH /users/me — a tabela da secao 1 lista os dois separados porque a UI mostra o erro em dialogos diferentes.</summary>
    public const string EmailTaken = "EMAIL_TAKEN";

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

    // Fora da tabela da secao 1 — o doc so cataloga os erros que tem dialogo proprio na UI.
    // Estes cobrem casos que o front nao consegue produzir jogando normalmente (corpo invalido,
    // id de participante inexistente), e caem no tratamento generico de falha da UI.
    public const string ValidationError = "VALIDATION_ERROR";
    public const string ParticipantNotFound = "PARTICIPANT_NOT_FOUND";

    /// <summary>GET /users/{userId}/profile com um id que nao existe. O front so monta esse link a partir de um perfil que ja viu, entao e bug de integracao.</summary>
    public const string UserNotFound = "USER_NOT_FOUND";

    /// <summary>POST /rooms com um setId inexistente, apagado, ou privado de outra pessoa.</summary>
    public const string PhaseSetNotFound = "PHASE_SET_NOT_FOUND";
}
