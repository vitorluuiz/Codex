'use client';

import { useEffect, useState } from 'react';

import { Meter } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import { formatCountdown } from '@/realtime/useServerCountdown';
import styles from './screens.module.css';

/** Frases de espera. São cópia da interface, não dado da API. */
const PHRASES = [
  'Cada resposta é um passo a mais no seu progresso.',
  'Respire — seus colegas já estão quase terminando.',
  'Você foi rápido! Aguarde o resto da turma chegar.',
  'Errar faz parte de aprender — o importante é tentar.',
  'Quase lá! Só faltam alguns colegas enviarem.',
];

const ROTATION_MS = 2400;

interface WaitingScreenProps {
  submittedCount: number;
  totalPlayers: number;
  secondsLeft: number | null;
  paused: boolean;
}

/**
 * Ponte entre o envio da resposta e a correção. Quem sai daqui é o servidor:
 * quando todo mundo envia (ou o tempo acaba), chega `phase.ended` e a casca
 * troca para o feedback individual.
 */
export function WaitingScreen({
  submittedCount,
  totalPlayers,
  secondsLeft,
  paused,
}: WaitingScreenProps) {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setPhraseIndex((index) => (index + 1) % PHRASES.length),
      ROTATION_MS,
    );
    return () => clearInterval(timer);
  }, []);

  const percent = totalPlayers > 0 ? (submittedCount / totalPlayers) * 100 : 0;

  return (
    <div className={styles.centered}>
      <div className={cx(styles.panel, styles.panelNarrow)}>
        <div className={styles.spinner} role="status" aria-label="Aguardando a turma" />
        <h1 className={styles.waitingTitle}>Resposta enviada!</h1>
        <p className={styles.waitingPhrase}>{PHRASES[phraseIndex]}</p>

        <div className={styles.waitingCounts}>
          <span>
            {submittedCount} de {totalPlayers} enviaram
          </span>
          <span>{Math.round(percent)}%</span>
        </div>
        <Meter value={percent} tone="success" size="medium" label="Envios da turma" />

        <p className={styles.waitingTimer}>
          <Icon.Clock size={16} />
          Tempo restante: {formatCountdown(secondsLeft, paused)}
        </p>
      </div>
    </div>
  );
}
