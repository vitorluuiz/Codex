namespace Codex.Api.Services.Redis;

/// <summary>
/// Contrato de persistencia da camada de Redis para o estado volatil de alta frequencia:
/// Salas e Participantes (secao 3 e 4), Filas (secao 6) e Metadados.
///
/// Todas as operacoes tratam o TTL e mantem os indices sincronizados atomicamente.
/// </summary>
public interface IRoomRepository
{
    // ── Salas ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Registra uma nova sala: reserva o codigo e grava o estado inicial atomicamente.
    /// Retorna <c>true</c> se sucesso; <c>false</c> se o codigo gerado ja estava em uso.
    /// </summary>
    Task<bool> ClaimCodeAndCreateAsync(string code, RoomRedisData.RoomData data, CancellationToken ct);

    /// <summary>Resolve o id da sala pelo codigo e renova o TTL se existir.</summary>
    Task<string?> GetRoomIdByCodeAsync(string code, CancellationToken ct);

    /// <summary>Le o estado da sala. Nao renova o TTL automaticamente.</summary>
    Task<RoomRedisData.RoomData?> GetRoomAsync(string roomId, CancellationToken ct);

    /// <summary>Salva o estado da sala (PATCH) e renova o TTL.</summary>
    Task SaveRoomAsync(string roomId, RoomRedisData.RoomData data, CancellationToken ct);

    /// <summary>Renova o TTL de 24h para as chaves principais da sala.</summary>
    Task<bool> RenewTtlAsync(string roomId, CancellationToken ct);

    /// <summary>
    /// Remove todas as chaves da sala do Redis: dados da sala, reserva de codigo, participantes,
    /// fila de conjuntos/fases e indice de lideranca do usuario.
    /// </summary>
    Task DeleteRoomAsync(string roomId, string code, string leaderUserId, IReadOnlyList<string> queueSetIds, IReadOnlyList<string> queuePhaseIds, CancellationToken ct);

    // ── Participantes ──────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Executa <c>participant_join</c> (redis.md §4.2). Se retornar <c>Ok</c>, o participante
    /// foi adicionado ao HASH, ao ZSET e seu nome reservado no SET.
    /// </summary>
    Task<ParticipantJoinResult> JoinParticipantAsync(string roomId, int capacity, RoomRedisData.ParticipantData data, CancellationToken ct);

    /// <summary>Leitura unica. O(1).</summary>
    Task<RoomRedisData.ParticipantData?> GetParticipantAsync(string roomId, string participantId, CancellationToken ct);

    /// <summary>Listagem em ordem de entrada (lida do ZSET). O(N).</summary>
    Task<IReadOnlyList<RoomRedisData.ParticipantData>> GetParticipantsAsync(string roomId, CancellationToken ct);

    /// <summary>Contagem de participantes aprovados + pendentes via HLEN. O(1).</summary>
    Task<int> CountParticipantsAsync(string roomId, CancellationToken ct);

    /// <summary>Atualizacao simples (aprovar, alterar avatar). Nao altera apelido.</summary>
    Task<bool> UpdateParticipantAsync(string roomId, RoomRedisData.ParticipantData data, CancellationToken ct);

    /// <summary>Executa <c>participant_reject</c> (redis.md §4.3).</summary>
    Task<bool> RejectParticipantAsync(string roomId, string participantId, string lowerDisplayName, RoomRedisData.ParticipantData updatedData, CancellationToken ct);

    /// <summary>Executa <c>participant_remove</c> (redis.md §4.4).</summary>
    Task<bool> RemoveParticipantAsync(string roomId, string participantId, string lowerDisplayName, CancellationToken ct);

    // ── Fila de Conjuntos ──────────────────────────────────────────────────────────────────────

    Task<IReadOnlyList<RoomRedisData.QueueSetData>> GetQueueSetsAsync(string roomId, CancellationToken ct);
    Task SaveQueueSetAsync(string roomId, RoomRedisData.QueueSetData data, CancellationToken ct);
    Task DeleteQueueSetAsync(string roomId, string setId, CancellationToken ct);

    // ── Fila de Fases ──────────────────────────────────────────────────────────────────────────

    Task<IReadOnlyList<RoomRedisData.QueuePhaseData>> GetQueuePhasesAsync(string roomId, CancellationToken ct);
    Task<RoomRedisData.QueuePhaseData?> GetQueuePhaseAsync(string roomId, string phaseId, CancellationToken ct);
    Task SaveQueuePhaseAsync(string roomId, RoomRedisData.QueuePhaseData data, CancellationToken ct);
    Task DeleteQueuePhaseAsync(string roomId, string phaseId, CancellationToken ct);

    /// <summary>
    /// Executa um pipeline para refazer os scores (<c>OrderIndex</c>) dos ZSETs <c>sets</c> e <c>phases</c>.
    /// </summary>
    Task SaveQueueOrderAsync(string roomId, IReadOnlyList<RoomRedisData.QueuePhaseData> phases, IReadOnlyList<RoomRedisData.QueueSetData> sets, CancellationToken ct);

    // ── Indices de Usuario ─────────────────────────────────────────────────────────────────────

    Task<IReadOnlyList<string>> GetLedRoomIdsAsync(string userId, CancellationToken ct);
    Task<IReadOnlyList<string>> GetJoinedRoomIdsAsync(string userId, CancellationToken ct);
    Task AddToJoinedAsync(string userId, string roomId, CancellationToken ct);
    Task RemoveFromJoinedAsync(string userId, string roomId, CancellationToken ct);
}
