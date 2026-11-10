export type MatchMode = 'live' | 'self-paced';
export type PhaseKind = 'quiz' | 'fill' | 'text' | 'code';
export type GradingStatus = 'graded' | 'pending' | 'unanswered';
export type ReportStatus = 'processing' | 'ready' | 'failed' | 'not_found';

/* -------------------------------------------------------------------------- */
/* Entrada: documento da colecao `matches` no MongoDB                         */
/* -------------------------------------------------------------------------- */

export interface RawMatchPhaseSet {
  queueSetId: string;
  sourcePhaseSetId: string;
  title: string;
  color: string;
  orderIndex: number;
}

export interface RawPhaseContent {
  question?: string | null;
  fromAI?: boolean;
  options?: string[] | null;
  correctIndexes?: number[] | null;
  words?: string[] | null;
  blanks?: (string | null)[] | null;
  starterCode?: string | null;
  testCases?: string | null;
  expectedAnswer?: string | null;
}

export interface RawMatchPhase {
  phaseId: string;
  queueSetId: string;
  sourcePhaseId: string;
  orderIndex: number;
  kind: PhaseKind;
  name: string;
  basePoints: number;
  pointsMultiplier: number;
  timeSeconds: number;
  maxScore: number;
  content: RawPhaseContent;
}

export interface RawMatchStats {
  participantCount: number;
  avgTotalScore?: number;
  avgScore: number;
  maxScore: number;
  maxAvgScore?: number;
  accuracyRate: number;
  phaseAccuracy: (number | null)[];
  phaseAvgScore: (number | null)[];
}

export interface RawAnswerPayload {
  kind: string;
  optionId?: string | null;
  blanks?: (string | null)[] | null;
  value?: string | null;
  languageId?: string | null;
  source?: string | null;
}

export interface RawMatchSubmission {
  phaseId: string;
  phaseOrderIndex: number;
  maxScore: number;
  answer: RawAnswerPayload;
  submittedAt: string | Date;
  elapsedSeconds: number;
  readyAt?: string | Date | null;
  grading: 'graded' | 'pending';
  correct?: boolean | null;
  score?: number | null;
  explanation?: string | null;
}

export interface RawMatchParticipant {
  participantId: string;
  userId?: string | null;
  displayName: string;
  avatarIndex: number;
  joinedAt: string | Date;
  totalScore: number;
  gradedCount: number;
  correctCount: number;
  pendingCount: number;
  totalElapsedSeconds: number;
  submissions: RawMatchSubmission[];
}

export interface RawMatchDocument {
  id: string;
  schemaVersion?: number;
  roomCode: string;
  roomId: string;
  leaderUserId: string;
  mode: MatchMode;
  startedAt: string | Date;
  finishedAt: string | Date;
  phaseSets: RawMatchPhaseSet[];
  phases: RawMatchPhase[];
  stats: RawMatchStats;
  participants: RawMatchParticipant[];
}

/* -------------------------------------------------------------------------- */
/* Saida: documento consolidado `match_reports` e DTOs de resposta            */
/* -------------------------------------------------------------------------- */

export interface ReportOptionDistribution {
  optionId: string;
  label: string;
  isCorrect: boolean;
  count: number;
  percentage: number;
}

export interface ReportPhaseAnalysis {
  phaseId: string;
  orderIndex: number;
  phaseNumber: number;
  setTitle: string;
  kind: PhaseKind;
  name: string;
  question: string;
  basePoints: number;
  pointsMultiplier: number;
  maxScore: number;
  timeSeconds: number;
  correctAnswerText: string;
  submittedCount: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  pendingCount: number;
  accuracyRate: number;
  avgScore: number;
  avgElapsedSeconds: number;
  mostCommonAnswerText: string | null;
  optionDistribution: ReportOptionDistribution[];
}

export interface ReportParticipantAnswer {
  phaseId: string;
  phaseNumber: number;
  phaseName: string;
  kind: PhaseKind;
  question: string;
  submitted: boolean;
  grading: GradingStatus;
  correct: boolean | null;
  score: number;
  maxScore: number;
  classAvgScore: number;
  classAccuracyRate: number;
  elapsedSeconds: number | null;
  timeSeconds: number;
  givenAnswerText: string;
  correctAnswerText: string;
  explanation: string | null;
}

export interface ReportParticipantAnalysis {
  participantId: string;
  userId: string | null;
  displayName: string;
  avatarIndex: number;
  rank: number;
  percentile: number;
  accessToken: string;
  joinedAt: string;
  totalScore: number;
  maxPossibleScore: number;
  scorePercentage: number;
  gradedCount: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  pendingCount: number;
  accuracyRate: number;
  totalElapsedSeconds: number;
  avgElapsedSeconds: number;
  answers: ReportParticipantAnswer[];
}

export interface ReportOverview {
  participantCount: number;
  phaseCount: number;
  avgScore: number;
  maxPossibleScore: number;
  maxAchievedScore: number;
  minAchievedScore: number;
  medianScore: number;
  accuracyRate: number;
  totalSubmissions: number;
  totalGraded: number;
  totalCorrect: number;
  totalPending: number;
  avgResponseSeconds: number;
  durationSeconds: number;
}

export const CURRENT_REPORT_SCHEMA_VERSION = 2;

export type InsightSeverity = 'low' | 'medium' | 'high';
export type DifficultyLevel = 'very_easy' | 'easy' | 'medium' | 'hard' | 'very_hard' | 'insufficient';

