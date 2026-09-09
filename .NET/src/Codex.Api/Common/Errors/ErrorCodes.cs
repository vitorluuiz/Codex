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

    /// <summary>
    /// POST /rooms com um setId inexistente, apagado, ou privado de outra pessoa. Serve tambem as
    /// rotas /queue/sets/{setId} da secao 6, onde o id e o da linha da fila: para quem chamou, um
    /// id que nao resolve e um conjunto que nao esta nesta fila.
    /// </summary>
    public const string PhaseSetNotFound = "PHASE_SET_NOT_FOUND";

    /// <summary>Rotas /queue/phases/{phaseId} da secao 6 com um id que nao esta na fila desta sala. Como o PARTICIPANT_NOT_FOUND, e bug de integracao: o front so monta esse link a partir da fila que acabou de ler.</summary>
    public const string PhaseNotFound = "PHASE_NOT_FOUND";

    /// <summary>
    /// Mutacao da fila (secao 6) numa sala que ja saiu do lobby. Fora da tabela da secao 1 porque o
    /// contrato nao decide se a fila trava durante a partida — a decisao esta em
    /// api-queue-log.md §5, e hoje nada tira a sala de "lobby" para produzir este erro.
    /// </summary>
    public const string MatchAlreadyStarted = "MATCH_ALREADY_STARTED";

    /// <summary>
    /// Rotas /matches/{matchId}/* com um id que nao existe, nao parseia, ou cuja sala quem chamou
    /// nao integra. E 404 tambem para quem nao e membro, e nao 403, pelo mesmo motivo do
    /// ROOM_NOT_FOUND do GET /rooms/{code}: a partida nao e mais publica que a sala que a contem.
    /// </summary>
    public const string MatchNotFound = "MATCH_NOT_FOUND";

    /// <summary>
    /// POST /rooms/{code}/match com alguma fase da fila sem gabarito utilizavel. Fora da tabela da
    /// secao 1 porque o contrato nao decide onde a fase incompleta e cobrada — a decisao esta em
    /// match-implementation-model.md §4 (decisao 3), e vem de api-phases-log.md, que ja
    /// registrava que "quem deveria cobrar fase completa e o inicio da partida".
    /// </summary>
    public const string IncompletePhase = "INCOMPLETE_PHASE";

    /// <summary>
    /// POST /rooms/{code}/match com <c>mode: "self-paced"</c>. O modo esta no contrato e o lobby
    /// oferece o botao, mas nao ha caminho de avanco para o aluno em lugar nenhum — nem no contrato
    /// (a secao 10 lista advance como rota de lider), nem no front, e o servico de WS descartaria um
    /// phase.started individual (a allowlist de realtime/src/channels.ts nao aceita esse evento no
    /// canal privado). Recusar e mais honesto que rodar como "live" prometendo outra coisa.
    /// </summary>
    public const string ModeNotAvailable = "MODE_NOT_AVAILABLE";

    /// <summary>
    /// Token de sessao (ou ticket de realtime) ausente, invalido, expirado ou ja consumido. E o
    /// unico code cujo nome vem do websocket-contract.md (secao 5, RealtimeErrorCode) e nao do
    /// contrato REST: as rotas de realtime respondem com ele para que o servico de WS possa
    /// repassa-lo ao cliente sem traduzir.
    /// </summary>
    public const string Unauthenticated = "UNAUTHENTICATED";

    // Login social (secao 2). Fora da tabela da secao 1 pelo mesmo motivo dos dois acima: o
    // contrato so cataloga o que tem dialogo proprio, e o front trata todos estes como uma
    // falha unica na faixa de erro de /entrar.

    /// <summary>Provedor sem ClientId/ClientSecret nesta instalacao. 501, e nao 500: a rota existe, a configuracao e que nao foi feita — permite ligar um provedor de cada vez.</summary>
    public const string OAuthProviderNotConfigured = "OAUTH_PROVIDER_NOT_CONFIGURED";

    /// <summary>O <c>state</c> do callback nao decifra, expirou, ou e de outro provedor. Cobre tanto adulteracao quanto a aba deixada aberta por muito tempo.</summary>
    public const string OAuthStateInvalid = "OAUTH_STATE_INVALID";

    /// <summary>A troca do <c>code</c> pelo token, ou a leitura do perfil, falhou no provedor.</summary>
    public const string OAuthExchangeFailed = "OAUTH_EXCHANGE_FAILED";

    /// <summary>O provedor nao afirma que o email e verificado (caso comum no GitHub com email privado). Sem isso nao ha como vincular a uma conta existente sem abrir tomada de conta.</summary>
    public const string OAuthEmailNotVerified = "OAUTH_EMAIL_NOT_VERIFIED";
}
