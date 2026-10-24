import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { CodeDraftPhase, PhaseLimits } from '@/lib/types';
import type { PhaseValidationErrors } from '../validation';
import shared from '../PhaseForm.module.css';

interface CodeFieldsProps {
  phase: CodeDraftPhase;
  onChange: (patch: Partial<CodeDraftPhase>) => void;
  limits: PhaseLimits;
  errors?: PhaseValidationErrors | null;
}

export function CodeFields({ phase, onChange, limits, errors }: CodeFieldsProps) {
  const isStarterOver = phase.starterCode.length > limits.maxStarterCodeLength;
  const isTestCasesOver = phase.testCases.length > limits.maxTestCasesLength;

  return (
    <>
      <div className={shared.field}>
        <label className={shared.label} htmlFor="starter-code">
          Código inicial
        </label>
        {errors?.starterCode && (
          <div className={shared.fieldError} role="alert">
            <Icon.Alert size={14} className={shared.fieldErrorIcon} />
            <span>{errors.starterCode}</span>
          </div>
        )}
        <div className={shared.textareaWrapper}>
          <textarea
            id="starter-code"
            className={cx(shared.code, errors?.starterCode && shared.inputInvalid)}
            spellCheck={false}
            value={phase.starterCode}
            onChange={(event) => onChange({ starterCode: event.target.value })}
          />
          <span
            className={cx(shared.charCounter, isStarterOver && shared.charCounterError)}
            title={`Quantidade atual: ${phase.starterCode.length} / Limite: ${limits.maxStarterCodeLength}`}
          >
            {phase.starterCode.length} / {limits.maxStarterCodeLength}
          </span>
        </div>
      </div>

      <div className={shared.field}>
        <label className={shared.label} htmlFor="test-cases">
          Casos de teste
        </label>
        {errors?.testCases && (
          <div className={shared.fieldError} role="alert">
            <Icon.Alert size={14} className={shared.fieldErrorIcon} />
            <span>{errors.testCases}</span>
          </div>
        )}
        <div className={shared.textareaWrapper}>
          <textarea
            id="test-cases"
            className={cx(
              shared.textarea,
              shared.textareaMono,
              errors?.testCases && shared.inputInvalid,
            )}
            placeholder={'Entrada: nums = [2,7,11,15], target = 9\nSaída: [0,1]'}
            value={phase.testCases}
            onChange={(event) => onChange({ testCases: event.target.value })}
          />
          <span
            className={cx(shared.charCounter, isTestCasesOver && shared.charCounterError)}
            title={`Quantidade atual: ${phase.testCases.length} / Limite: ${limits.maxTestCasesLength}`}
          >
            {phase.testCases.length} / {limits.maxTestCasesLength}
          </span>
        </div>
      </div>
    </>
  );
}