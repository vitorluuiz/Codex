export const THRESHOLDS_VERSION = 1;

export const INSIGHT_THRESHOLDS = {
  difficulty: {
    veryEasyMin: 90,
    easyMin: 75,
    hardMax: 40,
    veryHardMax: 20,
    minParticipants: 3,
  },
  discrimination: {
    minParticipants: 6,
    ratio: 0.27,
    lowThreshold: 0.15,
  },
  timing: {
    finalWindowRatio: 0.15,
    finalWindowMinSec: 3,
    shortUnansweredRatio: 0.25,
    shortLateSubmissionsRatio: 0.40,
    shortLateWrongRatio: 0.25,
    longElapsedRatio: 0.25,
    longAccuracyMin: 80,
  },
  reading: {
    wordsPerSecond: 2.5,
    timeExceedRatio: 0.50,
    maxQuestionWords: 60,
    maxQuestionChars: 400,
    avgOptionCharsWarning: 80,
    maxOptionCharsWarning: 140,
  },
  guessing: {
    fastRatio: 0.15,
    fastMinSec: 2,
    fastReadingRatio: 0.50,
    lateWindowRatio: 0.10,
    lateWindowMinSec: 2,
    minOccurrences: 2,
    minRatePercent: 30,
    highSeverityRatePercent: 50,
  },
  collusion: {
    minParticipants: 3,
    minCommonPhases: 3,
    syncDeltaMs: 3000,
    minScoreThreshold: 4.0,
    highScoreThreshold: 8.0,
    agreementRateThreshold: 80,
    sequentialRatioThreshold: 0.50,
    followerConsistencyRatio: 0.70,
  },
} as const;
