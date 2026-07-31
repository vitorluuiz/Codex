'use client';

import type { CodePhase } from '@/lib/types';
import {
  GradingPending,
  ResultHeader,
  ScoreRow,
  SuggestionList,
} from '../../screens/feedbackParts';
import type { ChallengeFeedbackProps } from '../../types';

export function CodeFeedback({ submission, totalScore }: ChallengeFeedbackProps<CodePhase>) {
  const tests = submission.testsPassed;

  return (
    <>
      <ResultHeader correct={submission.correct}>
        {tests
          ? `Casos de teste: ${tests.passed}/${tests.total}.`
          : 'Sua solução foi avaliada nos casos de teste.'}
      </ResultHeader>

      {submission.grading === 'pending' ? (
        <GradingPending />
      ) : (
        <ScoreRow phaseScore={submission.score} totalScore={totalScore} />
      )}

      {submission.aiSuggestions && submission.aiSuggestions.length > 0 && (
        <SuggestionList
          title="Sugestões da IA para melhorar sua pontuação"
          items={submission.aiSuggestions}
        />
      )}
    </>
  );
}
