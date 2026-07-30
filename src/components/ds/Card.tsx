import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';
import styles from './Card.module.css';

export interface CardProps {
  children: ReactNode;
  inverse?: boolean;
  /** Aplica `--radius-xl` (28px) no lugar do padrão de 20px. */
  large?: boolean;
  /** Padding `clamp(24px, 4vw, 40px)` dos painéis grandes. */
  roomy?: boolean;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'aside';
}

export function Card({
  children,
  inverse,
  large,
  roomy,
  className,
  as: Tag = 'div',
}: CardProps) {
  return (
    <Tag
      className={cx(
        styles.card,
        inverse && styles.inverse,
        large && styles.roundedXl,
        roomy && styles.roomy,
        className,
      )}
    >
      {children}
    </Tag>
  );
}
