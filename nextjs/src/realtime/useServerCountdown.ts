'use client';

import { useEffect, useState } from 'react';

import { useRealtime } from './RealtimeProvider';

/**
 * Cronômetro ancorado no relógio do servidor.
 *
 * Não decrementa um contador local (que desalinha com aba em segundo plano,
 * throttling de timer e reconexão) — recalcula `endsAt - agora` a cada tique,
 * já corrigido pelo offset medido no `pong`.
 */
export function useServerCountdown(endsAt: number | null, paused: boolean): number | null {
  const { clockOffset } = useRealtime();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (endsAt === null || paused) return;

    const interval = setInterval(() => {
      setTick((t) => (t + 1) | 0);
    }, 250);

    return () => clearInterval(interval);
  }, [endsAt, paused]);

  if (endsAt === null || paused) return null;
  const remainingMs = endsAt - (Date.now() + clockOffset);
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

/** `125` → `"2:05"`. */
export function formatCountdown(seconds: number | null, paused: boolean): string {
  if (paused) return 'Pausado';
  if (seconds === null) return '--:--';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
