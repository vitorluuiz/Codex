using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.Redis;

namespace Codex.Api.Tests;

public sealed class InMemoryRoomRepository : IRoomRepository
{
    private readonly object _gate = new();
    private readonly Dictionary<string, RoomRedisData.RoomData> _rooms = new();
    private readonly Dictionary<string, string> _codeToRoomId = new();
    private readonly Dictionary<string, Dictionary<string, RoomRedisData.ParticipantData>> _participants = new();
    private readonly Dictionary<string, List<(string Id, long JoinedAtMs)>> _participantOrder = new();
    private readonly Dictionary<string, HashSet<string>> _participantNames = new();
    private readonly Dictionary<string, Dictionary<string, RoomRedisData.QueueSetData>> _queueSets = new();
    private readonly Dictionary<string, Dictionary<string, RoomRedisData.QueuePhaseData>> _queuePhases = new();
    private readonly Dictionary<string, HashSet<string>> _userLedRooms = new();
    private readonly Dictionary<string, HashSet<string>> _userJoinedRooms = new();

    public Task<bool> ClaimCodeAndCreateAsync(string code, RoomRedisData.RoomData data, CancellationToken ct)
    {
        lock (_gate)
        {
            if (_codeToRoomId.ContainsKey(code))
            {
                return Task.FromResult(false);
            }

            _codeToRoomId[code] = data.Id;
            _rooms[data.Id] = data;

            if (!_userLedRooms.TryGetValue(data.LeaderUserId, out var led))
            {
                led = new HashSet<string>();
                _userLedRooms[data.LeaderUserId] = led;
            }
            led.Add(data.Id);

            return Task.FromResult(true);
        }
    }

    public Task<string?> GetRoomIdByCodeAsync(string code, CancellationToken ct)
    {
        lock (_gate)
        {
            return Task.FromResult(_codeToRoomId.TryGetValue(code, out var id) ? id : null);
        }
    }

    public Task<RoomRedisData.RoomData?> GetRoomAsync(string roomId, CancellationToken ct)
    {
        lock (_gate)
        {
            return Task.FromResult(_rooms.TryGetValue(roomId, out var room) ? room : null);
        }
    }

    public Task SaveRoomAsync(string roomId, RoomRedisData.RoomData data, CancellationToken ct)
    {
        lock (_gate)
        {
            _rooms[roomId] = data;
            _codeToRoomId[data.Code] = roomId;
            return Task.CompletedTask;
        }
    }

    public Task<bool> RenewTtlAsync(string roomId, CancellationToken ct)
    {
        lock (_gate)
        {
            return Task.FromResult(_rooms.ContainsKey(roomId));
        }
    }

    public Task DeleteRoomAsync(
        string roomId,
        string code,
        string leaderUserId,
        IReadOnlyList<string> queueSetIds,
        IReadOnlyList<string> queuePhaseIds,
        CancellationToken ct)
    {
        lock (_gate)
        {
            _rooms.Remove(roomId);
            _codeToRoomId.Remove(code);
            _participants.Remove(roomId);
            _participantOrder.Remove(roomId);
            _participantNames.Remove(roomId);
            _queueSets.Remove(roomId);
            _queuePhases.Remove(roomId);

            if (_userLedRooms.TryGetValue(leaderUserId, out var led))
            {
                led.Remove(roomId);
            }

            return Task.CompletedTask;
        }
    }

    public Task<ParticipantJoinResult> JoinParticipantAsync(
        string roomId,
        int capacity,
        RoomRedisData.ParticipantData data,
        CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_participants.TryGetValue(roomId, out var parts))
            {
                parts = new Dictionary<string, RoomRedisData.ParticipantData>();
                _participants[roomId] = parts;
            }

            if (parts.Count >= capacity)
            {
                return Task.FromResult(ParticipantJoinResult.RoomFull);
            }

            if (!_participantNames.TryGetValue(roomId, out var names))
            {
                names = new HashSet<string>();
                _participantNames[roomId] = names;
            }

            if (!names.Add(data.DisplayName.ToLowerInvariant()))
            {
                return Task.FromResult(ParticipantJoinResult.NameTaken);
            }

            parts[data.Id] = data;

            if (!_participantOrder.TryGetValue(roomId, out var order))
            {
                order = new List<(string, long)>();
                _participantOrder[roomId] = order;
            }
            order.Add((data.Id, data.JoinedAtMs));

