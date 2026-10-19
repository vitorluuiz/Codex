'use client';

import type { AiUsage, DraftPhase } from '@/lib/types';
import { CodeFields, FillFields, FillQuestionLabel, QuizFields, TextFields } from './kinds';
import { QUESTION_LABEL, QUESTION_PLACEHOLDER, syncBlanks } from './phaseKinds';
import styles from './PhaseForm.module.css';

interface PhaseFormProps {
  phase: DraftPhase;
  onChange: (patch: Partial<DraftPhase>) => void;
  aiUsage?: AiUsage | null;
  onUsageChange?: (usage: AiUsage) => void;
}

export function PhaseForm({
  phase,
  onChange,
  aiUsage = null,
  onUsageChange,
}: PhaseFormProps) {
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

      {phase.kind === 'quiz' && (
        <QuizFields
          phase={phase}
          onChange={onChange}
          aiUsage={aiUsage}
          onUsageChange={onUsageChange}
        />
      )}
      {phase.kind === 'code' && <CodeFields phase={phase} onChange={onChange} />}
      {phase.kind === 'text' && <TextFields phase={phase} onChange={onChange} />}
      {phase.kind === 'fill' && <FillFields phase={phase} onChange={onChange} />}
    </div>
  );
}
