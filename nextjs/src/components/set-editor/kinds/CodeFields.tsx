import { cx } from '@/lib/cx';
import type { CodeDraftPhase } from '@/lib/types';
import shared from '../PhaseForm.module.css';

interface CodeFieldsProps {
  phase: CodeDraftPhase;
  onChange: (patch: Partial<CodeDraftPhase>) => void;
}

export function CodeFields({ phase, onChange }: CodeFieldsProps) {
  return (
    <>
      <div className={shared.field}>
        <label className={shared.label} htmlFor="starter-code">
          Código inicial
        </label>
        <textarea
          id="starter-code"
          className={shared.code}
          spellCheck={false}
          value={phase.starterCode}
          onChange={(event) => onChange({ starterCode: event.target.value })}
        />
      </div>
      <div className={shared.field}>
        <label className={shared.label} htmlFor="test-cases">
          Casos de teste
        </label>
        <textarea
          id="test-cases"
          className={cx(shared.textarea, shared.textareaMono)}
          placeholder={'Entrada: nums = [2,7,11,15], target = 9\nSaída: [0,1]'}
          value={phase.testCases}
          onChange={(event) => onChange({ testCases: event.target.value })}
        />
      </div>
    </>
  );
}
