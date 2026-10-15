import { cx } from '@/lib/cx';
import type { TextDraftPhase } from '@/lib/types';
import shared from '../PhaseForm.module.css';

interface TextFieldsProps {
  phase: TextDraftPhase;
  onChange: (patch: Partial<TextDraftPhase>) => void;
}

export function TextFields({ phase, onChange }: TextFieldsProps) {
  return (
    <div className={shared.field}>
      <label className={shared.label} htmlFor="expected-answer">
        Resposta esperada · usada pela IA na correção
      </label>
      <textarea
        id="expected-answer"
        className={cx(shared.textarea, shared.textareaTall)}
        placeholder="Descreva o que uma boa resposta precisa conter..."
        value={phase.expectedAnswer}
        onChange={(event) => onChange({ expectedAnswer: event.target.value })}
      />
    </div>
  );
}
