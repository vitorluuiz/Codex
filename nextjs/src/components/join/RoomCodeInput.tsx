'use client';

import {
  useId,
  useImperativeHandle,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';

import { cx } from '@/lib/cx';
import styles from './RoomCodeInput.module.css';

const CODE_LENGTH = 6;
const SLOTS = [0, 1, 2, 3, 4, 5] as const;

/**
 * Extrai o código de 6 dígitos de texto colado, inclusive URLs completas
 * (ex.: `http://localhost:3000/sala?codigo=969180` -> `969180`, evitando
 * capturar os dígitos da porta `:3000`) e códigos com espaços ou hífens.
 */
export function extractRoomCode(raw: string): string {
  const urlMatch = raw.match(/(?:[?&]codigo=|\/sala\/)(\d{6})\b/i);
  if (urlMatch) return urlMatch[1];

  const groupedMatch = raw.match(/\b(\d{3})[\s-]?(\d{3})\b/);
  if (groupedMatch) return `${groupedMatch[1]}${groupedMatch[2]}`;

  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

/** Formata `123456` como `123 456` para leitura confortável. */
export function formatRoomCode(code: string): string {
  const digits = code.replace(/\D/g, '').slice(0, CODE_LENGTH);
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

export interface RoomCodeInputHandle {
  /** Move o foco para a primeira caixa vazia ou, se completo, para a última caixa. */
  focusForEdit: () => void;
}

interface RoomCodeInputProps {
  value: string;
  onChange: (nextCode: string) => void;
  onComplete?: (fullCode: string) => void;
  error?: string | null;
  disabled?: boolean;
  label?: string;
  autoFocus?: boolean;
  ref?: Ref<RoomCodeInputHandle>;
}

export function RoomCodeInput({
  value,
  onChange,
  onComplete,
  error,
  disabled,
  label = 'Código da sala',
  autoFocus,
  ref,
}: RoomCodeInputProps) {
  const groupId = useId();
  const errorId = `${groupId}-error`;
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const digits = SLOTS.map((index) => value[index] ?? '');

  const focusSlot = (index: number) => {
    const clamped = Math.max(0, Math.min(CODE_LENGTH - 1, index));
    const el = inputsRef.current[clamped];
    if (el) {
      el.focus();
      el.select();
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      focusForEdit: () => {
        const firstEmpty = digits.findIndex((d) => !d);
        focusSlot(firstEmpty === -1 ? CODE_LENGTH - 1 : firstEmpty);
      },
    }),
    [digits],
  );

  const commit = (nextDigits: string[], nextFocusIndex?: number, allowAutoComplete = true) => {
    const nextCode = nextDigits.join('').replace(/\D/g, '').slice(0, CODE_LENGTH);
    onChange(nextCode);

    if (typeof nextFocusIndex === 'number') {
      focusSlot(nextFocusIndex);
    }

    if (allowAutoComplete && nextCode.length === CODE_LENGTH && onComplete) {
      onComplete(nextCode);
    }
  };

  const applyPastedText = (raw: string, startSlot: number) => {
    const extracted = extractRoomCode(raw);
    if (!extracted) return;

    if (extracted.length >= 2) {
      const next = SLOTS.map((i) => extracted[i] ?? '');
      const focusTarget = Math.min(extracted.length, CODE_LENGTH - 1);
      commit(next, focusTarget, true);
    } else {
      const wasIncomplete = value.length < CODE_LENGTH;
      const next = [...digits];
      next[startSlot] = extracted[0];
      commit(next, Math.min(startSlot + 1, CODE_LENGTH - 1), wasIncomplete);
    }
  };

  const handleChange = (index: number, rawInput: string) => {
    const cleaned = extractRoomCode(rawInput);

    // Suporta autofill / colagem via onChange (ex.: SMS/OTP mobile)
    if (cleaned.length > 1) {
      applyPastedText(rawInput, index);
      return;
    }

    const next = [...digits];
    if (!cleaned) {
      next[index] = '';
      onChange(next.join('').slice(0, CODE_LENGTH));
      return;
    }

    const wasIncomplete = value.length < CODE_LENGTH;

    // Se há espaços vazios antes deste slot, preenche o primeiro vazio para evitar "buracos"
    const firstEmpty = next.findIndex((d) => !d);
    const targetIndex = firstEmpty !== -1 && firstEmpty < index ? firstEmpty : index;
    next[targetIndex] = cleaned;

    commit(next, Math.min(targetIndex + 1, CODE_LENGTH - 1), wasIncomplete);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const next = [...digits];
      if (next[index]) {
        next[index] = '';
        onChange(next.join(''));
      } else if (index > 0) {
        next[index - 1] = '';
        onChange(next.join(''));
        focusSlot(index - 1);
      }
      return;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      const next = [...digits];
      if (next[index]) {
        next[index] = '';
        onChange(next.join(''));
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusSlot(index - 1);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusSlot(index + 1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusSlot(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusSlot(CODE_LENGTH - 1);
    }
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!text) return;
    event.preventDefault();
    applyPastedText(text, index);
  };

  const handleClear = () => {
    onChange('');
    focusSlot(0);
  };

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <span className={styles.label} id={groupId}>
          {label}
        </span>
        {value.length > 0 && !disabled && (
          <button type="button" className={styles.clearButton} onClick={handleClear}>
            Limpar
          </button>
        )}
      </div>

      <div
        className={cx(styles.slots, error && styles.slotsError)}
        role="group"
        aria-labelledby={groupId}
        aria-describedby={error ? errorId : undefined}
      >
        {SLOTS.map((index) => (
          <div key={index} className={styles.slotWrapper}>
            {index === 3 && (
              <span className={styles.separator} aria-hidden="true">
                –
              </span>
            )}
            <input
              ref={(el) => {
                inputsRef.current[index] = el;
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              autoFocus={autoFocus && index === 0}
              disabled={disabled}
              value={digits[index]}
              placeholder="0"
              aria-label={`Dígito ${index + 1} de ${CODE_LENGTH}`}
              aria-invalid={error ? true : undefined}
              className={cx(
                styles.slot,
                digits[index] && styles.slotFilled,
                error && styles.slotInvalid,
              )}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => handleChange(index, event.target.value)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              onPaste={(event) => handlePaste(index, event)}
            />
          </div>
        ))}
      </div>

      {error ? (
        <span className={styles.error} id={errorId} role="alert">
          {error}
        </span>
      ) : (
        <span className={styles.hint}>
          Você também pode colar o código ou o link completo de convite.
        </span>
      )}
    </div>
  );
}
