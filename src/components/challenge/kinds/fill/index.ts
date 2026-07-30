import type { FillPhase } from '@/lib/types';
import type { ChallengeTypeModule } from '../../types';
import { FillLeaderPreview, FillPlayer } from './FillChallenge';
import { FillFeedback } from './FillFeedback';

export const fillModule: ChallengeTypeModule<FillPhase> = {
  kind: 'fill',
  label: 'Complete a frase',
  Player: FillPlayer,
  Feedback: FillFeedback,
  LeaderPreview: FillLeaderPreview,
};
