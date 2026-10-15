'use client';

import { useState } from 'react';

import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { QuizDraftPhase } from '@/lib/types';
import shared from '../PhaseForm.module.css';
import styles from './QuizFields.module.css';

/** Limites de alternativas num quiz — abaixo de 2 não há escolha, acima de 6 não cabe na tela. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

interface QuizFieldsProps {
  phase: QuizDraftPhase;
  onChange: (patch: Partial<QuizDraftPhase>) => void;
}

export function QuizFields({ phase, onChange }: QuizFieldsProps) {
  const [alert, setAlert] = useState(false);

  function toggleCorrect(index: number) {
    const current = phase.correctIndexes;
    if (current.includes(index)) {
      // Uma fase sem gabarito não tem como ser corrigida.
      if (current.length === 1) return;
      onChange({ correctIndexes: current.filter((i) => i !== index) });
      return;
    }

    const next = [...current, index].sort((a, b) => a - b);
    // Se tudo estiver certo, a pergunta deixa de discriminar qualquer coisa.
    if (next.length >= phase.options.length) {
      setAlert(true);
      return;
    }
    onChange({ correctIndexes: next });
  }

  function addOption() {
    if (phase.options.length >= MAX_OPTIONS) return;
    onChange({ options: [...phase.options, ''] });
  }

  function removeLastOption() {
    if (phase.options.length <= MIN_OPTIONS) return;
    const lastIndex = phase.options.length - 1;
    const options = phase.options.slice(0, lastIndex);
    let correctIndexes = phase.correctIndexes.filter((i) => i !== lastIndex);
    if (correctIndexes.length >= options.length) correctIndexes = correctIndexes.slice(0, -1);
    if (correctIndexes.length === 0) correctIndexes = [0];
    onChange({ options, correctIndexes });
  }

  const correctLabel =
    phase.correctIndexes.length > 1
      ? `${phase.correctIndexes.length} respostas corretas`
      : '1 resposta correta';

  return (
    <div className={shared.field}>
      <div className={shared.labelRow}>
        <span className={shared.label}>Alternativas · marque uma ou mais corretas</span>
        {/* <span className={styles.correctChip}>{correctLabel}</span>   */}
      </div>

      {alert && (
        <div className={styles.alert} role="alert">
          <Icon.Alert size={18} className={styles.alertIcon} />
          <span>Não é possível selecionar todas as alternativas como corretas.</span>
          <button
            type="button"
            className={styles.alertClose}
            onClick={() => setAlert(false)}
            aria-label="Fechar aviso"
          >
            <Icon.Close size={14} />
          </button>
        </div>
      )}

      {phase.options.map((option, index) => {
        const isCorrect = phase.correctIndexes.includes(index);
        return (
          <div key={index} className={styles.optionRow}>
            <button
              type="button"
              className={cx(styles.mark, isCorrect && styles.markCorrect)}
              onClick={() => toggleCorrect(index)}
              aria-pressed={isCorrect}
              aria-label={`Marcar alternativa ${index + 1} como correta`}
            >
              {isCorrect && <Icon.Check size={13} />}
            </button>
            <input
              className={shared.input}
              placeholder={`Alternativa ${index + 1}`}
              value={option}
              onChange={(event) =>
                onChange({
                  options: phase.options.map((value, i) =>
                    i === index ? event.target.value : value,
                  ),
                })
              }
            />
            {index === phase.options.length - 1 && phase.options.length > MIN_OPTIONS && (
              <button
                type="button"
                className={styles.removeOption}
                onClick={removeLastOption}
                title="Remover alternativa"
                aria-label="Remover última alternativa"
              >
                <Icon.Close size={14} />
              </button>
            )}
          </div>
        );
      })}

      {phase.options.length < MAX_OPTIONS && (
        <button type="button" className={styles.addOption} onClick={addOption}>
          Adicionar nova alternativa
          <Icon.Plus size={16} />
        </button>
      )}
    </div>
  );
}
