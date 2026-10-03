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
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (endsAt === null) {
      setSecondsLeft(null);
      return;
    }

    function tick() {
      const remainingMs = endsAt! - (Date.now() + clockOffset);
      setSecondsLeft(Math.max(0, Math.ceil(remainingMs / 1000)));
    }

    tick();
    if (paused) return;

    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [endsAt, paused, clockOffset]);

  return secondsLeft;
}

/** `125` → `"2:05"`. */
export function formatCountdown(seconds: number | null, paused: boolean): string {
  if (paused) return 'Pausado';
  if (seconds === null) return '--:--';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
