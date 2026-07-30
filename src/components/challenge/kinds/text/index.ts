import type { TextPhase } from '@/lib/types';
import type { ChallengeTypeModule } from '../../types';
import { TextLeaderPreview, TextPlayer } from './TextChallenge';
import { TextFeedback } from './TextFeedback';

export const textModule: ChallengeTypeModule<TextPhase> = {
  kind: 'text',
  label: 'Resposta dissertativa',
  Player: TextPlayer,
  Feedback: TextFeedback,
  LeaderPreview: TextLeaderPreview,
};
