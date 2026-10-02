'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from '@/lib/cx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  /** Ocupa 100% da largura do container. */
  block?: boolean;
  /** Padding horizontal extra — usado nos CTAs centralizados do design. */
  wide?: boolean;
  /** Classe de posicionamento (margem, grid-area). Nunca de aparência. */
  className?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  block,
  wide,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        styles[size],
        styles[variant],
        block && styles.block,
        wide && styles.wide,
        className,
      )}
      {...rest}
    >
      {icon && iconPosition === 'left' && <span className={styles.icon}>{icon}</span>}
      {children}
      {icon && iconPosition === 'right' && <span className={styles.icon}>{icon}</span>}
    </button>
  );
}
