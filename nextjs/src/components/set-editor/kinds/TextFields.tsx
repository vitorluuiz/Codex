import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { PhaseLimits, TextDraftPhase } from '@/lib/types';
import type { PhaseValidationErrors } from '../validation';
import shared from '../PhaseForm.module.css';

interface TextFieldsProps {
  phase: TextDraftPhase;
  onChange: (patch: Partial<TextDraftPhase>) => void;
  limits: PhaseLimits;
  errors?: PhaseValidationErrors | null;
}

export function TextFields({ phase, onChange, limits, errors }: TextFieldsProps) {
  const isOverLimit = phase.expectedAnswer.length > limits.maxExpectedAnswerLength;

  return (
    <div className={shared.field}>
      <label className={shared.label} htmlFor="expected-answer">
        Resposta esperada · usada pela IA na correção
      </label>

      {errors?.expectedAnswer && (
        <div className={shared.fieldError} role="alert">
          <Icon.Alert size={14} className={shared.fieldErrorIcon} />
          <span>{errors.expectedAnswer}</span>
        </div>
      )}

      <div className={shared.textareaWrapper}>
        <textarea
          id="expected-answer"
          className={cx(
            shared.textarea,
            shared.textareaTall,
            errors?.expectedAnswer && shared.inputInvalid,
          )}
          placeholder={
            errors?.expectedAnswer
              ? 'A resposta esperada não pode ficar vazia'
              : 'Descreva o que uma boa resposta precisa conter...'
          }
          value={phase.expectedAnswer}
          onChange={(event) => onChange({ expectedAnswer: event.target.value })}
        />
        <span
          className={cx(
            shared.charCounter,
            isOverLimit && shared.charCounterError,
          )}
          title={`Quantidade atual: ${phase.expectedAnswer.length} / Limite: ${limits.maxExpectedAnswerLength}`}
        >
          {phase.expectedAnswer.length} / {limits.maxExpectedAnswerLength}
        </span>
      </div>
    </div>
  );
}