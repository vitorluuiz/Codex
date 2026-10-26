'use client';

import { useState } from 'react';

import { Button } from '@/components/ds';
import { cx } from '@/lib/cx';
import { Icon } from '@/components/icons/Icons';
import type { FillDraftPhase, PhaseLimits } from '@/lib/types';
import type { PhaseValidationErrors } from '../validation';
import { BLANK_TOKENS, splitQuestion, syncBlanks } from '../phaseKinds';
import shared from '../PhaseForm.module.css';
import styles from './FillFields.module.css';

/** Rótulo do enunciado numa fase `fill`: explica quais tokens viram lacuna. */
export function FillQuestionLabel() {
  return (
    <>
      Frase com lacunas · use{' '}
      {BLANK_TOKENS.map((token, index) => (
        <span key={token}>
          {index > 0 && ' ou '}
          <code className={shared.token}>{token}</code>
        </span>
      ))}{' '}
      para cada lacuna
    </>
  );
}

interface FillFieldsProps {
  phase: FillDraftPhase;
  onChange: (patch: Partial<FillDraftPhase>) => void;
  limits?: PhaseLimits;
  errors?: PhaseValidationErrors | null;
}

export function FillFields({ phase, onChange, limits, errors }: FillFieldsProps) {
  const [newWord, setNewWord] = useState('');

  const blanks = syncBlanks(phase.question, phase.blanks);
  const segments = splitQuestion(phase.question);
  const firstEmpty = blanks.indexOf(null);
  const available = phase.words.filter((word) => !blanks.includes(word));

  function fillFirstBlank(word: string) {
    if (firstEmpty === -1) return;
    const next = blanks.slice();
    next[firstEmpty] = word;
    onChange({ blanks: next });
  }

  function clearBlank(index: number) {
    const next = blanks.slice();
    next[index] = null;
    onChange({ blanks: next });
  }

  function addWord() {
    const word = newWord.trim();
    if (!word || phase.words.includes(word)) return;
    onChange({ words: [...phase.words, word] });
    setNewWord('');
  }

  return (
    <div className={styles.fillGroup}>
      <div className={shared.field}>
        {errors?.fillGeneral && (
        <div className={shared.fieldError} role="alert">
          <Icon.Alert size={14} className={shared.fieldErrorIcon} />
          <span>{errors.fillGeneral}</span>
        </div>
      )}
      <span className={shared.label}>
          Pré-visualização · clique numa lacuna preenchida para devolver a palavra
        </span>
        <div className={styles.preview}>
          {segments.map((segment, index) =>
            segment.blankIndex === null ? (
              <span key={index} className={styles.previewText}>
                {segment.text}
              </span>
            ) : (
              <button
                key={index}
                type="button"
                className={cx(
                  styles.blank,
                  blanks[segment.blankIndex] && styles.blankFilled,
                )}
                disabled={!blanks[segment.blankIndex]}
                onClick={() => clearBlank(segment.blankIndex as number)}
              >
                {blanks[segment.blankIndex] ?? '···'}
              </button>
            ),
          )}
        </div>
        {blanks.length === 0 && (
          <p className={shared.hint}>
            Use <code className={shared.token}>{BLANK_TOKENS[0]}</code> ou{' '}
            <code className={shared.token}>{BLANK_TOKENS[1]}</code> na frase acima para criar
            lacunas.
          </p>
        )}
      </div>

      <div className={shared.field}>
        <span className={shared.label}>
          Palavras disponíveis · clique para preencher a próxima lacuna
        </span>
        <div className={styles.wordBank}>
          {available.map((word) => (
            <button
              key={word}
              type="button"
              className={styles.wordChip}
              disabled={firstEmpty === -1}
              onClick={() => fillFirstBlank(word)}
            >
              {word}
            </button>
          ))}
        </div>
        {available.length === 0 && phase.words.length > 0 && (
          <p className={shared.hint}>Todas as palavras estão em uso na frase.</p>
        )}
      </div>

      <div className={styles.newWordRow}>
        <input
          className={cx(shared.input, styles.newWordInput)}
          placeholder="Nova palavra"
          value={newWord}
          onChange={(event) => setNewWord(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addWord();
            }
          }}
        />
        <Button size="sm" variant="secondary" onClick={addWord} disabled={!newWord.trim()}>
          Adicionar
        </Button>
      </div>
    </div>
  );
}
