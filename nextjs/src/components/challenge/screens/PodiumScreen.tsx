'use client';

import { useEffect, useState } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Button, Tooltip } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type { PodiumEntry } from '@/lib/types';
import styles from './PodiumScreen.module.css';

/** Altura de cada degrau, na ordem 1º, 2º, 3º. */
const BAR_HEIGHTS = ['220px', '170px', '130px'];
/** Ordem visual: 2º à esquerda, 1º no meio, 3º à direita. */
const DISPLAY_ORDER = [1, 0, 2];

interface PodiumScreenProps {
  entries: PodiumEntry[];
  onViewReport: () => void;
  onContinue: () => void;
}

export function PodiumScreen({ entries, onViewReport, onContinue }: PodiumScreenProps) {
  const [risen, setRisen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setRisen(true), 80);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={styles.stage}>
      <Icon.Sparkle size={28} className={cx(styles.sparkle, styles.sparkle1)} />
      <Icon.Sparkle size={20} className={cx(styles.sparkle, styles.sparkle2)} />
      <Icon.Sparkle size={18} className={cx(styles.sparkle, styles.sparkle3)} />
      <Icon.Sparkle size={24} className={cx(styles.sparkle, styles.sparkle4)} />

      <div className={styles.header}>
        <p className={styles.eyebrow}>Fim da partida</p>
        <h1 className={styles.title}>Pódio da turma</h1>
      </div>

      {entries.length === 0 ? (
        <p className={styles.empty}>Nenhuma pontuação registrada nesta partida.</p>
      ) : (
        <div className={styles.podium}>
          {DISPLAY_ORDER.map((rank) => {
            const entry = entries[rank];
            if (!entry) return null;

            return (
              <div
                key={entry.participantId}
                className={cx(styles.place, rank === 0 && styles.placeFirst)}
                style={cssVars({ '--place-opacity': risen ? 1 : 0 })}
              >
                {rank === 0 && <Icon.Crown size={30} className={styles.crown} />}
                <span className={cx(styles.name, rank === 0 && styles.nameFirst)}>{entry.name}</span>
                <Avatar
                  index={entry.avatarIndex}
                  size={rank === 0 ? 'xl' : 'lg'}
                  name={entry.name}
                  className={cx(
                    styles.avatar,
                    rank === 0 && styles.avatarFirst,
                    rank === 2 && styles.avatarThird,
                  )}
                />
                <span
                  className={cx(
                    styles.score,
                    rank === 0 && styles.scoreFirst,
                    rank === 2 && styles.scoreThird,
                  )}
                >
                  {entry.score} pts
                </span>
                <div
                  className={cx(
                    styles.bar,
                    rank === 0 && styles.barFirst,
                    rank === 1 && styles.barSecond,
                    rank === 2 && styles.barThird,
                  )}
                  style={cssVars({ '--bar-height': risen ? BAR_HEIGHTS[rank] : '0px' })}
                >
                  {rank + 1}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.actions}>
        <Tooltip openDirection='top' label='Os relatórios estão temporariamente indisponíveis'>
          <Button disabled size="lg" variant="secondary" onClick={onViewReport}>
            Ver relatório
          </Button>
        </Tooltip>
        <Button size="lg" onClick={onContinue}>
          Continuar jogando
        </Button>
      </div>
    </div>
  );
}
