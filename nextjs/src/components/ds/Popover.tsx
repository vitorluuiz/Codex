'use client';

import { useEffect, type ReactNode } from 'react';

import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import styles from './Popover.module.css';

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/** Captura a posição do elemento clicado, em coordenadas de viewport. */
export function anchorFrom(element: HTMLElement): AnchorRect {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width };
}

interface PopoverProps {
  anchor: AnchorRect;
  width?: number;
  /** `center` alinha pelo meio do gatilho; `end` alinha a borda direita. */
  align?: 'center' | 'end';
  estimatedHeight?: number;
  onClose: () => void;
  children: ReactNode;
  label: string;
}

const MARGIN = 12;
const GAP = 10;

/**
 * Popover ancorado com posicionamento resolvido em JS (viewport-aware: vira
 * para cima quando não cabe embaixo) e desenhado em CSS. Os números viajam como
 * custom properties — ver `src/lib/cssVars.ts`.
 */
export function Popover({
  anchor,
  width = 260,
  align = 'center',
  estimatedHeight = 260,
  onClose,
  children,
  label,
}: PopoverProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;

  const anchorCenterX = anchor.left + anchor.width / 2;
  const rawLeft = align === 'end' ? anchor.left + anchor.width - width : anchorCenterX - width / 2;
  const left = Math.min(Math.max(rawLeft, MARGIN), viewportWidth - width - MARGIN);
  const arrowLeft = Math.min(Math.max(anchorCenterX - left, 20), width - 20);

  const spaceBelow = viewportHeight - anchor.bottom;
  const flipped = spaceBelow < estimatedHeight + MARGIN && anchor.top > spaceBelow;
  const top = flipped ? anchor.top - estimatedHeight - GAP : anchor.bottom + GAP;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} role="presentation" />
      <div
        className={styles.popover}
        role="dialog"
        aria-label={label}
        style={cssVars({
          '--popover-top': `${Math.max(MARGIN, top)}px`,
          '--popover-left': `${left}px`,
          '--popover-width': `${width}px`,
          '--popover-arrow-left': `${arrowLeft}px`,
        })}
      >
        <span className={cx(styles.arrow, flipped ? styles.arrowBottom : styles.arrowTop)} />
        {children}
      </div>
    </>
  );
}
