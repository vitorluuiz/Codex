'use client';

import type { FillPhase } from '@/lib/types';
import {
  ExplanationBlock,
  GradingPending,
  ResultHeader,
  ScoreRow,
} from '../../screens/feedbackParts';
import type { ChallengeFeedbackProps } from '../../types';

export function FillFeedback({ phase, submission, totalScore }: ChallengeFeedbackProps<FillPhase>) {
  return (
    <>
      <ResultHeader correct={submission.correct}>
        {phase.correctWords ? (
          <>
            Resposta correta: <strong>{phase.correctWords.join(' / ')}</strong>
          </>
        ) : (
          'Sua resposta foi registrada.'
        )}
      </ResultHeader>

      {submission.grading === 'pending' ? (
        <GradingPending />
      ) : (
        <ScoreRow phaseScore={submission.score} totalScore={totalScore} />
      )}

      {submission.explanation && (
        <ExplanationBlock title="Por que essa é a resposta certa">
          {submission.explanation}
        </ExplanationBlock>
      )}
    </>
  );
}
