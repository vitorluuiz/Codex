'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export const LAST_PAGE_KEY = 'codex_last_page_before_sala';
export const FROM_INTERNAL_KEY = 'codex_from_internal';
export const CURRENT_PAGE_KEY = 'codex_current_page';
export const PREVIOUS_PAGE_KEY = 'codex_previous_page';

/**
 * Rastreia as rotas acessadas pelo usuário para permitir retorno à tela anterior
 * (inclusive fora do fluxo de /sala).
 */
export function NavigationTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;

    try {
      const fullUrl = window.location.pathname + window.location.search;
      const current = sessionStorage.getItem(CURRENT_PAGE_KEY);
      if (current && current !== fullUrl) {
        sessionStorage.setItem(PREVIOUS_PAGE_KEY, current);
      }
      sessionStorage.setItem(CURRENT_PAGE_KEY, fullUrl);

      // Ignora rotas sob /sala (inclusive /sala/[code]/lobby, /sala/[code]/partida, etc.)
      if (!pathname.startsWith('/sala')) {
        sessionStorage.setItem(LAST_PAGE_KEY, fullUrl);
        sessionStorage.setItem(FROM_INTERNAL_KEY, 'true');
      }
    } catch {
      // Ignora erros de acesso a storage (ex.: modo anônimo restritivo)
    }
  }, [pathname]);

  return null;
}
