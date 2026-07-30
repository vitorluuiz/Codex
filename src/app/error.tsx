'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ds';
import { StateMessage } from '@/components/feedback/StateMessage';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Em produção isto vai para o coletor de erros configurado no deploy.
    console.error(error);
  }, [error]);

  return (
    <StateMessage variant="centered" title="Algo deu errado" hint={error.digest}>
      Não conseguimos carregar esta tela.
      <br />
      <Button onClick={reset}>Tentar de novo</Button>
    </StateMessage>
  );
}
