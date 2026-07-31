import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';
import styles from './feedbackParts.module.css';

/**
 * Peças que todo feedback individual reaproveita, independentemente do tipo de
 * desafio: o selo de resultado, o par de pontuações e os blocos de explicação.
 */

export function ResultHeader({
  correct,
  children,
}: {
  correct: boolean | null;
  children: ReactNode;
}) {
  const label = correct === null ? 'Enviado' : correct ? 'Correto' : 'Incorreto';

  return (
    <div className={styles.resultHeader}>
      <span
        className={cx(
          styles.resultTag,
          correct === true && styles.resultTagCorrect,
          correct === false && styles.resultTagIncorrect,
        )}
      >
        {label}
      </span>
      <span className={styles.resultNote}>{children}</span>
    </div>
  );
}

export function ScoreRow({
  phaseScore,
  totalScore,
  percentile,
}: {
  phaseScore: number | null;
  totalScore: number;
  percentile?: number;
}) {
  return (
    <div className={styles.scores}>
      <div>
        <p className={styles.scoreLabel}>Pontos nesta fase</p>
        <div className={cx(styles.scoreValue, styles.scoreValueAccent)}>+{phaseScore ?? 0}</div>
      </div>
      <div>
        <p className={styles.scoreLabel}>Pontuação total</p>
        <div className={styles.scoreValue}>{totalScore}</div>
      </div>
      {percentile !== undefined && (
        <div>
          <p className={styles.scoreLabel}>Sua posição</p>
          <div className={styles.scoreValue}>Top {percentile}%</div>
        </div>
      )}
    </div>
  );
}

export function ExplanationBlock({
  title,
  children,
  tight,
}: {
  title: string;
  children: ReactNode;
  tight?: boolean;
}) {
  return (
    <>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={cx(styles.note, tight && styles.noteTight)}>
        <p className={styles.noteBody}>{children}</p>
      </div>
    </>
  );
}

export function SuggestionList({
  title,
  items,
}: {
  title: string;
  items: { title: string; body: string }[];
}) {
  return (
    <>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.noteList}>
        {items.map((item) => (
          <div key={item.title} className={styles.note}>
            <p className={styles.noteTitle}>{item.title}</p>
            <p className={cx(styles.noteBody, styles.noteBodySmall)}>{item.body}</p>
          </div>
        ))}
      </div>
    </>
  );
}

/** Mostrado enquanto a IA ainda não devolveu a correção de texto/código. */
export function GradingPending() {
  return (
    <p className={styles.pendingNote}>
      Sua resposta está sendo avaliada — o resultado aparece aqui assim que ficar pronto.
    </p>
  );
}
