'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
  /**
   * Altura aproximada do conteúdo. Só decide a direção da abertura — não entra
   * na posição final —, então errar por alguns pixels não desalinha nada.
   */
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
 *
 * Vai para o fim do `<body>` por portal, e não fica onde foi escrito, porque as
 * coordenadas de `anchorFrom` são de viewport e `position: fixed` só as respeita
 * enquanto nenhum ancestral tiver `transform`, `filter` ou `perspective` — um
 * card que sobe 2px no hover viraria o bloco de contenção do popover e o
 * arrastaria junto a cada entrada e saída do mouse.
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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    // `anchorFrom` mede uma vez, no clique. Rolar ou redimensionar move o
    // gatilho e deixa o popover ancorado no vazio, então a saída é fechar —
    // reposicionar a cada quadro daria a impressão de que ele está solto.
    function onScroll(event: Event) {
      // Rolar a lista de dentro do próprio popover não conta: só o que está
      // atrás dele desancora o popover.
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      onClose();
    }

    document.addEventListener('keydown', onKeyDown);
    // Captura porque `scroll` não borbulha: sem isto, rolar um painel interno
    // da página passaria despercebido.
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;

  const anchorCenterX = anchor.left + anchor.width / 2;
  const rawLeft = align === 'end' ? anchor.left + anchor.width - width : anchorCenterX - width / 2;
  const left = Math.min(Math.max(rawLeft, MARGIN), viewportWidth - width - MARGIN);
  const arrowLeft = Math.min(Math.max(anchorCenterX - left, 20), width - 20);

  const spaceBelow = viewportHeight - anchor.bottom;
  const flipped = spaceBelow < estimatedHeight + MARGIN && anchor.top > spaceBelow;

  // Aberto para cima, a âncora é o rodapé: o CSS mede a partir da base da
  // viewport e a borda de baixo do painel para no mesmo ponto acima do gatilho
  // qualquer que seja a altura real. Descontar `estimatedHeight` de `top`
  // deixaria cada popover da tela a uma distância diferente do seu gatilho.
  const placement: Record<string, string> = flipped
    ? { '--popover-bottom': `${viewportHeight - anchor.top + GAP}px` }
    : { '--popover-top': `${Math.max(MARGIN, anchor.bottom + GAP)}px` };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} role="presentation" />
      <div
        ref={panelRef}
        className={cx(styles.popover, flipped ? styles.above : styles.below)}
        role="dialog"
        aria-label={label}
        style={cssVars({
          ...placement,
          '--popover-left': `${left}px`,
          '--popover-width': `${width}px`,
          '--popover-arrow-left': `${arrowLeft}px`,
        })}
      >
        <span className={cx(styles.arrow, flipped ? styles.arrowBottom : styles.arrowTop)} />
        {children}
      </div>
    </>,
    document.body,
  );
}