            return Task.FromResult(ParticipantJoinResult.Ok);
        }
    }

    public Task<RoomRedisData.ParticipantData?> GetParticipantAsync(string roomId, string participantId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (_participants.TryGetValue(roomId, out var parts) && parts.TryGetValue(participantId, out var p))
            {
                return Task.FromResult<RoomRedisData.ParticipantData?>(p);
            }

            return Task.FromResult<RoomRedisData.ParticipantData?>(null);
        }
    }

    public Task<IReadOnlyList<RoomRedisData.ParticipantData>> GetParticipantsAsync(string roomId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_participants.TryGetValue(roomId, out var parts) ||
                !_participantOrder.TryGetValue(roomId, out var order))
            {
                return Task.FromResult<IReadOnlyList<RoomRedisData.ParticipantData>>(Array.Empty<RoomRedisData.ParticipantData>());
            }

            var result = order
                .OrderBy(o => o.JoinedAtMs)
                .Select(o => parts.TryGetValue(o.Id, out var p) ? p : null)
                .Where(p => p is not null)
                .Cast<RoomRedisData.ParticipantData>()
                .ToList();

            return Task.FromResult<IReadOnlyList<RoomRedisData.ParticipantData>>(result);
        }
    }

    public Task<int> CountParticipantsAsync(string roomId, CancellationToken ct)
    {
        lock (_gate)
        {
            return Task.FromResult(_participants.TryGetValue(roomId, out var parts) ? parts.Count : 0);
        }
    }

    public Task<bool> UpdateParticipantAsync(string roomId, RoomRedisData.ParticipantData data, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_participants.TryGetValue(roomId, out var parts))
            {
                parts = new Dictionary<string, RoomRedisData.ParticipantData>();
                _participants[roomId] = parts;
            }

            var existed = parts.ContainsKey(data.Id);
            parts[data.Id] = data;
            return Task.FromResult(existed);
        }
    }

    public Task<bool> RejectParticipantAsync(
        string roomId,
        string participantId,
        string lowerDisplayName,
        RoomRedisData.ParticipantData updatedData,
        CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_participants.TryGetValue(roomId, out var parts) || !parts.ContainsKey(participantId))
            {
                return Task.FromResult(false);
            }

            parts[participantId] = updatedData;
            if (_participantNames.TryGetValue(roomId, out var names))
            {
                names.Remove(lowerDisplayName);
            }

            return Task.FromResult(true);
        }
    }

    public Task<bool> RemoveParticipantAsync(
        string roomId,
        string participantId,
        string lowerDisplayName,
        CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_participants.TryGetValue(roomId, out var parts) || !parts.Remove(participantId))
            {
                return Task.FromResult(false);
            }

            if (_participantOrder.TryGetValue(roomId, out var order))
            {
                order.RemoveAll(o => o.Id == participantId);
            }

            if (_participantNames.TryGetValue(roomId, out var names))
            {
                names.Remove(lowerDisplayName);
            }

            return Task.FromResult(true);
        }
    }

    public Task<IReadOnlyList<RoomRedisData.QueueSetData>> GetQueueSetsAsync(string roomId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_queueSets.TryGetValue(roomId, out var sets))
            {
                return Task.FromResult<IReadOnlyList<RoomRedisData.QueueSetData>>(Array.Empty<RoomRedisData.QueueSetData>());
            }

            var result = sets.Values.OrderBy(s => s.OrderIndex).ToList();
            return Task.FromResult<IReadOnlyList<RoomRedisData.QueueSetData>>(result);
        }
    }

    public Task SaveQueueSetAsync(string roomId, RoomRedisData.QueueSetData data, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_queueSets.TryGetValue(roomId, out var sets))
            {
                sets = new Dictionary<string, RoomRedisData.QueueSetData>();
                _queueSets[roomId] = sets;
            }

            sets[data.Id] = data;
            return Task.CompletedTask;
        }
    }

    public Task DeleteQueueSetAsync(string roomId, string setId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (_queueSets.TryGetValue(roomId, out var sets))
            {
                sets.Remove(setId);
            }

            return Task.CompletedTask;
        }
    }

    public Task<IReadOnlyList<RoomRedisData.QueuePhaseData>> GetQueuePhasesAsync(string roomId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_queuePhases.TryGetValue(roomId, out var phases))
            {
                return Task.FromResult<IReadOnlyList<RoomRedisData.QueuePhaseData>>(Array.Empty<RoomRedisData.QueuePhaseData>());
            }

            var result = phases.Values.OrderBy(p => p.OrderIndex).ToList();
            return Task.FromResult<IReadOnlyList<RoomRedisData.QueuePhaseData>>(result);
        }
    }

    public Task<RoomRedisData.QueuePhaseData?> GetQueuePhaseAsync(string roomId, string phaseId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (_queuePhases.TryGetValue(roomId, out var phases) && phases.TryGetValue(phaseId, out var phase))
            {
                return Task.FromResult<RoomRedisData.QueuePhaseData?>(phase);
            }

            return Task.FromResult<RoomRedisData.QueuePhaseData?>(null);
        }
    }

    public Task SaveQueuePhaseAsync(string roomId, RoomRedisData.QueuePhaseData data, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_queuePhases.TryGetValue(roomId, out var phases))
            {
                phases = new Dictionary<string, RoomRedisData.QueuePhaseData>();
                _queuePhases[roomId] = phases;
            }

            phases[data.Id] = data;
            return Task.CompletedTask;
        }
    }

    public Task DeleteQueuePhaseAsync(string roomId, string phaseId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (_queuePhases.TryGetValue(roomId, out var phases))
            {
                phases.Remove(phaseId);
            }

            return Task.CompletedTask;
        }
    }

    public Task SaveQueueOrderAsync(
        string roomId,
        IReadOnlyList<RoomRedisData.QueuePhaseData> phases,
        IReadOnlyList<RoomRedisData.QueueSetData> sets,
        CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_queuePhases.TryGetValue(roomId, out var phaseMap))
            {
                phaseMap = new Dictionary<string, RoomRedisData.QueuePhaseData>();
                _queuePhases[roomId] = phaseMap;
            }
            foreach (var p in phases)
            {
                phaseMap[p.Id] = p;
            }

            if (!_queueSets.TryGetValue(roomId, out var setMap))
            {
                setMap = new Dictionary<string, RoomRedisData.QueueSetData>();
                _queueSets[roomId] = setMap;
            }
            foreach (var s in sets)
            {
                setMap[s.Id] = s;
            }

            return Task.CompletedTask;
        }
    }

    public Task<IReadOnlyList<string>> GetLedRoomIdsAsync(string userId, CancellationToken ct)
    {
        lock (_gate)
        {
            return Task.FromResult<IReadOnlyList<string>>(
                _userLedRooms.TryGetValue(userId, out var set) ? set.ToList() : Array.Empty<string>());
        }
    }

    public Task<IReadOnlyList<string>> GetJoinedRoomIdsAsync(string userId, CancellationToken ct)
    {
        lock (_gate)
        {
            return Task.FromResult<IReadOnlyList<string>>(
                _userJoinedRooms.TryGetValue(userId, out var set) ? set.ToList() : Array.Empty<string>());
        }
    }

    public Task AddToJoinedAsync(string userId, string roomId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_userJoinedRooms.TryGetValue(userId, out var set))
            {
                set = new HashSet<string>();
                _userJoinedRooms[userId] = set;
            }
            set.Add(roomId);
            return Task.CompletedTask;
        }
    }

    public Task RemoveFromJoinedAsync(string userId, string roomId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (_userJoinedRooms.TryGetValue(userId, out var set))
            {
                set.Remove(roomId);
            }
            return Task.CompletedTask;
        }
    }
}

