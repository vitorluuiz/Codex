'use client';

import { Button } from '@/components/ds';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type { PhaseComparison } from '@/lib/types';
import { ResultHeader, ScoreRow } from './feedbackParts';
import styles from './screens.module.css';

interface CollectiveFeedbackScreenProps {
  comparison: PhaseComparison;
  isLastPhase: boolean;
  /** `true` no modo ao vivo: o aluno marca "Pronto" e espera o líder. */
  waitsForLeader: boolean;
  readyMarked: boolean;
  onMarkReady: () => void;
  onNextPhase: () => void;
  onViewPodium: () => void;
}

export function CollectiveFeedbackScreen({
  comparison,
  isLastPhase,
  waitsForLeader,
  readyMarked,
  onMarkReady,
  onNextPhase,
  onViewPodium,
}: CollectiveFeedbackScreenProps) {
  const maxScore = Math.max(...comparison.histogram.map((entry) => entry.score), 1);

  return (
    <div className={styles.centered}>
      <div className={cx(styles.panel, styles.panelWide)}>
        <ResultHeader correct={comparison.correct}>
          {comparison.correctAnswerLabel ? (
            <>
              Resposta correta: <strong>{comparison.correctAnswerLabel}</strong>
            </>
          ) : (
            'Veja como você se saiu comparado à turma.'
          )}
        </ResultHeader>

        <ScoreRow
          phaseScore={comparison.phaseScore}
          totalScore={comparison.myScore}
          percentile={comparison.percentile}
        />

        <h2 className={styles.sectionTitle}>Como você se compara aos outros jogadores</h2>

        <div className={styles.histogram}>
          {comparison.histogram.map((entry, index) => (
            <div key={index} className={styles.histogramColumn}>
              {entry.isMe && <span className={styles.histogramMeLabel}>Você</span>}
              <div
                className={cx(styles.histogramBar, entry.isMe && styles.histogramBarMine)}
                style={cssVars({
                  '--bar-height': `${Math.max(4, (entry.score / maxScore) * 100)}%`,
                })}
              />
            </div>
          ))}
        </div>
        <div className={styles.histogramLegend}>
          <span>Menor pontuação</span>
          <span>Maior pontuação</span>
        </div>

        <p className={styles.comparisonSummary}>
          Você marcou <strong>{comparison.phaseScore} pts</strong> — acima de{' '}
          <strong>{comparison.percentile}%</strong> dos jogadores.
        </p>

        <div className={styles.footerActions}>
          {isLastPhase ? (
            <Button size="lg" onClick={onViewPodium}>
              Ver pódio da turma
            </Button>
          ) : waitsForLeader ? (
            readyMarked ? (
              <span className={styles.waitingNote}>Aguardando o professor avançar a turma…</span>
            ) : (
              <Button size="lg" onClick={onMarkReady}>
                Pronto
              </Button>
            )
          ) : (
            <Button size="lg" onClick={onNextPhase}>
              Próxima fase
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
