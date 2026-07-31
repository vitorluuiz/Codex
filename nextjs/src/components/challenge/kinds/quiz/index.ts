import type { QuizPhase } from '@/lib/types';
import type { ChallengeTypeModule } from '../../types';
import { QuizFeedback } from './QuizFeedback';
import { QuizLeaderPreview, QuizPlayer } from './QuizChallenge';

export const quizModule: ChallengeTypeModule<QuizPhase> = {
  kind: 'quiz',
  label: 'Múltipla escolha',
  Player: QuizPlayer,
  Feedback: QuizFeedback,
  LeaderPreview: QuizLeaderPreview,
};
