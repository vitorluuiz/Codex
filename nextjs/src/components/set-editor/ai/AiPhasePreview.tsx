'use client';

import { Fragment } from 'react';

import { Tag } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type { DraftPhase } from '@/lib/types';
import { KIND_META } from '../phaseKinds';
import styles from './AiPhasePreview.module.css';

interface AiPhasePreviewProps {
  phase: DraftPhase;
  compact?: boolean;
}

export function AiPhasePreview({ phase, compact = false }: AiPhasePreviewProps) {
  const kindMeta = KIND_META[phase.kind];

  function renderFillQuestion(question: string, blanks: (string | null)[]) {
    const parts = question.split('___');
    return (
      <p className={styles.question}>
        {parts.map((part, index) => (
          <Fragment key={index}>
            {part}
            {index < parts.length - 1 && (
              <span className={styles.blankInline}>{blanks[index] ?? '___'}</span>
            )}
          </Fragment>
        ))}
      </p>
    );
  }

  return (
    <div className={cx(styles.card, compact && styles.cardCompact)}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span
            className={styles.kindChip}
            style={cssVars({ '--kind-color': kindMeta.color })}
          >
            {kindMeta.label}
          </span>
          <span className={styles.name}>{phase.name}</span>
        </div>

        <div className={styles.meta}>
          <span className={styles.metaBadge}>{phase.basePoints} pts</span>
          <span className={styles.metaBadge}>{phase.timeSeconds}s</span>
          {phase.pointsMultiplier !== 1 && (
            <span className={styles.metaBadge}>x{phase.pointsMultiplier}</span>
          )}
        </div>
      </div>

      {phase.kind === 'fill' ? (
        renderFillQuestion(phase.question, phase.blanks)
      ) : (
        <p className={styles.question}>{phase.question}</p>
      )}

      {phase.kind === 'quiz' && (
        <div className={styles.optionsList}>
          {phase.options.map((option, index) => {
            const isCorrect = phase.correctIndexes.includes(index);
            return (
              <div
                key={index}
                className={cx(styles.optionItem, isCorrect && styles.optionCorrect)}
              >
                <span className={cx(styles.optionMark, isCorrect && styles.optionMarkCorrect)}>
                  {isCorrect && <Icon.Check size={12} />}
                </span>
                <span className={styles.optionLabel}>{option}</span>
                {isCorrect && <Tag tone="green">Correta</Tag>}
              </div>
            );
          })}
        </div>
      )}

      {phase.kind === 'fill' && (
        <div className={styles.sectionBlock}>
          <span className={styles.sectionTitle}>Banco de palavras</span>
          <div className={styles.wordBank}>
            {phase.words.map((word, index) => {
              const isAnswer = phase.blanks.includes(word);
              return (
                <span
                  key={index}
                  className={cx(styles.wordChip, isAnswer && styles.wordChipAnswer)}
                >
                  {word}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {phase.kind === 'text' && (
        <div className={styles.sectionBlock}>
          <span className={styles.sectionTitle}>Resposta esperada</span>
          <div className={styles.answerBox}>{phase.expectedAnswer}</div>
        </div>
      )}

      {phase.kind === 'code' && (
        <div className={styles.sectionBlock}>
          <span className={styles.sectionTitle}>Código inicial</span>
          <pre className={styles.codeBlock}>
            <code>{phase.starterCode}</code>
          </pre>
        </div>
      )}

      {phase.introTip && (
        <div className={styles.tipRow}>
          <Icon.Info size={14} />
          <span>Dica de pré-desafio: {phase.introTip}</span>
        </div>
      )}
    </div>
  );
}
