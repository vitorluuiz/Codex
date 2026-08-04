'use client';

import { useEffect } from 'react';

import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import styles from './Toast.module.css';

export type ToastTone = 'success' | 'danger' | 'info';

interface ToastProps {
  tone?: ToastTone;
  title?: string;
  message: string;
  onClose: () => void;
  /** Fecha sozinho depois deste tempo. `0` mantém aberto até o clique. */
  autoCloseMs?: number;
}

/**
 * Aviso efêmero, ancorado no canto da tela pelo `ToastViewport`.
 *
 * O fechamento automático vive aqui, e não em quem chama, para o timer ser
 * cancelado junto com o próprio toast — senão um `setTimeout` órfão fecharia o
 * toast seguinte.
 */
export function Toast({ tone = 'success', title, message, onClose, autoCloseMs = 3000 }: ToastProps) {
  useEffect(() => {
    if (!autoCloseMs) return;
    const timer = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(timer);
  }, [autoCloseMs, onClose]);

  return (
    <div className={cx(styles.toast, styles[tone])} role="status" aria-live="polite">
      <div className={styles.body}>
        {title && <div className={styles.title}>{title}</div>}
        <div className={styles.message}>{message}</div>
      </div>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Fechar aviso">
        <Icon.Close size={16} />
      </button>
    </div>
  );
}

/** Canto fixo onde os toasts aparecem. */
export function ToastViewport({ children }: { children: React.ReactNode }) {
  return <div className={styles.viewport}>{children}</div>;
}