public sealed class InMemoryMatchRepository : IMatchRepository
{
    private readonly object _gate = new();
    private readonly Dictionary<string, Match> _matches = new();
    private readonly Dictionary<string, Dictionary<(string PhaseId, string ParticipantId), Submission>> _submissions = new();
    private readonly Dictionary<(string MatchId, string PhaseId), (int Submitted, int Graded, int Correct, int ScoreSum)> _aggregates = new();
    private readonly HashSet<string> _pendingCommits = new();

    public IReadOnlyCollection<string> PendingCommits
    {
        get
        {
            lock (_gate)
            {
                return _pendingCommits.ToList();
            }
        }
    }

    public Task<Match?> GetMatchAsync(string matchId, CancellationToken ct)
    {
        lock (_gate)
        {
            return Task.FromResult(_matches.TryGetValue(matchId, out var match) ? CloneMatch(match) : null);
        }
    }

    public Task SetMatchAsync(Match match, CancellationToken ct)
    {
        lock (_gate)
        {
            _matches[match.Id.ToString()] = CloneMatch(match);
            return Task.CompletedTask;
        }
    }

    public Task<bool> PutSubmissionAsync(Submission submission, CancellationToken ct)
    {
        lock (_gate)
        {
            var matchId = submission.MatchId.ToString();
            var phaseId = submission.RoomQueuePhaseId.ToString();
            var participantId = submission.ParticipantId.ToString();

            if (!_submissions.TryGetValue(matchId, out var map))
            {
                map = new Dictionary<(string, string), Submission>();
                _submissions[matchId] = map;
            }

            if (!map.TryAdd((phaseId, participantId), CloneSubmission(submission)))
            {
                return Task.FromResult(false);
            }

            _aggregates.TryGetValue((matchId, phaseId), out var agg);
            agg.Submitted += 1;
            if (submission.Grading == GradingStatus.Graded)
            {
                agg.Graded += 1;
            }
            if (submission.Correct == true)
            {
                agg.Correct += 1;
            }
            agg.ScoreSum += submission.Score ?? 0;
            _aggregates[(matchId, phaseId)] = agg;

            return Task.FromResult(true);
        }
    }

