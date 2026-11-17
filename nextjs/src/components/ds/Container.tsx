import type { ElementType, HTMLAttributes, ReactNode } from 'react';

import { cx } from '@/lib/cx';
import styles from './Container.module.css';

export type ContainerSize = 'wide' | 'narrow' | 'compact' | 'full';

export interface ContainerProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
  size?: ContainerSize;
  /**
   * Define o espaçamento lateral (padding-inline).
   * - `true`: calha padrão responsiva `clamp(16px, 4vw, 48px)`.
   * - `'wide'`: calha ampla `clamp(20px, 5vw, 64px)`.
   * - `false`: sem calha embutida.
   */
  padded?: boolean | 'wide';
  className?: string;
  as?: ElementType;
}

export function Container({
  children,
  size = 'wide',
  padded = true,
  className,
  as: Component = 'div',
  ...rest
}: ContainerProps) {
  return (
    <Component
      className={cx(
        styles.container,
        styles[size],
        padded === 'wide' ? styles.paddedWide : padded && styles.padded,
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
