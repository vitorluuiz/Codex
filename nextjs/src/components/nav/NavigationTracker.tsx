'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export const LAST_PAGE_KEY = 'codex_last_page_before_sala';
export const FROM_INTERNAL_KEY = 'codex_from_internal';

/**
 * Rastreia as rotas acessadas pelo usuário fora do fluxo de /sala.
 * Salva a última página acessada em sessionStorage para que a tela /sala
 * saiba exatamente de onde a pessoa veio e permita o retorno.
 */
export function NavigationTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;

    // Ignora rotas sob /sala (inclusive /sala/[code]/lobby, /sala/[code]/partida, etc.)
    if (!pathname.startsWith('/sala')) {
      try {
        const fullUrl = window.location.pathname + window.location.search;
        sessionStorage.setItem(LAST_PAGE_KEY, fullUrl);
        sessionStorage.setItem(FROM_INTERNAL_KEY, 'true');
      } catch {
        // Ignora erros de acesso a storage (ex.: modo anônimo restritivo)
      }
    }
  }, [pathname]);

  return null;
}
