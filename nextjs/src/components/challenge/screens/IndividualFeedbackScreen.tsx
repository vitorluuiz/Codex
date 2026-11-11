'use client';

import { Button } from '@/components/ds';
import { cx } from '@/lib/cx';
import type { Phase, Submission } from '@/lib/types';
import { challengeModuleFor } from '../registry';
import { ConfettiBurst } from './ConfettiBurst';
import styles from './screens.module.css';

interface IndividualFeedbackScreenProps {
  phase: Phase;
  submission: Submission;
  totalScore: number;
  onContinue: () => void;
}

/**
 * Moldura comum do feedback individual. O miolo é o `Feedback` do tipo de
 * desafio — a casca só sabe onde ele entra e para onde vai o botão.
 */
export function IndividualFeedbackScreen({
  phase,
  submission,
  totalScore,
  onContinue,
}: IndividualFeedbackScreenProps) {
  const { Feedback } = challengeModuleFor(phase);
  const celebrate = submission.correct === true && (phase.showFeedbackAnimation ?? true);

  return (
    <div className={styles.centered}>
      {celebrate && <ConfettiBurst theme={phase.theme} />}
      <div className={cx(styles.panel, styles.panelMedium, celebrate && styles.panelCelebrate)}>
        <Feedback phase={phase} submission={submission} totalScore={totalScore} />
        <div className={styles.footerActions}>
          <Button size="lg" onClick={onContinue}>
            Ver comparação com a turma
          </Button>
        </div>
      </div>
    </div>
  );
}
