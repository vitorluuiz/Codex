'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { Button, Dialog } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { roomPath } from '@/lib/roomPath';
import type { ActiveRoom, LeaderMatchSummary } from '@/lib/types';
import styles from './MatchHistorySection.module.css';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';

const MODE_LABEL: Record<LeaderMatchSummary['mode'], string> = {
  live: 'Ao vivo',
  'self-paced': 'Próprio ritmo',
};

/** Cor da barra do mini-gráfico, na mesma escala usada no restante do app. */
function accuracyColor(value: number): string {
  if (value >= 75) return 'var(--accent-success)';
  if (value >= 50) return 'var(--accent-streak)';
  return 'var(--accent-danger)';
}

function PhaseSparkline({ values, remainingValuesCount }: { values: number[], remainingValuesCount: number | null }) {
  const remainingValues = remainingValuesCount ? new Array(remainingValuesCount).fill(50) : [];

  return (
    <div className={styles.sparkline}>
      {values.map((value, index) => (
        <div
          key={index}
          className={styles.sparklineBar}
          style={{ height: `${Math.min(value, 100)}%`, background: accuracyColor(value) }}
        />
      ))}
      {remainingValues.map((value, index) => (
        <div
          key={index}
          className={cx(styles.sparklineBar, styles.sparklineBarRemaining)}
          style={{ height: `${Math.min(value, 100)}%` }}
        />
      ))}
    </div>
  );
}

interface MatchHistorySectionProps {
  matches: LeaderMatchSummary[];
  /**
   * Salas ainda de pé conduzidas por esta pessoa. Vazio num perfil alheio — o
   * código de 6 dígitos é a credencial da sala e não sai para quem só abriu um
   * link de perfil.
   */
  activeRooms: ActiveRoom[];
  /** "Participantes" ou "Candidatos", conforme o público da conta. */
  participantsLabel: string;
  onCloseRoom: (room: ActiveRoom) => void;
}

export function MatchHistorySection({
  matches,
  activeRooms,
  participantsLabel,
  onCloseRoom,
}: MatchHistorySectionProps) {
  const [report, setReport] = useState<LeaderMatchSummary | null>(null);
  const [closing, startClosing] = useTransition();
  const [closingCode, setClosingCode] = useState<string | null>(null);

  const isEmpty = activeRooms.length === 0 && matches.length === 0;

  function closeRoom(room: ActiveRoom) {
    setClosingCode(room.code);
    startClosing(() => {
      onCloseRoom(room);
    });
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Histórico de partidas como líder</h2>

      {isEmpty ? (
        <p className={styles.empty}>Nenhuma partida realizada ainda.</p>
      ) : (
        <ul className={styles.list}>
          {/*
            Sala aberta vem antes do histórico porque é a única linha em que ainda dá
            para agir: fechar a aba não encerra a sala, e sem este bloco o líder não
            tinha caminho de volta — o código foi gerado pelo servidor, ninguém o
            decorou.
          */}
          {activeRooms.map((room) => (
            <li key={room.code} className={`${styles.row} ${styles.rowActive}`}>
              <div className={styles.identity}>
                <span className={styles.setTitle}>
                  {room.setTitle
                    ? `${room.setTitle} · ${room.phaseCount ?? 0} fases`
                    : `${room.phaseCount ?? 0} fases`}
                </span>
                <div className={styles.subline}>
                  <span className={styles.date}>
                    {room.createdAtLabel}
                  </span>
                </div>
              </div>

              <div className={styles.rowLiveStatus}>
                {/* <PhaseSparkline values={[]} remainingValuesCount={room.phaseCount && room.currentPhase && (room.phaseCount - room.currentPhase)} /> */}
                <div className={styles.liveInfos}>
                  <span className={`${styles.modeChip} ${styles.liveChip}`}>
                    <span className={styles.liveDot} />
                    Em andamento
                  </span>
                  <span>{room.participantCount} {participantsLabel.toLowerCase()}
                    {room.currentPhase != null ? ` · fase ${room.currentPhase}` : ' no lobby'}</span>
                </div>
              </div>

              <div className={styles.rowActions}>
                <Button
                  variant="secondary"
                  onClick={() => closeRoom(room)}
                  disabled={closing && closingCode === room.code}
                >
                  Encerrar sala
                </Button>
                <Link href={roomPath(room)} className={styles.resumeLink}>
                  Acompanhar
                </Link>
              </div>
            </li>
          ))}

          {matches.map((match) => (
            <Link key={match.id} href={`/relatorios/${match.id}`} className={styles.matchNav}>
              <li className={styles.row}>
                <div className={styles.identity}>
                  <span className={styles.setTitle}>{match.setTitle}</span>
                  <div className={styles.subline}>
                    <span className={styles.modeChip}>{MODE_LABEL[match.mode]}</span>
                    <span className={styles.date}>{match.playedAtLabel}</span>
                  </div>
                </div>

                <PhaseSparkline values={match.phaseAvgScore} remainingValuesCount={null} />

                <div className={styles.stat}>
                  <span className={`${styles.statValue} ${styles.statScore}`}>
                    {match.avgScore}
                    <span className={styles.statMax}> / {match.maxAvgScore ? match.maxAvgScore : 100}</span>
                  </span>
                  <span className={styles.statLabel}>
                    {match.participantCount} {participantsLabel}
                  </span>
                </div>
              </li>
            </Link>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'score' | 'success';
}) {
  const toneClass = tone === 'score' ? styles.tileScore : tone === 'success' ? styles.tileSuccess : '';
  return (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={`${styles.tileValue} ${toneClass}`}>{value}</div>
    </div>
  );
}
