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
