'use client';

import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { AiUsage, DraftPhase, PendingAiQuizSuggestions, PhaseLimits } from '@/lib/types';
import { CodeFields, FillFields, FillQuestionLabel, QuizFields, TextFields } from './kinds';
import { QUESTION_LABEL, QUESTION_PLACEHOLDER, syncBlanks } from './phaseKinds';
import type { PhaseValidationErrors } from './validation';
import styles from './PhaseForm.module.css';

interface PhaseFormProps {
  phase: DraftPhase;
  onChange: (patch: Partial<DraftPhase>) => void;
  aiUsage?: AiUsage | null;
  onUsageChange?: (usage: AiUsage) => void;
  pendingQuizSuggestions?: PendingAiQuizSuggestions | null;
  onPendingQuizSuggestionsChange?: (pending: PendingAiQuizSuggestions | null) => void;
  limits: PhaseLimits;
  errors?: PhaseValidationErrors | null;
}

export function PhaseForm({
  phase,
  onChange,
  aiUsage = null,
  onUsageChange,
  pendingQuizSuggestions = null,
  onPendingQuizSuggestionsChange,
  limits,
  errors,
}: PhaseFormProps) {
  const isQuestionOverLimit = phase.question.length > limits.maxQuestionLength;

  return (
    <div className={styles.card}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="phase-question">
          {phase.kind === 'fill' ? <FillQuestionLabel /> : QUESTION_LABEL[phase.kind]}
        </label>

        {errors?.question && (
          <div className={styles.fieldError} role="alert">
            <Icon.Alert size={14} className={styles.fieldErrorIcon} />
            <span>{errors.question}</span>
          </div>
        )}

        <div className={styles.textareaWrapper}>
          <textarea
            id="phase-question"
            className={cx(
              styles.textarea,
              errors?.question && styles.inputInvalid,
            )}
            placeholder={
              errors?.question
                ? 'O enunciado da questão não pode ficar vazio'
                : QUESTION_PLACEHOLDER[phase.kind]
            }
            value={phase.question}
            onChange={(event) => {
              const question = event.target.value;
              onChange(
                phase.kind === 'fill'
                  ? { question, blanks: syncBlanks(question, phase.blanks) }
                  : { question },
              );
            }}
          />
          <span
            className={cx(
              styles.charCounter,
              isQuestionOverLimit && styles.charCounterError,
            )}
            title={`Quantidade atual: ${phase.question.length} / Limite: ${limits.maxQuestionLength}`}
          >
            {phase.question.length} / {limits.maxQuestionLength}
          </span>
        </div>
      </div>

      {phase.kind === 'quiz' && (
        <QuizFields
          phase={phase}
          onChange={onChange}
          aiUsage={aiUsage}
          onUsageChange={onUsageChange}
          pendingSuggestions={pendingQuizSuggestions}
          onPendingSuggestionsChange={onPendingQuizSuggestionsChange}
          limits={limits}
          errors={errors}
        />
      )}
      {phase.kind === 'code' && (
        <CodeFields phase={phase} onChange={onChange} limits={limits} errors={errors} />
      )}
      {phase.kind === 'text' && (
        <TextFields phase={phase} onChange={onChange} limits={limits} errors={errors} />
      )}
      {phase.kind === 'fill' && (
        <FillFields phase={phase} onChange={onChange} limits={limits} errors={errors} />
      )}
    </div>
  );
}