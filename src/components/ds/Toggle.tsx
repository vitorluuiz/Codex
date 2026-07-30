'use client';

import { cx } from '@/lib/cx';
import styles from './Toggle.module.css';

interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function Checkbox({ label, checked, onChange, disabled }: ToggleProps) {
  return (
    <label className={styles.wrapper}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(styles.box, checked && styles.boxChecked)}
      >
        {checked && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </button>
      {label}
    </label>
  );
}

export function Switch({ label, checked, onChange, disabled }: ToggleProps) {
  return (
    <label className={styles.wrapper}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(styles.track, checked && styles.trackChecked)}
      >
        <span className={styles.thumb} />
      </button>
      {label}
    </label>
  );
}
