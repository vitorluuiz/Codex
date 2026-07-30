'use client';

import type { QuizPhase } from '@/lib/types';
import {
  ExplanationBlock,
  GradingPending,
  ResultHeader,
  ScoreRow,
} from '../../screens/feedbackParts';
import type { ChallengeFeedbackProps } from '../../types';

export function QuizFeedback({ phase, submission, totalScore }: ChallengeFeedbackProps<QuizPhase>) {
  const correctOption = phase.options.find((option) => option.id === phase.correctOptionId);

  return (
    <>
      <ResultHeader correct={submission.correct}>
        {correctOption ? (
          <>
            Resposta correta: <strong>{correctOption.label}</strong>
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
