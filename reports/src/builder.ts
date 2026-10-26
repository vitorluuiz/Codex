import { generateAccessToken, generateShareToken } from './tokens.js';
import type {
  IndividualReportDto,
  MatchReportDocument,
  RawAnswerPayload,
  RawMatchDocument,
  RawMatchPhase,
  ReportOptionDistribution,
  ReportParticipantAnalysis,
  ReportParticipantAnswer,
  ReportPhaseAnalysis,
} from './types.js';

function toIso(date: string | Date | undefined | null): string {
  if (!date) return new Date().toISOString();
  if (date instanceof Date) return date.toISOString();
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function formatSetTitle(titles: string[]): string {
  const clean = titles.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return 'Partida sem título';
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} + ${clean[1]}`;
  return `${clean[0]} + ${clean.length - 1} conjuntos`;
}

function parseOptionIndex(optionId: string | null | undefined): number | null {
  if (!optionId) return null;
  const match = /^o(\d+)$/i.exec(optionId.trim());
  if (!match) return null;
  const oneBased = Number(match[1]);
  return Number.isInteger(oneBased) && oneBased >= 1 ? oneBased - 1 : null;
}

export function formatCorrectAnswer(phase: RawMatchPhase): string {
  const content = phase.content ?? {};
  switch (phase.kind) {
    case 'quiz': {
      const options = content.options ?? [];
      const correctIndexes = content.correctIndexes ?? [];
      const labels = correctIndexes
        .map((idx) => options[idx])
        .filter((val): val is string => typeof val === 'string' && val.trim().length > 0);
      return labels.length > 0 ? labels.join(' | ') : '—';
    }
    case 'fill': {
      const blanks = (content.blanks ?? []).map((b) => b ?? '___');
      return blanks.length > 0 ? blanks.join(' · ') : '—';
    }
    case 'text':
      return content.expectedAnswer?.trim() || 'Correção aberta';
    case 'code':
      return content.testCases?.trim()
        ? content.testCases.trim().split('\n').slice(0, 2).join(' / ')
        : 'Casos de teste';
    default:
      return '—';
  }
}

export function formatGivenAnswer(phase: RawMatchPhase, answer: RawAnswerPayload | undefined): string {
  if (!answer) return 'Não respondeu';
  const content = phase.content ?? {};

  switch (phase.kind) {
    case 'quiz': {
      const options = content.options ?? [];
      const idx = parseOptionIndex(answer.optionId);
      if (idx !== null && idx >= 0 && idx < options.length) {
        return options[idx] ?? answer.optionId ?? '—';
      }
      return answer.optionId || 'Em branco';
    }
    case 'fill': {
      const blanks = answer.blanks ?? [];
      if (blanks.length === 0) return 'Em branco';
      return blanks.map((b) => (b && b.trim() ? b.trim() : '___')).join(' · ');
    }
    case 'text':
      return answer.value?.trim() || 'Em branco';
    case 'code': {
      const src = answer.source?.trim();
      if (!src) return 'Em branco';
      const lang = answer.languageId ? `[${answer.languageId}] ` : '';
      const compact = src.replace(/\s+/g, ' ');
      return compact.length > 100 ? `${lang}${compact.slice(0, 97)}...` : `${lang}${compact}`;
    }
    default:
      return '—';
  }
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function buildMatchReport(match: RawMatchDocument, tokenSecret: string): MatchReportDocument {
  const matchId = match.id;
  const shareToken = generateShareToken(tokenSecret, matchId);

  const orderedSets = [...(match.phaseSets ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);
  const setById = new Map(orderedSets.map((s) => [s.queueSetId, s.title]));
  const title = formatSetTitle(orderedSets.map((s) => s.title));

  const orderedPhases = [...(match.phases ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);
  const rawParticipants = [...(match.participants ?? [])].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (a.totalElapsedSeconds !== b.totalElapsedSeconds) {
      return a.totalElapsedSeconds - b.totalElapsedSeconds;
    }
    return toIso(a.joinedAt).localeCompare(toIso(b.joinedAt));
  });

  const participantCount = rawParticipants.length;
  const phaseCount = orderedPhases.length;
  const maxPossibleScore = orderedPhases.reduce((acc, p) => acc + (p.maxScore || 0), 0);

  const startedAtIso = toIso(match.startedAt);
  const finishedAtIso = toIso(match.finishedAt);
  const durationSeconds = Math.max(
    1,
    Math.round((new Date(finishedAtIso).getTime() - new Date(startedAtIso).getTime()) / 1000),
  );

  // Analise por fase
  const phasesAnalysis: ReportPhaseAnalysis[] = orderedPhases.map((phase, idx) => {
    const subs = rawParticipants
      .map((p) => (p.submissions ?? []).find((s) => s.phaseId === phase.phaseId))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);

    const submittedCount = subs.length;
    const gradedSubs = subs.filter((s) => s.grading === 'graded');
    const correctCount = gradedSubs.filter((s) => s.correct === true).length;
    const incorrectCount = gradedSubs.filter((s) => s.correct === false).length;
    const pendingCount = subs.filter((s) => s.grading === 'pending').length;
    const unansweredCount = Math.max(0, participantCount - submittedCount);

    const accuracyRate =
      gradedSubs.length > 0 ? Math.round((correctCount / gradedSubs.length) * 100) : 0;

    // Pontuacao media na fase considera todos os participantes (quem nao respondeu tirou 0)
    const totalPhaseScore = subs.reduce((acc, s) => acc + (s.score ?? 0), 0);
    const avgScore = participantCount > 0 ? Math.round(totalPhaseScore / participantCount) : 0;

    const totalElapsed = subs.reduce((acc, s) => acc + (s.elapsedSeconds ?? 0), 0);
    const avgElapsedSeconds =
      submittedCount > 0 ? Math.round((totalElapsed / submittedCount) * 10) / 10 : 0;

    const optionDistribution: ReportOptionDistribution[] = [];
    let mostCommonAnswerText: string | null = null;

    if (phase.kind === 'quiz') {
      const options = phase.content?.options ?? [];
      const correctSet = new Set(phase.content?.correctIndexes ?? []);
      options.forEach((label, optIdx) => {
        const optionId = `o${optIdx + 1}`;
        const count = subs.filter(
          (s) => s.answer?.optionId?.toLowerCase() === optionId.toLowerCase(),
        ).length;
        const percentage = submittedCount > 0 ? Math.round((count / submittedCount) * 100) : 0;
        optionDistribution.push({
          optionId,
          label,
          isCorrect: correctSet.has(optIdx),
          count,
          percentage,
        });
      });

      const topOption = [...optionDistribution].sort((a, b) => b.count - a.count)[0];
      if (topOption && topOption.count > 0) {
        mostCommonAnswerText = `${topOption.label} (${topOption.percentage}%)`;
      }
    } else if (submittedCount > 0) {
      const counts = new Map<string, number>();
      for (const s of subs) {
        const text = formatGivenAnswer(phase, s.answer);
        counts.set(text, (counts.get(text) ?? 0) + 1);
      }
      let bestText: string | null = null;
      let bestCount = 0;
      for (const [text, count] of counts.entries()) {
        if (count > bestCount) {
          bestText = text;
          bestCount = count;
        }
      }
      if (bestText) {
        const pct = Math.round((bestCount / submittedCount) * 100);
        mostCommonAnswerText = `${bestText} (${pct}%)`;
      }
    }

    return {
      phaseId: phase.phaseId,
      orderIndex: phase.orderIndex,
      phaseNumber: idx + 1,
      setTitle: setById.get(phase.queueSetId) ?? title,
      kind: phase.kind,
      name: phase.name || `Fase ${idx + 1}`,
      question: phase.content?.question?.trim() || phase.name || `Fase ${idx + 1}`,
      basePoints: phase.basePoints,
      pointsMultiplier: Number(phase.pointsMultiplier ?? 1),
      maxScore: phase.maxScore,
      timeSeconds: phase.timeSeconds,
      correctAnswerText: formatCorrectAnswer(phase),
      submittedCount,
      correctCount,
      incorrectCount,
      unansweredCount,
      pendingCount,
      accuracyRate,
      avgScore,
      avgElapsedSeconds,
      mostCommonAnswerText,
      optionDistribution,
    };
  });

  const phaseAnalysisById = new Map(phasesAnalysis.map((p) => [p.phaseId, p]));

  // Analise por participante
  const participantsAnalysis: ReportParticipantAnalysis[] = rawParticipants.map((p, idx) => {
    const rank = idx + 1;
    const percentile =
      participantCount <= 1
        ? 100
        : Math.round(((participantCount - rank) / (participantCount - 1)) * 100);

    const subByPhaseId = new Map((p.submissions ?? []).map((s) => [s.phaseId, s]));

    const answers: ReportParticipantAnswer[] = orderedPhases.map((phase, pIdx) => {
      const sub = subByPhaseId.get(phase.phaseId);
      const phaseStats = phaseAnalysisById.get(phase.phaseId);

      if (!sub) {
        return {
          phaseId: phase.phaseId,
          phaseNumber: pIdx + 1,
          phaseName: phase.name || `Fase ${pIdx + 1}`,
          kind: phase.kind,
          question: phase.content?.question?.trim() || phase.name || `Fase ${pIdx + 1}`,
          submitted: false,
          grading: 'unanswered',
          correct: false,
          score: 0,
          maxScore: phase.maxScore,
          classAvgScore: phaseStats?.avgScore ?? 0,
          classAccuracyRate: phaseStats?.accuracyRate ?? 0,
          elapsedSeconds: null,
          timeSeconds: phase.timeSeconds,
          givenAnswerText: 'Não respondeu',
          correctAnswerText: phaseStats?.correctAnswerText ?? formatCorrectAnswer(phase),
          explanation: null,
        };
      }

      return {
        phaseId: phase.phaseId,
        phaseNumber: pIdx + 1,
        phaseName: phase.name || `Fase ${pIdx + 1}`,
        kind: phase.kind,
        question: phase.content?.question?.trim() || phase.name || `Fase ${pIdx + 1}`,
        submitted: true,
        grading: sub.grading,
        correct: sub.grading === 'graded' ? Boolean(sub.correct) : null,
        score: sub.score ?? 0,
        maxScore: phase.maxScore,
        classAvgScore: phaseStats?.avgScore ?? 0,
        classAccuracyRate: phaseStats?.accuracyRate ?? 0,
        elapsedSeconds: sub.elapsedSeconds,
        timeSeconds: phase.timeSeconds,
        givenAnswerText: formatGivenAnswer(phase, sub.answer),
        correctAnswerText: phaseStats?.correctAnswerText ?? formatCorrectAnswer(phase),
        explanation: sub.explanation ?? null,
      };
    });

    const submittedAnswers = answers.filter((a) => a.submitted);
    const gradedAnswers = answers.filter((a) => a.grading === 'graded');
    const correctCount = gradedAnswers.filter((a) => a.correct === true).length;
    const incorrectCount = gradedAnswers.filter((a) => a.correct === false).length;
    const pendingCount = answers.filter((a) => a.grading === 'pending').length;
    const unansweredCount = answers.filter((a) => !a.submitted).length;

    const accuracyRate =
      gradedAnswers.length > 0 ? Math.round((correctCount / gradedAnswers.length) * 100) : 0;
    const scorePercentage =
      maxPossibleScore > 0 ? Math.round((p.totalScore / maxPossibleScore) * 100) : 0;
    const avgElapsedSeconds =
      submittedAnswers.length > 0
        ? Math.round((p.totalElapsedSeconds / submittedAnswers.length) * 10) / 10
        : 0;

    return {
      participantId: p.participantId,
      userId: p.userId ?? null,
      displayName: p.displayName,
      avatarIndex: p.avatarIndex,
      rank,
      percentile,
      accessToken: generateAccessToken(tokenSecret, matchId, p.participantId),
      joinedAt: toIso(p.joinedAt),
      totalScore: p.totalScore,
      maxPossibleScore,
      scorePercentage,
      gradedCount: gradedAnswers.length,
      correctCount,
      incorrectCount,
      unansweredCount,
      pendingCount,
      accuracyRate,
      totalElapsedSeconds: p.totalElapsedSeconds,
      avgElapsedSeconds,
      answers,
    };
  });

  const scores = participantsAnalysis.map((p) => p.totalScore);
  const totalSubmissions = participantsAnalysis.reduce(
    (acc, p) => acc + (phaseCount - p.unansweredCount),
    0,
  );
  const totalGraded = participantsAnalysis.reduce((acc, p) => acc + p.gradedCount, 0);
  const totalCorrect = participantsAnalysis.reduce((acc, p) => acc + p.correctCount, 0);
  const totalPending = participantsAnalysis.reduce((acc, p) => acc + p.pendingCount, 0);
  const totalElapsedAll = participantsAnalysis.reduce((acc, p) => acc + p.totalElapsedSeconds, 0);

  const avgScore =
    participantCount > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / participantCount)
      : (match.stats?.avgScore ?? 0);
  const maxAchievedScore = scores.length > 0 ? Math.max(...scores) : 0;
  const minAchievedScore = scores.length > 0 ? Math.min(...scores) : 0;
  const medianScore = computeMedian(scores);
  const accuracyRate =
    totalGraded > 0
      ? Math.round((totalCorrect / totalGraded) * 100)
      : (match.stats?.accuracyRate ?? 0);
  const avgResponseSeconds =
    totalSubmissions > 0 ? Math.round((totalElapsedAll / totalSubmissions) * 10) / 10 : 0;

  return {
    id: matchId,
    matchId,
    schemaVersion: 1,
    status: 'ready',
    shareToken,
    roomCode: match.roomCode,
    roomId: match.roomId,
    leaderUserId: match.leaderUserId,
    mode: match.mode,
    title,
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    generatedAt: new Date().toISOString(),
    durationSeconds,
    phaseSets: orderedSets,
    overview: {
      participantCount,
      phaseCount,
      avgScore,
      maxPossibleScore,
      maxAchievedScore,
      minAchievedScore,
      medianScore,
      accuracyRate,
      totalSubmissions,
      totalGraded,
      totalCorrect,
      totalPending,
      avgResponseSeconds,
      durationSeconds,
    },
    phases: phasesAnalysis,
    participants: participantsAnalysis,
  };
}

export function toIndividualReport(
  report: MatchReportDocument,
  participant: ReportParticipantAnalysis,
): IndividualReportDto {
  return {
    matchId: report.matchId,
    roomCode: report.roomCode,
    mode: report.mode,
    title: report.title,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    generatedAt: report.generatedAt,
    durationSeconds: report.durationSeconds,
    classOverview: {
      participantCount: report.overview.participantCount,
      phaseCount: report.overview.phaseCount,
      avgScore: report.overview.avgScore,
      maxPossibleScore: report.overview.maxPossibleScore,
      maxAchievedScore: report.overview.maxAchievedScore,
      accuracyRate: report.overview.accuracyRate,
      avgResponseSeconds: report.overview.avgResponseSeconds,
    },
    participant,
  };
}
