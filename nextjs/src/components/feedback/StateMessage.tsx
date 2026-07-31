import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';
import styles from './StateMessage.module.css';

interface StateMessageProps {
  title: string;
  children?: ReactNode;
  /** Endpoint ou variável de ambiente que falta — mostrado em monoespaçada. */
  hint?: string;
  variant?: 'panel' | 'inline' | 'centered';
}

/**
 * Estado vazio / indisponível. Existe para que nenhuma tela precise inventar
 * dado: quando a API ainda não responde, a interface diz o que falta em vez de
 * exibir números fictícios.
 */
export function StateMessage({ title, children, hint, variant = 'panel' }: StateMessageProps) {
  return (
    <div
      className={cx(
        styles.wrapper,
        variant === 'inline' && styles.inline,
        variant === 'centered' && styles.centered,
      )}
    >
      <h2 className={styles.title}>{title}</h2>
      {children && <p className={styles.body}>{children}</p>}
      {hint && <code className={styles.hint}>{hint}</code>}
    </div>
  );
}
