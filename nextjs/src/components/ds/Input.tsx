'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

import { cx } from '@/lib/cx';
import styles from './Input.module.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label?: string;
  error?: string | null;
  icon?: ReactNode;
  /** Estilo de dígitos grandes usado no campo “Código da sala”. */
  codeStyle?: boolean;
}

export function Input({ label, error, icon, codeStyle, id, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div className={styles.field}>
      {label && (
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className={cx(styles.shell, error && styles.invalid)}>
        {icon}
        <input
          id={inputId}
          className={cx(styles.control, codeStyle && styles.codeControl)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        />
      </div>
      {error && (
        <span className={styles.error} id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  label?: string;
  compact?: boolean;
}

export function TextArea({ label, compact, id, ...rest }: TextAreaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;

  return (
    <div className={styles.field}>
      {label && (
        <label className={styles.label} htmlFor={textareaId}>
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={cx(styles.textarea, compact && styles.textareaCompact)}
        {...rest}
      />
    </div>
  );
}
