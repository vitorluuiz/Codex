'use client';

import { useState } from 'react';

import { Button } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type {
  CodeDraftPhase,
  DraftPhase,
  FillDraftPhase,
  QuizDraftPhase,
  TextDraftPhase,
} from '@/lib/types';
import {
  BLANK_TOKENS,
  QUESTION_LABEL,
  QUESTION_PLACEHOLDER,
  splitQuestion,
  syncBlanks,
} from './phaseKinds';
import styles from './PhaseForm.module.css';

/** Limites de alternativas num quiz — abaixo de 2 não há escolha, acima de 6 não cabe na tela. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

interface PhaseFormProps {
  phase: DraftPhase;
  onChange: (patch: Partial<DraftPhase>) => void;
}

export function PhaseForm({ phase, onChange }: PhaseFormProps) {
  return (
    <div className={styles.card}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="phase-question">
          {phase.kind === 'fill' ? <FillQuestionLabel /> : QUESTION_LABEL[phase.kind]}
        </label>
        <textarea
          id="phase-question"
          className={styles.textarea}
          placeholder={QUESTION_PLACEHOLDER[phase.kind]}
          value={phase.question}
          onChange={(event) => {
            const question = event.target.value;
            // Numa fase `fill` o gabarito é posicional: mexer no enunciado tem
            // que reindexar as lacunas junto, ou a palavra certa acaba noutra.
            onChange(
              phase.kind === 'fill'
                ? { question, blanks: syncBlanks(question, phase.blanks) }
                : { question },
            );
          }}
        />
      </div>

      {phase.kind === 'quiz' && <QuizFields phase={phase} onChange={onChange} />}
      {phase.kind === 'code' && <CodeFields phase={phase} onChange={onChange} />}
      {phase.kind === 'text' && <TextFields phase={phase} onChange={onChange} />}
      {phase.kind === 'fill' && <FillFields phase={phase} onChange={onChange} />}
    </div>
  );
}

function FillQuestionLabel() {
  return (
    <>
      Frase com lacunas · use{' '}
      {BLANK_TOKENS.map((token, index) => (
        <span key={token}>
          {index > 0 && ' ou '}
          <code className={styles.token}>{token}</code>
        </span>
      ))}{' '}
      para cada lacuna
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Quiz                                                                        */
/* -------------------------------------------------------------------------- */

function QuizFields({
  phase,
  onChange,
}: {
  phase: QuizDraftPhase;
  onChange: (patch: Partial<QuizDraftPhase>) => void;
}) {
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
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <span className={styles.label}>Alternativas · marque uma ou mais corretas</span>
        <span className={styles.correctChip}>{correctLabel}</span>
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
              className={styles.input}
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

/* -------------------------------------------------------------------------- */
/* Código                                                                      */
/* -------------------------------------------------------------------------- */

function CodeFields({
  phase,
  onChange,
}: {
  phase: CodeDraftPhase;
  onChange: (patch: Partial<CodeDraftPhase>) => void;
}) {
  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="starter-code">
          Código inicial
        </label>
        <textarea
          id="starter-code"
          className={styles.code}
          spellCheck={false}
          value={phase.starterCode}
          onChange={(event) => onChange({ starterCode: event.target.value })}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="test-cases">
          Casos de teste
        </label>
        <textarea
          id="test-cases"
          className={cx(styles.textarea, styles.textareaMono)}
          placeholder={'Entrada: nums = [2,7,11,15], target = 9\nSaída: [0,1]'}
          value={phase.testCases}
          onChange={(event) => onChange({ testCases: event.target.value })}
        />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Dissertativa                                                                */
/* -------------------------------------------------------------------------- */

function TextFields({
  phase,
  onChange,
}: {
  phase: TextDraftPhase;
  onChange: (patch: Partial<TextDraftPhase>) => void;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor="expected-answer">
        Resposta esperada · usada pela IA na correção
      </label>
      <textarea
        id="expected-answer"
        className={cx(styles.textarea, styles.textareaTall)}
        placeholder="Descreva o que uma boa resposta precisa conter..."
        value={phase.expectedAnswer}
        onChange={(event) => onChange({ expectedAnswer: event.target.value })}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Completar frase                                                             */
/* -------------------------------------------------------------------------- */

function FillFields({
  phase,
  onChange,
}: {
  phase: FillDraftPhase;
  onChange: (patch: Partial<FillDraftPhase>) => void;
}) {
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
      <div className={styles.field}>
        <span className={styles.label}>
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
          <p className={styles.hint}>
            Use <code className={styles.token}>{BLANK_TOKENS[0]}</code> ou{' '}
            <code className={styles.token}>{BLANK_TOKENS[1]}</code> na frase acima para criar
            lacunas.
          </p>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>
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
          <p className={styles.hint}>Todas as palavras estão em uso na frase.</p>
        )}
      </div>

      <div className={styles.newWordRow}>
        <input
          className={cx(styles.input, styles.newWordInput)}
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
