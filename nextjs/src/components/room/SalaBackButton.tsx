'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ds/Button';
import { FROM_INTERNAL_KEY, LAST_PAGE_KEY } from '@/components/nav/NavigationTracker';
import styles from './SalaBackButton.module.css';

interface SalaBackButtonProps {
  fallbackUrl?: string;
}

function getReturnLabel(path: string): string {
  if (path === '/perfil' || path.startsWith('/perfil/')) {
    return 'Retornar para o perfil';
  }
  if (path === '/' || path.startsWith('/?')) {
    return 'Retornar para o início';
  }
  if (path === '/conjuntos' || path.startsWith('/conjuntos/')) {
    return 'Retornar para conjuntos';
  }
  if (path.startsWith('/conjunto/')) {
    return 'Retornar para o conjunto';
  }
  return 'Retornar';
}

export function   SalaBackButton({ fallbackUrl = '/' }: SalaBackButtonProps) {
  const router = useRouter();
  const [destination, setDestination] = useState<string>(fallbackUrl);

  useEffect(() => {
    let target = '';
    try {
      const stored = sessionStorage.getItem(LAST_PAGE_KEY);
      if (stored && !stored.startsWith('/sala')) {
        target = stored;
      }
    } catch {
      // Storage indisponível
    }

    if (!target && typeof document !== 'undefined' && document.referrer) {
      try {
        const refUrl = new URL(document.referrer);
        if (refUrl.origin === window.location.origin && !refUrl.pathname.startsWith('/sala')) {
          target = refUrl.pathname + refUrl.search;
        }
      } catch {
        // Referrer inválido ou externo
      }
    }

    if (target) {
      setDestination(target);
    }
  }, []);

  const label = getReturnLabel(destination);

  const handleClick = (event: React.MouseEvent) => {
    try {
      // Não faz router.back() se caiu aqui por expulsão de sala (evita loop com a sala fechada/removida)
      const isRoomExit = window.location.search.includes('saida=');
      const fromInternal = sessionStorage.getItem(FROM_INTERNAL_KEY) === 'true';

      if (!isRoomExit && fromInternal && window.history.length > 1) {
        event.preventDefault();
        router.back();
        return;
      }
    } catch {
      // Deixa a navegação natural do Link acontecer
    }
  };

  return (
    <Link href={destination} onClick={handleClick} className={styles.link}>
      <Button icon={<img src="/Icons/arrow_left.svg" alt="" />} variant="link">
        {label}
      </Button>
    </Link>
  );
}
