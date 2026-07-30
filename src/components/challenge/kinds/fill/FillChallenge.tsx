'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ds';
import { cx } from '@/lib/cx';
import type { FillPhase } from '@/lib/types';
import type { ChallengeLeaderPreviewProps, ChallengePlayerProps } from '../../types';
import styles from './FillChallenge.module.css';

const EMPTY_LABEL = '______';

export function FillPlayer({ phase, disabled, onSubmit }: ChallengePlayerProps<FillPhase>) {
  const blankCount = useMemo(
    () => phase.segments.filter((segment) => segment.type === 'blank').length,
    [phase.segments],
  );
  const [blanks, setBlanks] = useState<(string | null)[]>(() => Array(blankCount).fill(null));

  const complete = blanks.every((value) => value !== null);

  /** Preenche a próxima lacuna vazia — o design não usa arrastar-e-soltar. */
  function pickWord(word: string) {
    if (disabled || blanks.includes(word)) return;
    const target = blanks.findIndex((value) => value === null);
    if (target === -1) return;
    setBlanks((current) => current.map((value, i) => (i === target ? word : value)));
  }

  function clearBlank(index: number) {
    if (disabled) return;
    setBlanks((current) => current.map((value, i) => (i === index ? null : value)));
  }

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Complete a frase</p>

      <p className={styles.sentence}>
        {phase.segments.map((segment, index) =>
          segment.type === 'text' ? (
            <span key={index}>{segment.value}</span>
          ) : (
            <button
              key={index}
              type="button"
              disabled={disabled}
              onClick={() => clearBlank(segment.index)}
              aria-label={`Lacuna ${segment.index + 1}${
                blanks[segment.index] ? `: ${blanks[segment.index]}. Clique para limpar` : ' vazia'
              }`}
              className={cx(styles.blank, blanks[segment.index] && styles.blankFilled)}
            >
              {blanks[segment.index] ?? EMPTY_LABEL}
            </button>
          ),
        )}
      </p>

      <div className={styles.bank}>
        {phase.words.map((word) => {
          const used = blanks.includes(word);
          return (
            <button
              key={word}
              type="button"
              disabled={disabled || used}
              onClick={() => pickWord(word)}
              className={cx(styles.word, used && styles.wordUsed)}
            >
              {word}
            </button>
          );
        })}
      </div>

      <div className={styles.actions}>
        <Button disabled={disabled || !complete} onClick={() => onSubmit({ kind: 'fill', blanks })}>
          Enviar resposta
        </Button>
      </div>
    </div>
  );
}

export function FillLeaderPreview({ phase }: ChallengeLeaderPreviewProps<FillPhase>) {
  return (
    <p className={styles.previewSentence}>
      {phase.segments.map((segment, index) =>
        segment.type === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <span key={index} className={styles.previewBlank}>
            {EMPTY_LABEL}
          </span>
        ),
      )}
    </p>
  );
}
