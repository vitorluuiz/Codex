'use client';

import { useId, useState, type ReactNode } from 'react';

import styles from './Tooltip.module.css';

interface TooltipProps {
  label: string;
  children: ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      aria-describedby={id}
    >
      {children}
      {visible && (
        <span className={styles.bubble} role="tooltip" id={id}>
          {label}
        </span>
      )}
    </span>
  );
}
