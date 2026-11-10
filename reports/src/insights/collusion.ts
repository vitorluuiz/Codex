import { formatGivenAnswer } from '../builder.js';
import type {
  CollusionEvidence,
  CollusionGroup,
  CollusionPair,
  InsightSeverity,
  RawMatchDocument,
  RawMatchPhase,
  ReportInsights,
  ReportParticipantAnalysis,
} from '../types.js';
import { normalizeAnswerText } from './text.js';
import { INSIGHT_THRESHOLDS } from './thresholds.js';

interface SubmissionEntry {
  normalizedAnswer: string;
  displayAnswer: string;
  correct: boolean | null;
  grading: 'graded' | 'pending';
  submittedAtMs: number | null;
}

function parseTimestampMs(raw: string | Date | undefined | null): number | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function severityRank(s: InsightSeverity): number {
  if (s === 'high') return 3;
  if (s === 'medium') return 2;
  return 1;
}

export function computeCollusionInsights(
  rawMatch: RawMatchDocument,
  participantsAnalysis: ReportParticipantAnalysis[],
): ReportInsights['collusion'] {
  const participantCount = participantsAnalysis.length;
  const phases = [...(rawMatch.phases ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);

  if (participantCount < INSIGHT_THRESHOLDS.collusion.minParticipants) {
    return {
      eligible: false,
      reason: `Mínimo de ${INSIGHT_THRESHOLDS.collusion.minParticipants} participantes necessário para análise comparativa de pares.`,
      pairs: [],
      groups: [],
    };
  }

  if (phases.length < INSIGHT_THRESHOLDS.collusion.minCommonPhases) {
    return {
      eligible: false,
      reason: `Mínimo de ${INSIGHT_THRESHOLDS.collusion.minCommonPhases} fases necessário para análise de padrões de colusão.`,
      pairs: [],
      groups: [],
    };
  }

  const rawByParticipantId = new Map(
    (rawMatch.participants ?? []).map((p) => [p.participantId, p]),
  );

  // Mapa: phaseId -> (participantId -> SubmissionEntry)
  const phaseSubMap = new Map<string, Map<string, SubmissionEntry>>();
  // Mapa: phaseId -> (normalizedAnswer -> contagem na turma)
  const phaseAnswerFrequency = new Map<string, Map<string, number>>();

  for (const phase of phases) {
    const subMap = new Map<string, SubmissionEntry>();
    const freqMap = new Map<string, number>();

    for (const part of participantsAnalysis) {
      const rawPart = rawByParticipantId.get(part.participantId);
      const rawSub = (rawPart?.submissions ?? []).find((s) => s.phaseId === phase.phaseId);
      if (!rawSub) continue;

      const displayAnswer = formatGivenAnswer(phase as RawMatchPhase, rawSub.answer);
      const normalized =
        phase.kind === 'quiz'
          ? normalizeAnswerText(rawSub.answer?.optionId || displayAnswer)
          : normalizeAnswerText(displayAnswer);

      if (!normalized || normalized === 'nao respondeu' || normalized === 'em branco') {
        continue;
      }

      subMap.set(part.participantId, {
        normalizedAnswer: normalized,
        displayAnswer,
        correct: rawSub.grading === 'graded' ? Boolean(rawSub.correct) : null,
        grading: rawSub.grading,
        submittedAtMs: parseTimestampMs(rawSub.submittedAt),
      });

      freqMap.set(normalized, (freqMap.get(normalized) ?? 0) + 1);
    }

    phaseSubMap.set(phase.phaseId, subMap);
    phaseAnswerFrequency.set(phase.phaseId, freqMap);
  }

  const flaggedPairs: CollusionPair[] = [];

  for (let i = 0; i < participantsAnalysis.length; i++) {
    const partA = participantsAnalysis[i]!;
    for (let j = i + 1; j < participantsAnalysis.length; j++) {
      const partB = participantsAnalysis[j]!;

      let commonPhases = 0;
      let identicalAnswers = 0;
      let sharedWrongCount = 0;
      let weightedRareSharedWrong = 0;
      let sequentialCount = 0;
      let aFollowedB = 0;
      let bFollowedA = 0;
      const evidence: CollusionEvidence[] = [];

      for (let pIdx = 0; pIdx < phases.length; pIdx++) {
        const phase = phases[pIdx]!;
        const subMap = phaseSubMap.get(phase.phaseId);
        const subA = subMap?.get(partA.participantId);
        const subB = subMap?.get(partB.participantId);

        if (!subA || !subB) continue;
        commonPhases++;

        if (subA.normalizedAnswer !== subB.normalizedAnswer) continue;
        identicalAnswers++;

        const phaseNumber = pIdx + 1;
        const phaseName = phase.name || `Fase ${phaseNumber}`;
        const freq = phaseAnswerFrequency.get(phase.phaseId)?.get(subA.normalizedAnswer) ?? 2;
        const rarity = Math.round(Math.max(0.05, 1 - freq / participantCount) * 100) / 100;

        const isSharedWrong =
          subA.grading === 'graded' &&
          subB.grading === 'graded' &&
          subA.correct === false &&
          subB.correct === false;

        let deltaMs: number | null = null;
        let followerId: string | null = null;
        let isSequential = false;

        if (subA.submittedAtMs !== null && subB.submittedAtMs !== null) {
          deltaMs = Math.abs(subA.submittedAtMs - subB.submittedAtMs);
          if (deltaMs <= INSIGHT_THRESHOLDS.collusion.syncDeltaMs) {
            isSequential = true;
            sequentialCount++;
            if (subB.submittedAtMs >= subA.submittedAtMs) {
              bFollowedA++;
              followerId = partB.participantId;
            } else {
              aFollowedB++;
              followerId = partA.participantId;
            }
          }
        }

        if (isSharedWrong) {
          sharedWrongCount++;
          weightedRareSharedWrong += rarity;
          evidence.push({
            phaseId: phase.phaseId,
            phaseNumber,
            phaseName,
            type: 'shared_wrong',
            answerText: subA.displayAnswer,
            rarity,
            deltaMs: isSequential ? deltaMs : null,
            followerParticipantId: isSequential ? followerId : null,
          });
        } else if (isSequential) {
          evidence.push({
            phaseId: phase.phaseId,
            phaseNumber,
            phaseName,
            type: 'sequential_same',
            answerText: subA.displayAnswer,
            rarity: null,
            deltaMs,
            followerParticipantId: followerId,
          });
        }
      }

      if (commonPhases < INSIGHT_THRESHOLDS.collusion.minCommonPhases) {
        continue;
      }

      const agreementRate = Math.round((identicalAnswers / commonPhases) * 100);
      weightedRareSharedWrong = Math.round(weightedRareSharedWrong * 100) / 100;

      let dominantFollowerId: string | null = null;
      if (sequentialCount >= 2) {
        if (bFollowedA / sequentialCount >= INSIGHT_THRESHOLDS.collusion.followerConsistencyRatio) {
          dominantFollowerId = partB.participantId;
        } else if (
          aFollowedB / sequentialCount >= INSIGHT_THRESHOLDS.collusion.followerConsistencyRatio
        ) {
          dominantFollowerId = partA.participantId;
        }
      }

      const rawScore =
        weightedRareSharedWrong * 2.5 +
        sharedWrongCount * 1.0 +
        sequentialCount * (dominantFollowerId ? 1.5 : 0.8);
      const score = Math.round(rawScore * 10) / 10;

      const flaggedByScore = score >= INSIGHT_THRESHOLDS.collusion.minScoreThreshold;
      const flaggedBySharedWrong =
        sharedWrongCount >= 2 &&
        agreementRate >= INSIGHT_THRESHOLDS.collusion.agreementRateThreshold;
      const flaggedBySequential =
        sequentialCount >= 3 &&
        sequentialCount / commonPhases >= INSIGHT_THRESHOLDS.collusion.sequentialRatioThreshold;

      if (flaggedByScore || flaggedBySharedWrong || flaggedBySequential) {
        const severity: InsightSeverity =
          score >= INSIGHT_THRESHOLDS.collusion.highScoreThreshold
            ? 'high'
            : score >= 5.0 || (sharedWrongCount >= 2 && sequentialCount >= 2)
              ? 'medium'
              : 'low';

        flaggedPairs.push({
          participantAId: partA.participantId,
          participantAName: partA.displayName,
          participantBId: partB.participantId,
          participantBName: partB.displayName,
          commonPhases,
          identicalAnswers,
          agreementRate,
          sharedWrongCount,
          weightedRareSharedWrong,
          sequentialCount,
          dominantFollowerId,
          score,
          severity,
          evidence,
        });
      }
    }
  }

  flaggedPairs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.agreementRate - a.agreementRate;
  });

  // Union-Find para agrupar pares transitivos (A-B e B-C -> {A, B, C})
  const parent = new Map<string, string>();
  const nameById = new Map<string, string>(
    participantsAnalysis.map((p) => [p.participantId, p.displayName]),
  );

  function find(x: string): string {
    const p = parent.get(x);
    if (!p || p === x) {
      parent.set(x, x);
      return x;
    }
    const root = find(p);
    parent.set(x, root);
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  for (const pair of flaggedPairs) {
    union(pair.participantAId, pair.participantBId);
  }

  const groupMembers = new Map<string, Set<string>>();
  const groupMaxSev = new Map<string, InsightSeverity>();

  for (const pair of flaggedPairs) {
    const root = find(pair.participantAId);
    if (!groupMembers.has(root)) {
      groupMembers.set(root, new Set());
      groupMaxSev.set(root, pair.severity);
    }
    const set = groupMembers.get(root)!;
    set.add(pair.participantAId);
    set.add(pair.participantBId);

    const currSev = groupMaxSev.get(root)!;
    if (severityRank(pair.severity) > severityRank(currSev)) {
      groupMaxSev.set(root, pair.severity);
    }
  }

  const groups: CollusionGroup[] = [];
  for (const [root, memberSet] of groupMembers.entries()) {
    const participantIds = [...memberSet];
    const displayNames = participantIds.map((id) => nameById.get(id) ?? id);
    groups.push({
      participantIds,
      displayNames,
      maxSeverity: groupMaxSev.get(root) ?? 'low',
    });
  }

  groups.sort((a, b) => {
    const rankDiff = severityRank(b.maxSeverity) - severityRank(a.maxSeverity);
    if (rankDiff !== 0) return rankDiff;
    return b.participantIds.length - a.participantIds.length;
  });

  return {
    eligible: true,
    reason: null,
    pairs: flaggedPairs,
    groups,
  };
}