    public Task<bool> MarkSubmissionReadyAsync(
        string matchId,
        string queuePhaseId,
        string participantId,
        DateTimeOffset readyAt,
        CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_submissions.TryGetValue(matchId, out var map) ||
                !map.TryGetValue((queuePhaseId, participantId), out var sub) ||
                sub.ReadyAt.HasValue)
            {
                return Task.FromResult(false);
            }

            sub.ReadyAt = readyAt;
            return Task.FromResult(true);
        }
    }

    public Task<IReadOnlyList<Submission>> GetSubmissionsAsync(string matchId, string queuePhaseId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_submissions.TryGetValue(matchId, out var map))
            {
                return Task.FromResult<IReadOnlyList<Submission>>(Array.Empty<Submission>());
            }

            var list = map
                .Where(kv => kv.Key.PhaseId == queuePhaseId)
                .Select(kv => CloneSubmission(kv.Value))
                .ToList();

            return Task.FromResult<IReadOnlyList<Submission>>(list);
        }
    }

    public Task<MatchRedisData.PhaseAggregatesData> GetPhaseAggregatesAsync(
        string matchId,
        string queuePhaseId,
        CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_aggregates.TryGetValue((matchId, queuePhaseId), out var agg))
            {
                return Task.FromResult(new MatchRedisData.PhaseAggregatesData());
            }

            return Task.FromResult(new MatchRedisData.PhaseAggregatesData
            {
                Submitted = agg.Submitted,
                Graded = agg.Graded,
                Correct = agg.Correct,
                ScoreSum = agg.ScoreSum
            });
        }
    }

    public Task RestartPhaseAsync(string matchId, string queuePhaseId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (_submissions.TryGetValue(matchId, out var map))
            {
                var toRemove = map.Keys.Where(k => k.PhaseId == queuePhaseId).ToList();
                foreach (var key in toRemove)
                {
                    map.Remove(key);
                }
            }

            _aggregates.Remove((matchId, queuePhaseId));
            return Task.CompletedTask;
        }
    }

    public Task MarkPendingCommitAsync(string matchId, CancellationToken ct)
    {
        lock (_gate)
        {
            _pendingCommits.Add(matchId);
            return Task.CompletedTask;
        }
    }

    private static Match CloneMatch(Match m) => new()
    {
        Id = m.Id,
        RoomId = m.RoomId,
        Mode = m.Mode,
        Status = m.Status,
        CurrentPhaseIndex = m.CurrentPhaseIndex,
        StartedAt = m.StartedAt,
        FinishedAt = m.FinishedAt,
        CurrentPhaseStartedAt = m.CurrentPhaseStartedAt,
        CurrentPhaseEndsAt = m.CurrentPhaseEndsAt,
        CurrentPhaseEndedAt = m.CurrentPhaseEndedAt,
        PausedSecondsLeft = m.PausedSecondsLeft
    };

    private static Submission CloneSubmission(Submission s) => new()
    {
        Id = s.Id,
        MatchId = s.MatchId,
        RoomQueuePhaseId = s.RoomQueuePhaseId,
        ParticipantId = s.ParticipantId,
        AnswerJson = s.AnswerJson,
        SubmittedAt = s.SubmittedAt,
        ElapsedSeconds = s.ElapsedSeconds,
        ReadyAt = s.ReadyAt,
        Grading = s.Grading,
        Correct = s.Correct,
        Score = s.Score,
        Explanation = s.Explanation,
        AiSuggestionsJson = s.AiSuggestionsJson,
        TestsPassedJson = s.TestsPassedJson
    };
}
