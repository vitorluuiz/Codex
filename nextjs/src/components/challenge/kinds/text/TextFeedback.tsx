'use client';

import type { TextPhase } from '@/lib/types';
import {
  ExplanationBlock,
  GradingPending,
  ResultHeader,
  ScoreRow,
} from '../../screens/feedbackParts';
import type { ChallengeFeedbackProps } from '../../types';
import styles from './TextChallenge.module.css';

export function TextFeedback({ submission, totalScore }: ChallengeFeedbackProps<TextPhase>) {
  const answer = submission.answer.kind === 'text' ? submission.answer.value : '';

  return (
    <>
      <ResultHeader correct={submission.correct}>Sua resposta foi avaliada pela IA.</ResultHeader>

      {submission.grading === 'pending' ? (
        <GradingPending />
      ) : (
        <ScoreRow phaseScore={submission.score} totalScore={totalScore} />
      )}

      <h3 className={styles.sectionTitle}>Sua resposta</h3>
      <div className={styles.answerEcho}>
        <p className={styles.answerEchoText}>{answer}</p>
      </div>

      {submission.explanation && (
        <ExplanationBlock title="Feedback da IA">{submission.explanation}</ExplanationBlock>
      )}
    </>
  );
}
