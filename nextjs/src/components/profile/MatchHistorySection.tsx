'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ds';
import {
  MatchHistoryList,
  type MatchHistoryRowItem,
} from '@/components/match-history/MatchHistoryList';
import listStyles from '@/components/match-history/MatchHistoryList.module.css';
import { cx } from '@/lib/cx';
import { roomPath } from '@/lib/roomPath';
import type { ActiveRoom, LeaderMatchSummary } from '@/lib/types';
import styles from './MatchHistorySection.module.css';

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
  const [closing, startClosing] = useTransition();
  const [closingCode, setClosingCode] = useState<string | null>(null);

  function closeRoom(room: ActiveRoom) {
    setClosingCode(room.code);
    startClosing(() => {
      onCloseRoom(room);
    });
  }

  const items: MatchHistoryRowItem[] = matches.map((match) => ({
    id: match.id,
    href: `/relatorios/${match.id}`,
    title: match.setTitle,
    mode: match.mode,
    dateLabel: match.playedAtLabel,
    phaseValues: match.phaseAvgScore,
    score: match.avgScore,
    maxScore: match.maxAvgScore ? match.maxAvgScore : 100,
    statLabel: `${match.participantCount} ${participantsLabel}`,
  }));

  /*
    Sala aberta vem antes do histórico porque é a única linha em que ainda dá
    para agir: fechar a aba não encerra a sala, e sem este bloco o líder não
    tinha caminho de volta — o código foi gerado pelo servidor, ninguém o
    decorou.
  */
  const activeRoomRows = activeRooms.map((room) => (
    <li key={room.code} className={cx(listStyles.row, styles.rowActive)}>
      <div className={listStyles.identity}>
        <span className={listStyles.setTitle}>
          {room.setTitle
            ? `${room.setTitle} · ${room.phaseCount ?? 0} fases`
            : `${room.phaseCount ?? 0} fases`}
        </span>
        <div className={listStyles.subline}>
          <span className={listStyles.date}>{room.createdAtLabel}</span>
        </div>
      </div>

      <div className={styles.rowLiveStatus}>
        <div className={styles.liveInfos}>
          <span className={cx(listStyles.modeChip, styles.liveChip)}>
            <span className={styles.liveDot} />
            Em andamento
          </span>
          <span>
            {room.participantCount} {participantsLabel.toLowerCase()}
            {room.currentPhase != null ? ` · fase ${room.currentPhase}` : ' no lobby'}
          </span>
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
  ));

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Histórico de partidas como líder</h2>

      <MatchHistoryList
        items={items}
        leadingItems={activeRoomRows}
        hasLeadingItems={activeRooms.length > 0}
        emptyMessage="Nenhuma partida realizada ainda."
      />
    </section>
  );
}
