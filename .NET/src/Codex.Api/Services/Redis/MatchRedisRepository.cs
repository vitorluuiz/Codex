using System.Text.Json;
using Codex.Api.Domain.Entities;
using StackExchange.Redis;

namespace Codex.Api.Services.Redis;

using Codex.Api.Services.Realtime;
public class MatchRedisRepository(IRealtimeConnection connection, RedisLuaRunner lua) : IMatchRepository
{
    private readonly RedisLuaRunner _lua = lua;
    
    private async Task<IDatabase> GetDbAsync(CancellationToken ct)
    {
        var mux = await connection.GetAsync(ct);
        return mux.GetDatabase();
    }

    private async Task<IServer> GetServerAsync(CancellationToken ct)
    {
        var mux = await connection.GetAsync(ct);
        return mux.GetServer(mux.GetEndPoints().First());
    }

    public async Task<Match?> GetMatchAsync(string matchId, CancellationToken ct)
    {
        var entries = await (await GetDbAsync(ct)).HashGetAllAsync(RedisKeys.Match(matchId));
        if (entries.Length == 0) return null;

        var dict = entries.ToDictionary(e => (string)e.Name!, e => (string)e.Value!);

        var data = new MatchRedisData.MatchHashData
        {
            RoomId = dict["roomId"],
            Mode = dict["mode"],
            Status = dict["status"],
            CurrentPhaseIndex = int.Parse(dict["currentPhaseIndex"]),
            StartedAtMs = long.Parse(dict["startedAtMs"]),
            CurrentPhaseStartedAtMs = dict.TryGetValue("currentPhaseStartedAtMs", out var cps) ? long.Parse(cps) : null,
            CurrentPhaseEndsAtMs = dict.TryGetValue("currentPhaseEndsAtMs", out var cpe) ? long.Parse(cpe) : null,
            CurrentPhaseEndedAtMs = dict.TryGetValue("currentPhaseEndedAtMs", out var cped) ? long.Parse(cped) : null,
            PausedSecondsLeft = dict.TryGetValue("pausedSecondsLeft", out var psl) ? int.Parse(psl) : null
        };

        return data.ToEntity(matchId);
    }

    public async Task SetMatchAsync(Match match, CancellationToken ct)
    {
        var hashFields = new List<HashEntry>
        {
            new("roomId", match.RoomId.ToString()),
            new("mode", match.Mode.ToString().ToLowerInvariant()),
            new("status", match.Status.ToString().ToLowerInvariant()),
            new("currentPhaseIndex", match.CurrentPhaseIndex.ToString()),
            new("startedAtMs", match.StartedAt.ToUnixTimeMilliseconds().ToString())
        };

        if (match.CurrentPhaseStartedAt.HasValue)
            hashFields.Add(new("currentPhaseStartedAtMs", match.CurrentPhaseStartedAt.Value.ToUnixTimeMilliseconds().ToString()));
        if (match.CurrentPhaseEndsAt.HasValue)
            hashFields.Add(new("currentPhaseEndsAtMs", match.CurrentPhaseEndsAt.Value.ToUnixTimeMilliseconds().ToString()));
        if (match.CurrentPhaseEndedAt.HasValue)
            hashFields.Add(new("currentPhaseEndedAtMs", match.CurrentPhaseEndedAt.Value.ToUnixTimeMilliseconds().ToString()));
        if (match.PausedSecondsLeft.HasValue)
            hashFields.Add(new("pausedSecondsLeft", match.PausedSecondsLeft.Value.ToString()));

        var key = RedisKeys.Match(match.Id.ToString());
        await (await GetDbAsync(ct)).HashSetAsync(key, hashFields.ToArray());
        await (await GetDbAsync(ct)).KeyExpireAsync(key, RedisKeys.RoomTtl);
    }

    public async Task<bool> PutSubmissionAsync(Submission submission, CancellationToken ct)
    {
        var data = new MatchRedisData.SubmissionHashData
        {
            Id = submission.Id.ToString(),
            MatchId = submission.MatchId.ToString(),
            RoomQueuePhaseId = submission.RoomQueuePhaseId.ToString(),
            ParticipantId = submission.ParticipantId.ToString(),
            AnswerJson = submission.AnswerJson,
            SubmittedAtMs = submission.SubmittedAt.ToUnixTimeMilliseconds(),
            ElapsedSeconds = submission.ElapsedSeconds,
            ReadyAtMs = submission.ReadyAt?.ToUnixTimeMilliseconds(),
            Grading = submission.Grading.ToString().ToLowerInvariant(),
            Correct = submission.Correct,
            Score = submission.Score,
            Explanation = submission.Explanation,
            AiSuggestionsJson = submission.AiSuggestionsJson,
            TestsPassedJson = submission.TestsPassedJson
        };

        var json = JsonSerializer.Serialize(data);
        var isGraded = submission.Grading == Domain.GradingStatus.Graded;

        return await _lua.SubmissionPutAsync(
            await GetDbAsync(ct), (await GetServerAsync(ct)),
            submission.MatchId.ToString(),
            submission.RoomQueuePhaseId.ToString(),
            submission.ParticipantId.ToString(),
            json,
            isGraded,
            submission.Correct ?? false,
            submission.Score ?? 0,
            ct);
    }

    public async Task<IReadOnlyList<Submission>> GetSubmissionsAsync(string matchId, string queuePhaseId, CancellationToken ct)
    {
        var prefix = $"{queuePhaseId}:";
        var entries = await (await GetDbAsync(ct)).HashGetAllAsync(RedisKeys.MatchSubs(matchId));
        
        var list = new List<Submission>();
        foreach (var entry in entries)
        {
            if (((string)entry.Name!).StartsWith(prefix))
            {
                var data = JsonSerializer.Deserialize<MatchRedisData.SubmissionHashData>((string)entry.Value!)!;
                list.Add(data.ToEntity());
            }
        }
        return list;
    }

    public async Task<MatchRedisData.PhaseAggregatesData> GetPhaseAggregatesAsync(string matchId, string queuePhaseId, CancellationToken ct)
    {
        var entries = await (await GetDbAsync(ct)).HashGetAllAsync(RedisKeys.MatchAgg(matchId, queuePhaseId));
        if (entries.Length == 0) return new MatchRedisData.PhaseAggregatesData();

        var dict = entries.ToDictionary(e => (string)e.Name!, e => (int)e.Value);

        return new MatchRedisData.PhaseAggregatesData
        {
            Submitted = dict.GetValueOrDefault("submitted", 0),
            Graded = dict.GetValueOrDefault("graded", 0),
            Correct = dict.GetValueOrDefault("correct", 0),
            ScoreSum = dict.GetValueOrDefault("scoreSum", 0)
        };
    }

    public async Task RestartPhaseAsync(string matchId, string queuePhaseId, CancellationToken ct)
    {
        await _lua.PhaseRestartAsync(await GetDbAsync(ct), await GetServerAsync(ct), matchId, queuePhaseId, ct);
    }

    public async Task MarkPendingCommitAsync(string matchId, CancellationToken ct)
    {
        await (await GetDbAsync(ct)).SetAddAsync(RedisKeys.CommitPending(), matchId);
    }
}



