'use client';

import { useState } from 'react';

import { Button, TextArea } from '@/components/ds';
import type { TextPhase } from '@/lib/types';
import type { ChallengeLeaderPreviewProps, ChallengePlayerProps } from '../../types';
import styles from './TextChallenge.module.css';

export function TextPlayer({ phase, disabled, onSubmit }: ChallengePlayerProps<TextPhase>) {
  const [value, setValue] = useState('');

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Resposta dissertativa</p>
      <h1 className={styles.question}>{phase.question}</h1>

      <TextArea
        placeholder={phase.placeholder ?? 'Digite sua resposta aqui...'}
        aria-label="Sua resposta"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
      />

      <div className={styles.actions}>
        <Button
          disabled={disabled || !value.trim()}
          onClick={() => onSubmit({ kind: 'text', value: value.trim() })}
        >
          Enviar resposta
        </Button>
      </div>
    </div>
  );
}

export function TextLeaderPreview({ phase }: ChallengeLeaderPreviewProps<TextPhase>) {
  return <h2 className={styles.previewQuestion}>{phase.question}</h2>;
}
