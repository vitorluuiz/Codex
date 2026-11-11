import type {
  RawMatchDocument,
  ReportInsights,
  ReportParticipantAnalysis,
  ReportPhaseAnalysis,
} from '../types.js';
import { computeCollusionInsights } from './collusion.js';
import { computeGuessingInsights } from './guessing.js';
import { computeQuestionInsights } from './questions.js';
import { THRESHOLDS_VERSION } from './thresholds.js';

export function buildReportInsights(
  rawMatch: RawMatchDocument,
  phasesAnalysis: ReportPhaseAnalysis[],
  participantsAnalysis: ReportParticipantAnalysis[],
): ReportInsights {
  const questions = computeQuestionInsights(rawMatch, phasesAnalysis, participantsAnalysis);
  const guessing = computeGuessingInsights(participantsAnalysis, questions);
  const collusion = computeCollusionInsights(rawMatch, participantsAnalysis);

  const easiest = questions
    .filter((q) => q.difficulty === 'very_easy' || q.difficulty === 'easy')
    .sort((a, b) => b.accuracyRate - a.accuracyRate)
    .slice(0, 3)
    .map((q) => q.phaseId);

  const hardest = questions
    .filter((q) => q.difficulty === 'very_hard' || q.difficulty === 'hard')
    .sort((a, b) => a.accuracyRate - b.accuracyRate)
    .slice(0, 3)
    .map((q) => q.phaseId);

  const flaggedQuestionCount = questions.filter((q) => q.flags.length > 0).length;

  return {
    thresholdsVersion: THRESHOLDS_VERSION,
    questions,
    guessing,
    collusion,
    highlights: {
      easiest,
      hardest,
      flaggedQuestionCount,
      flaggedGuessers: guessing.participants.length,
      flaggedPairs: collusion.pairs.length,
    },
  };
}
