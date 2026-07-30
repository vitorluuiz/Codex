import type { CodePhase } from '@/lib/types';
import type { ChallengeTypeModule } from '../../types';
import { CodeLeaderPreview, CodePlayer } from './CodeChallenge';
import { CodeFeedback } from './CodeFeedback';

export const codeModule: ChallengeTypeModule<CodePhase> = {
  kind: 'code',
  label: 'Desafio de código',
  Player: CodePlayer,
  Feedback: CodeFeedback,
  LeaderPreview: CodeLeaderPreview,
};
