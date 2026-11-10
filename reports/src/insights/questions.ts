import type {
  DifficultyLevel,
  QuestionFlag,
  QuestionInsight,
  RawMatchDocument,
  RawMatchPhase,
  ReportParticipantAnalysis,
  ReportPhaseAnalysis,
} from '../types.js';
import { countWords, estimateReadingSeconds } from './text.js';
import { INSIGHT_THRESHOLDS } from './thresholds.js';

function classifyDifficulty(accuracyRate: number, gradedCount: number): DifficultyLevel {
  if (gradedCount < INSIGHT_THRESHOLDS.difficulty.minParticipants) {
    return 'insufficient';
  }
  if (accuracyRate >= INSIGHT_THRESHOLDS.difficulty.veryEasyMin) return 'very_easy';
  if (accuracyRate >= INSIGHT_THRESHOLDS.difficulty.easyMin) return 'easy';
  if (accuracyRate <= INSIGHT_THRESHOLDS.difficulty.veryHardMax) return 'very_hard';
  if (accuracyRate <= INSIGHT_THRESHOLDS.difficulty.hardMax) return 'hard';
  return 'medium';
}

export function computeQuestionInsights(
  rawMatch: RawMatchDocument,
  phasesAnalysis: ReportPhaseAnalysis[],
  participantsAnalysis: ReportParticipantAnalysis[],
): QuestionInsight[] {
  const rawPhaseById = new Map<string, RawMatchPhase>(
    (rawMatch.phases ?? []).map((p) => [p.phaseId, p]),
  );
  const participantCount = participantsAnalysis.length;

  return phasesAnalysis.map((ph) => {
    const rawPhase = rawPhaseById.get(ph.phaseId);
    const timeSeconds = Math.max(1, ph.timeSeconds || 30);

    // Submissões brutas desta fase por participante
    const subByParticipant = new Map<
      string,
      NonNullable<RawMatchDocument['participants'][number]['submissions']>[number]
    >();
    for (const rp of rawMatch.participants ?? []) {
      const found = (rp.submissions ?? []).find((s) => s.phaseId === ph.phaseId);
      if (found) {
        subByParticipant.set(rp.participantId, found);
      }
    }

    const allSubs = [...subByParticipant.values()];
    const gradedSubs = allSubs.filter((s) => s.grading === 'graded');
    const gradedCount = gradedSubs.length;

    const difficulty = classifyDifficulty(ph.accuracyRate, gradedCount);
    const flags: QuestionFlag[] = [];

    // 1. Contagem de texto e estimativa de leitura
    const questionText = rawPhase?.content?.question?.trim() || ph.question || '';
    const questionWordCount = countWords(questionText);
    const questionCharCount = questionText.length;

    let avgOptionCharCount: number | null = null;
    let maxOptionCharCount: number | null = null;
    let extraWords = 0;

    if (ph.kind === 'quiz') {
      const options = (rawPhase?.content?.options ?? []).map((o) => (o ?? '').trim());
      if (options.length > 0) {
        const lengths = options.map((o) => o.length);
        const totalChars = lengths.reduce((a, b) => a + b, 0);
        avgOptionCharCount = Math.round(totalChars / options.length);
        maxOptionCharCount = Math.max(...lengths);
        extraWords = options.reduce((acc, o) => acc + countWords(o), 0);
      }
    } else if (ph.kind === 'fill') {
      const bankWords = rawPhase?.content?.words ?? [];
      extraWords = bankWords.reduce((acc, w) => acc + countWords(w), 0);
    }

    const estimatedReadingSeconds = estimateReadingSeconds(questionWordCount + extraWords);

    if (
      questionWordCount > INSIGHT_THRESHOLDS.reading.maxQuestionWords ||
      questionCharCount > INSIGHT_THRESHOLDS.reading.maxQuestionChars
    ) {
      flags.push('long_question');
    }

    if (
      (avgOptionCharCount !== null &&
        avgOptionCharCount > INSIGHT_THRESHOLDS.reading.avgOptionCharsWarning) ||
      (maxOptionCharCount !== null &&
        maxOptionCharCount > INSIGHT_THRESHOLDS.reading.maxOptionCharsWarning)
    ) {
      flags.push('long_options');
    }

    if (estimatedReadingSeconds > timeSeconds * INSIGHT_THRESHOLDS.reading.timeExceedRatio) {
      flags.push('reading_exceeds_time');
    }

    // 2. Pressão de tempo e janela final
    const finalWindowSec = Math.max(
      INSIGHT_THRESHOLDS.timing.finalWindowMinSec,
      Math.round(timeSeconds * INSIGHT_THRESHOLDS.timing.finalWindowRatio),
    );
    const lateThresholdSec = Math.max(1, timeSeconds - finalWindowSec);

    const lateSubs = allSubs.filter((s) => (s.elapsedSeconds ?? 0) >= lateThresholdSec);
    const lateWrongSubs = gradedSubs.filter(
      (s) => s.correct === false && (s.elapsedSeconds ?? 0) >= lateThresholdSec,
    );

    const unansweredRate =
      participantCount > 0 ? Math.round((ph.unansweredCount / participantCount) * 100) : 0;
    const lateSubmissionRate =
      ph.submittedCount > 0 ? Math.round((lateSubs.length / ph.submittedCount) * 100) : 0;
    const lateWrongRate =
      gradedCount > 0 ? Math.round((lateWrongSubs.length / gradedCount) * 100) : 0;

    // Nao envios sao contabilizados como 100% do tempo limite utilizado
    const submittedElapsedSum = allSubs.reduce(
      (acc, s) => acc + Math.min(timeSeconds, Math.max(0, s.elapsedSeconds ?? 0)),
      0,
    );
    const effectiveAvgElapsed =
      participantCount > 0
        ? (submittedElapsedSum + ph.unansweredCount * timeSeconds) / participantCount
        : ph.avgElapsedSeconds;
    const avgTimeUsageRate = Math.min(
      100,
      Math.round((effectiveAvgElapsed / timeSeconds) * 100),
    );

    if (
      participantCount >= INSIGHT_THRESHOLDS.difficulty.minParticipants &&
      (unansweredRate >= INSIGHT_THRESHOLDS.timing.shortUnansweredRatio * 100 ||
        (ph.submittedCount >= 2 &&
          lateSubmissionRate >= INSIGHT_THRESHOLDS.timing.shortLateSubmissionsRatio * 100) ||
        (gradedCount >= 2 &&
          lateWrongRate >= INSIGHT_THRESHOLDS.timing.shortLateWrongRatio * 100))
    ) {
      flags.push('time_too_short');
    }

    if (
      ph.submittedCount >= INSIGHT_THRESHOLDS.difficulty.minParticipants &&
      avgTimeUsageRate <= INSIGHT_THRESHOLDS.timing.longElapsedRatio * 100 &&
      ph.accuracyRate >= INSIGHT_THRESHOLDS.timing.longAccuracyMin
    ) {
      flags.push('time_too_long');
    }

    // 3. Discriminação Item-Rest (27% superior vs 27% inferior excluindo a pontuação desta fase)
    const rankedByRestScore = [...participantsAnalysis].sort((a, b) => {
      const aPhaseScore = subByParticipant.get(a.participantId)?.score ?? 0;
      const bPhaseScore = subByParticipant.get(b.participantId)?.score ?? 0;
      const aRest = a.totalScore - aPhaseScore;
      const bRest = b.totalScore - bPhaseScore;
      if (bRest !== aRest) return bRest - aRest;
      return a.rank - b.rank;
    });

    const groupSize = Math.max(
      1,
      Math.round(participantCount * INSIGHT_THRESHOLDS.discrimination.ratio),
    );
    const upperGroup = rankedByRestScore.slice(0, groupSize);
    const lowerGroup = rankedByRestScore.slice(Math.max(0, participantCount - groupSize));

    let discriminationIndex: number | null = null;
    if (
      participantCount >= INSIGHT_THRESHOLDS.discrimination.minParticipants &&
      gradedCount >= INSIGHT_THRESHOLDS.discrimination.minParticipants
    ) {
      const upperCorrect = upperGroup.filter(
        (p) => subByParticipant.get(p.participantId)?.correct === true,
      ).length;
      const lowerCorrect = lowerGroup.filter(
        (p) => subByParticipant.get(p.participantId)?.correct === true,
      ).length;
      discriminationIndex =
        Math.round(((upperCorrect / groupSize) - (lowerCorrect / groupSize)) * 100) / 100;

      if (discriminationIndex < 0) {
        flags.push('negative_discrimination');
      } else if (discriminationIndex < INSIGHT_THRESHOLDS.discrimination.lowThreshold) {
        flags.push('low_discrimination');
      }
    }

    // 4. Análise de distratores e gabarito suspeito (Quiz)
    let topDistractor: QuestionInsight['topDistractor'] = null;
    if (ph.kind === 'quiz' && ph.optionDistribution.length > 0) {
      const distractors = ph.optionDistribution.filter((o) => !o.isCorrect);
      const bestDistractor = [...distractors].sort((a, b) => b.count - a.count)[0];

      if (bestDistractor && bestDistractor.count > 0) {
        const upperSubmitted = upperGroup.filter((p) => subByParticipant.has(p.participantId));
        const upperPickedDistractor = upperSubmitted.filter(
          (p) =>
            subByParticipant.get(p.participantId)?.answer?.optionId?.toLowerCase() ===
            bestDistractor.optionId.toLowerCase(),
        ).length;
        const upperPickedCorrect = upperSubmitted.filter(
          (p) => subByParticipant.get(p.participantId)?.correct === true,
        ).length;

        const upperGroupPercentage =
          upperSubmitted.length > 0
            ? Math.round((upperPickedDistractor / upperSubmitted.length) * 100)
            : 0;

        topDistractor = {
          label: bestDistractor.label,
          percentage: bestDistractor.percentage,
          upperGroupPercentage,
        };

        const distractorBeatsCorrectOverall =
          gradedCount >= INSIGHT_THRESHOLDS.difficulty.minParticipants &&
          bestDistractor.count > ph.correctCount;
        const distractorBeatsCorrectInUpper =
          upperSubmitted.length >= 2 && upperPickedDistractor > upperPickedCorrect;

        if (distractorBeatsCorrectOverall || distractorBeatsCorrectInUpper) {
          flags.push('suspect_answer_key');
        }
      }
    }

    return {
      phaseId: ph.phaseId,
      phaseNumber: ph.phaseNumber,
      difficulty,
      accuracyRate: ph.accuracyRate,
      discriminationIndex,
      unansweredRate,
      lateSubmissionRate,
      lateWrongRate,
      avgTimeUsageRate,
      questionWordCount,
      questionCharCount,
      avgOptionCharCount,
      maxOptionCharCount,
      estimatedReadingSeconds,
      topDistractor,
      flags,
    };
  });
}
