'use client';

import { useId, useState, type ReactNode } from 'react';

import styles from './Tooltip.module.css';
import { cx } from '@/lib/cx';

interface TooltipProps {
  label: string;
  children: ReactNode;
  openDirection?: "top" | "down";
}

export function Tooltip({ label, children, openDirection = 'down' }: TooltipProps) {
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
        <span
          className={cx(styles.bubble, openDirection === 'down' ? styles.bubbleDescending : styles.bubbleAscending)}
          role="tooltip"
          id={id}>
          {label}
        </span>
      )}
    </span>
  );
}