export type QuestionFlag =
  | 'time_too_short'
  | 'time_too_long'
  | 'long_question'
  | 'long_options'
  | 'reading_exceeds_time'
  | 'low_discrimination'
  | 'negative_discrimination'
  | 'suspect_answer_key';

export interface QuestionInsight {
  phaseId: string;
  phaseNumber: number;
  difficulty: DifficultyLevel;
  accuracyRate: number;
  discriminationIndex: number | null;
  unansweredRate: number;
  lateSubmissionRate: number;
  lateWrongRate: number;
  avgTimeUsageRate: number;
  questionWordCount: number;
  questionCharCount: number;
  avgOptionCharCount: number | null;
  maxOptionCharCount: number | null;
  estimatedReadingSeconds: number;
  topDistractor: {
    label: string;
    percentage: number;
    upperGroupPercentage: number;
  } | null;
  flags: QuestionFlag[];
}

export interface GuessingEvent {
  phaseId: string;
  phaseNumber: number;
  phaseName: string;
  type: 'fast_wrong' | 'late_wrong';
  elapsedSeconds: number;
  timeSeconds: number;
  givenAnswerText: string;
}

export interface GuessingInsight {
  participantId: string;
  displayName: string;
  avatarIndex: number;
  gradedCount: number;
  fastWrongCount: number;
  lateWrongCount: number;
  guessRate: number;
  severity: InsightSeverity;
  events: GuessingEvent[];
}

export interface CollusionEvidence {
  phaseId: string;
  phaseNumber: number;
  phaseName: string;
  type: 'shared_wrong' | 'sequential_same';
  answerText: string;
  rarity: number | null;
  deltaMs: number | null;
  followerParticipantId: string | null;
}

export interface CollusionPair {
  participantAId: string;
  participantAName: string;
  participantBId: string;
  participantBName: string;
  commonPhases: number;
  identicalAnswers: number;
  agreementRate: number;
  sharedWrongCount: number;
  weightedRareSharedWrong: number;
  sequentialCount: number;
  dominantFollowerId: string | null;
  score: number;
  severity: InsightSeverity;
  evidence: CollusionEvidence[];
}

export interface CollusionGroup {
  participantIds: string[];
  displayNames: string[];
  maxSeverity: InsightSeverity;
}

export interface ReportInsights {
  thresholdsVersion: number;
  questions: QuestionInsight[];
  guessing: {
    eligible: boolean;
    reason: string | null;
    participants: GuessingInsight[];
  };
  collusion: {
    eligible: boolean;
    reason: string | null;
    pairs: CollusionPair[];
    groups: CollusionGroup[];
  };
  highlights: {
    easiest: string[];
    hardest: string[];
    flaggedQuestionCount: number;
    flaggedGuessers: number;
    flaggedPairs: number;
  };
}

export type AiVerdict = 'ok' | 'attention' | 'problem';

export interface AiPhaseReview {
  phaseId: string;
  phaseNumber: number;
  verdict: AiVerdict;
  spelling: { excerpt: string; suggestion: string }[];
  conceptual: { description: string; severity: InsightSeverity }[];
  clarity: { description: string; suggestion: string | null }[];
  answerKey: 'ok' | 'suspect' | 'wrong' | 'not_applicable';
  answerKeyNote: string | null;
  suggestedRewrite: string | null;
}

export interface ReportAiReview {
  generatedAt: string;
  requestedByUserId: string;
  provider: string;
  model: string;
  phases: AiPhaseReview[];
}

export interface MatchReportDocument {
  id: string;
  matchId: string;
  schemaVersion: number;
  status: 'processing' | 'ready' | 'failed';
  shareToken: string;
  roomCode: string;
  roomId: string;
  leaderUserId: string;
  mode: MatchMode;
  title: string;
  startedAt: string;
  finishedAt: string;
  generatedAt: string;
  durationSeconds: number;
  phaseSets: RawMatchPhaseSet[];
  overview: ReportOverview;
  phases: ReportPhaseAnalysis[];
  participants: ReportParticipantAnalysis[];
  insights: ReportInsights;
  aiReview: ReportAiReview | null;
}

/** Relatorio compacto e individual para um participante. */
export interface IndividualReportDto {
  matchId: string;
  shareToken?: string;
  roomCode: string;
  mode: MatchMode;
  title: string;
  startedAt: string;
  finishedAt: string;
  generatedAt: string;
  durationSeconds: number;
  classOverview: {
    participantCount: number;
    phaseCount: number;
    avgScore: number;
    maxPossibleScore: number;
    maxAchievedScore: number;
    accuracyRate: number;
    avgResponseSeconds: number;
  };
  participant: ReportParticipantAnalysis;
}

export interface LeaderReportHistoryItem {
  matchId: string;
  shareToken: string;
  roomCode: string;
  title: string;
  mode: MatchMode;
  finishedAt: string;
  generatedAt: string;
  durationSeconds: number;
  participantCount: number;
  phaseCount: number;
  avgScore: number;
  maxPossibleScore: number;
  accuracyRate: number;
}

export interface ParticipantReportHistoryItem {
  matchId: string;
  accessToken: string;
  roomCode: string;
  title: string;
  mode: MatchMode;
  finishedAt: string;
  displayName: string;
  avatarIndex: number;
  rank: number;
  participantCount: number;
  totalScore: number;
  maxPossibleScore: number;
  accuracyRate: number;
  correctCount: number;
  phaseCount: number;
}

export interface UserReportsHistoryDto {
  leaderReports: LeaderReportHistoryItem[];
  participantReports: ParticipantReportHistoryItem[];
}
