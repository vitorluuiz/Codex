import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';
import styles from './Tag.module.css';

export type TagTone = 'neutral' | 'blue' | 'pink' | 'green' | 'amber';

export interface TagProps {
  children: ReactNode;
  tone?: TagTone;
  icon?: ReactNode;
  className?: string;
}

export function Tag({ children, tone = 'neutral', icon, className }: TagProps) {
  return (
    <span className={cx(styles.tag, styles[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
