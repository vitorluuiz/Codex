'use client';

import { useState } from 'react';

import { cx } from '@/lib/cx';
import type { QuizPhase } from '@/lib/types';
import type { ChallengeLeaderPreviewProps, ChallengePlayerProps } from '../../types';
import styles from './QuizChallenge.module.css';

/** Cor de cada alternativa, por posição. */
const TONES = [styles.tone0, styles.tone1, styles.tone2, styles.tone3, styles.tone4, styles.tone5];

/** Formas que acompanham cada alternativa, na ordem em que aparecem. */
const SHAPES = [
  <polygon key="triangle" points="12,2 22,20 2,20" />,
  <rect key="square" x="3" y="3" width="18" height="18" />,
  <circle key="circle" cx="12" cy="12" r="9" />,
  <path key="pentagon" d="M12 2 2 8v8l10 6 10-6V8z" />,
];

export function QuizPlayer({ phase, disabled, onSubmit }: ChallengePlayerProps<QuizPhase>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function choose(optionId: string) {
    if (disabled || selectedId) return;
    setSelectedId(optionId);
    onSubmit({ kind: 'quiz', optionId });
  }

  return (
    <>
      <div className={styles.prompt}>
        <p className={styles.eyebrow}>Múltipla escolha</p>
        <h1 className={styles.question}>{phase.question}</h1>
      </div>

      <div className={styles.tiles}>
        {phase.options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled || selectedId !== null}
            onClick={() => choose(option.id)}
            className={cx(
              styles.tile,
              TONES[index % TONES.length],
              selectedId === option.id && styles.selected,
            )}
          >
            <svg className={styles.tileIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              {SHAPES[index % SHAPES.length]}
            </svg>
            {option.label}
          </button>
        ))}
      </div>
    </>
  );
}

export function QuizLeaderPreview({ phase }: ChallengeLeaderPreviewProps<QuizPhase>) {
  return (
    <>
      <h2 className={styles.previewQuestion}>{phase.question}</h2>
      <div className={styles.previewGrid}>
        {phase.options.map((option) => (
          <div key={option.id} className={styles.previewTile}>
            {option.label}
          </div>
        ))}
      </div>
    </>
  );
}
