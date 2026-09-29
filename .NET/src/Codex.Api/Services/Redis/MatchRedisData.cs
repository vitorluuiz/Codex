using System.Text.Json.Serialization;

namespace Codex.Api.Services.Redis;

public static class MatchRedisData
{
    // The match properties stored as individual fields in the hash
    // match:{matchId} | HASH | roomId, mode, status, currentPhaseIndex, startedAt, currentPhaseStartedAt, currentPhaseEndsAt, currentPhaseEndedAt, pausedSecondsLeft
    public record MatchHashData
    {
        public required string RoomId { get; init; }
        public required string Mode { get; init; }
        public required string Status { get; init; }
        public required int CurrentPhaseIndex { get; init; }
        public required long StartedAtMs { get; init; }
        
        public long? CurrentPhaseStartedAtMs { get; init; }
        public long? CurrentPhaseEndsAtMs { get; init; }
        public long? CurrentPhaseEndedAtMs { get; init; }
        public int? PausedSecondsLeft { get; init; }
    }

    // JSON payload for submission
    public record SubmissionHashData
    {
        [JsonPropertyName("id")]
        public required string Id { get; init; }

        [JsonPropertyName("matchId")]
        public required string MatchId { get; init; }

        [JsonPropertyName("roomQueuePhaseId")]
        public required string RoomQueuePhaseId { get; init; }

        [JsonPropertyName("participantId")]
        public required string ParticipantId { get; init; }

        [JsonPropertyName("answerJson")]
        public required string AnswerJson { get; init; }

        [JsonPropertyName("submittedAtMs")]
        public required long SubmittedAtMs { get; init; }

        [JsonPropertyName("elapsedSeconds")]
        public required int ElapsedSeconds { get; init; }

        [JsonPropertyName("readyAtMs")]
        public long? ReadyAtMs { get; init; }

        [JsonPropertyName("grading")]
        public required string Grading { get; init; }

        [JsonPropertyName("correct")]
        public bool? Correct { get; init; }

        [JsonPropertyName("score")]
        public int? Score { get; init; }

        [JsonPropertyName("explanation")]
        public string? Explanation { get; init; }

        [JsonPropertyName("aiSuggestionsJson")]
        public string? AiSuggestionsJson { get; init; }

        [JsonPropertyName("testsPassedJson")]
        public string? TestsPassedJson { get; init; }
    }

    // Counters for phase progress
    public record PhaseAggregatesData
    {
        public int Submitted { get; init; }
        public int Graded { get; init; }
        public int Correct { get; init; }
        public int ScoreSum { get; init; }
    }
}
