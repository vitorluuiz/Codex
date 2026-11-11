import type {
  GuessingEvent,
  GuessingInsight,
  InsightSeverity,
  QuestionInsight,
  ReportParticipantAnalysis,
  ReportInsights,
} from '../types.js';
import { INSIGHT_THRESHOLDS } from './thresholds.js';

export function computeGuessingInsights(
  participantsAnalysis: ReportParticipantAnalysis[],
  questionInsights: QuestionInsight[],
): ReportInsights['guessing'] {
  if (participantsAnalysis.length === 0) {
    return {
      eligible: false,
      reason: 'Sem participantes na partida.',
      participants: [],
    };
  }

  const totalGradedAcrossAll = participantsAnalysis.reduce((acc, p) => acc + p.gradedCount, 0);
  if (totalGradedAcrossAll === 0) {
    return {
      eligible: false,
      reason: 'Nenhuma submissão corrigida para avaliar tempo de resposta.',
      participants: [],
    };
  }

  const questionByPhaseId = new Map<string, QuestionInsight>(
    questionInsights.map((q) => [q.phaseId, q]),
  );

  const flaggedParticipants: GuessingInsight[] = [];

  for (const participant of participantsAnalysis) {
    const gradedAnswers = participant.answers.filter(
      (a) => a.submitted && a.grading === 'graded' && a.elapsedSeconds !== null,
    );

    if (gradedAnswers.length < INSIGHT_THRESHOLDS.guessing.minOccurrences) {
      continue;
    }

    const events: GuessingEvent[] = [];
    let fastWrongCount = 0;
    let lateWrongCount = 0;

    for (const ans of gradedAnswers) {
      if (ans.correct !== false) continue;

      const elapsed = ans.elapsedSeconds ?? 0;
      const timeSec = Math.max(1, ans.timeSeconds || 30);
      const qInsight = questionByPhaseId.get(ans.phaseId);
      const readingSec = qInsight?.estimatedReadingSeconds ?? 4;

      const fastCutoff = Math.max(
        INSIGHT_THRESHOLDS.guessing.fastMinSec,
        Math.min(
          Math.floor(timeSec * INSIGHT_THRESHOLDS.guessing.fastRatio),
          Math.floor(readingSec * INSIGHT_THRESHOLDS.guessing.fastReadingRatio),
        ),
      );

      const lateWindow = Math.max(
        INSIGHT_THRESHOLDS.guessing.lateWindowMinSec,
        Math.round(timeSec * INSIGHT_THRESHOLDS.guessing.lateWindowRatio),
      );
      const lateCutoff = Math.max(fastCutoff + 1, timeSec - lateWindow);

      if (elapsed <= fastCutoff) {
        fastWrongCount++;
        events.push({
          phaseId: ans.phaseId,
          phaseNumber: ans.phaseNumber,
          phaseName: ans.phaseName,
          type: 'fast_wrong',
          elapsedSeconds: elapsed,
          timeSeconds: timeSec,
          givenAnswerText: ans.givenAnswerText,
        });
      } else if (elapsed >= lateCutoff) {
        lateWrongCount++;
        events.push({
          phaseId: ans.phaseId,
          phaseNumber: ans.phaseNumber,
          phaseName: ans.phaseName,
          type: 'late_wrong',
          elapsedSeconds: elapsed,
          timeSeconds: timeSec,
          givenAnswerText: ans.givenAnswerText,
        });
      }
    }

    const totalGuessEvents = fastWrongCount + lateWrongCount;
    const guessRate = Math.round((totalGuessEvents / gradedAnswers.length) * 100);

    if (
      totalGuessEvents >= INSIGHT_THRESHOLDS.guessing.minOccurrences &&
      guessRate >= INSIGHT_THRESHOLDS.guessing.minRatePercent
    ) {
      const severity: InsightSeverity =
        guessRate >= INSIGHT_THRESHOLDS.guessing.highSeverityRatePercent ? 'high' : 'medium';

      flaggedParticipants.push({
        participantId: participant.participantId,
        displayName: participant.displayName,
        avatarIndex: participant.avatarIndex,
        gradedCount: gradedAnswers.length,
        fastWrongCount,
        lateWrongCount,
        guessRate,
        severity,
        events,
      });
    }
  }

  flaggedParticipants.sort((a, b) => {
    if (b.guessRate !== a.guessRate) return b.guessRate - a.guessRate;
    return b.events.length - a.events.length;
  });

  return {
    eligible: true,
    reason: null,
    participants: flaggedParticipants,
  };
}
