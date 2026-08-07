'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Button, Dialog } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { ROOM_STATUS_LABEL, describeActiveRoom } from '@/components/room/activeRoomLabels';
import { roomPath } from '@/lib/roomPath';
import type { ActiveRoom, LeaderMatchSummary } from '@/lib/types';
import styles from './MatchHistorySection.module.css';

const MODE_LABEL: Record<LeaderMatchSummary['mode'], string> = {
  live: 'Ao vivo',
  'self-paced': 'Próprio ritmo',
};

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
}

export function MatchHistorySection({
  matches,
  activeRooms,
  participantsLabel,
  onDownload,
}: MatchHistorySectionProps) {
  const [report, setReport] = useState<LeaderMatchSummary | null>(null);

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Histórico de partidas como líder</h2>

      {/*
        Sala aberta vem antes do histórico porque é a única linha em que ainda dá
        para agir: fechar a aba não encerra a sala, e sem este bloco o líder não
        tinha caminho de volta — o código foi gerado pelo servidor, ninguém o
        decorou. A sala pode estar em andamento; o destino do link acompanha o
        `status`.
      */}
      {activeRooms.length > 0 && (
        <ul className={styles.list}>
          {activeRooms.map((room) => (
            <li key={room.code} className={`${styles.row} ${styles.rowActive}`}>
              <div className={styles.identity}>
                <span className={styles.setTitle}>{describeActiveRoom(room)}</span>
                <div className={styles.subline}>
                  <span className={`${styles.modeChip} ${styles.liveChip}`}>
                    {ROOM_STATUS_LABEL[room.status]}
                  </span>
                  <span className={styles.date}>
                    Sala {room.code} · {room.createdAtLabel}
                  </span>
                </div>
              </div>

              <div className={styles.stat}>
                <span className={styles.statValue}>{room.participantCount}</span>
                <span className={styles.statLabel}>{participantsLabel}</span>
              </div>

              <div className={styles.rowActions}>
                <Link href={roomPath(room)} className={styles.resumeLink}>
                  Voltar para a sala
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {matches.length === 0 ? (
        <p className={styles.empty}>
          {activeRooms.length === 0
            ? 'Nenhuma partida realizada ainda.'
            : activeRooms.length === 1
              ? 'Nenhuma partida encerrada ainda — a sala acima ainda está de pé.'
              : 'Nenhuma partida encerrada ainda — as salas acima ainda estão de pé.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {matches.map((match) => (
            <li key={match.id} className={styles.row}>
              <div className={styles.identity}>
                <span className={styles.setTitle}>{match.setTitle}</span>
                <div className={styles.subline}>
                  <span className={styles.modeChip}>{MODE_LABEL[match.mode]}</span>
                  <span className={styles.date}>{match.playedAtLabel}</span>
                </div>
              </div>

              <div className={styles.stat}>
                <span className={styles.statValue}>{match.participantCount}</span>
                <span className={styles.statLabel}>{participantsLabel}</span>
              </div>

              <div className={styles.stat}>
                <span className={`${styles.statValue} ${styles.statScore}`}>
                  {match.avgScore} pts
                </span>
                <span className={styles.statLabel}>Pontuação média</span>
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
              <ReportTile label="Pontuação média" value={String(report.avgScore)} tone="score" />
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
