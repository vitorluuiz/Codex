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
          style={{ height: `${Math.max(value, 8)}%`, background: accuracyColor(value) }}
        />
      ))}
      {remainingValues.map((value, index) => (
        <div
          key={index}
          className={cx(styles.sparklineBar, styles.sparklineBarRemaining)}
          style={{ height: `${Math.max(value, 8)}%` }}
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
  onDownload: (match: LeaderMatchSummary) => void;
  onCloseRoom: (room: ActiveRoom) => void;
}

export function MatchHistorySection({
  matches,
  activeRooms,
  participantsLabel,
  onDownload,
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
            <li key={match.id} className={styles.row}>
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
                  <span className={styles.statMax}> / {match.maxAvgScore? match.maxAvgScore : 100}</span>
                </span>
                <span className={styles.statLabel}>
                  {match.participantCount} {participantsLabel}
                </span>
              </div>

              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setReport(match)}
                  title="Ver relatório"
                  aria-label={`Ver relatório de ${match.setTitle}`}
                >
                  <Icon.Eye size={16} />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled
                  onClick={() => onDownload(match)}
                  title="Baixar relatório"
                  aria-label={`Baixar relatório de ${match.setTitle}`}
                >
                  <Icon.Download size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={report !== null} title="Relatório da partida" onClose={() => setReport(null)}>
        {report && (
          <div className={styles.report}>
            <div>
              <div className={styles.reportTitle}>{report.setTitle}</div>
              <div className={styles.reportMeta}>
                {report.playedAtLabel} · {MODE_LABEL[report.mode]}
              </div>
            </div>

            <div className={styles.reportGrid}>
              <ReportTile label={participantsLabel} value={String(report.participantCount)} />
              <ReportTile
                label="Pontuação média"
                value={`${report.avgScore} / ${report.maxAvgScore}`}
                tone="score"
              />
              <ReportTile label="Taxa de acerto" value={`${report.accuracyRate}%`} tone="success" />
              <ReportTile label="Duração" value={report.durationLabel} />
            </div>

            <div className={styles.reportActions}>
              <Button variant="secondary" onClick={() => setReport(null)}>
                Fechar
              </Button>
              <Button onClick={() => onDownload(report)}>Baixar relatório</Button>
            </div>
          </div>
        )}
      </Dialog>
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
