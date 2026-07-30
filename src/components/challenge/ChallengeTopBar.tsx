'use client';

import { useState } from 'react';

import { Meter, Popover, anchorFrom, type AnchorRect } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { Phase, PlayerScoreboard } from '@/lib/types';
import { formatCountdown } from '@/realtime/useServerCountdown';
import styles from './ChallengeTopBar.module.css';

/** Abaixo disso o cronômetro fica vermelho e pulsa. */
const URGENT_SECONDS = 10;

export interface LeaderControls {
  onRestartPhase: () => void;
  onBackToLobby: () => void;
  onFinishMatch: () => void;
}

interface ChallengeTopBarProps {
  phase: Phase;
  phaseNumber: number;
  totalPhases: number;
  secondsLeft: number | null;
  paused: boolean;
  submittedCount: number;
  totalPlayers: number;
  /** Só para alunos. */
  scoreboard: PlayerScoreboard | null;
  /** Só para o líder. */
  leaderControls: LeaderControls | null;
}

/**
 * Barra superior comum a todas as fases. Não sabe nada sobre tipo de desafio —
 * só sobre a fase corrente, o tempo e o progresso da turma.
 */
export function ChallengeTopBar({
  phase,
  phaseNumber,
  totalPhases,
  secondsLeft,
  paused,
  submittedCount,
  totalPlayers,
  scoreboard,
  leaderControls,
}: ChallengeTopBarProps) {
  const [menuAnchor, setMenuAnchor] = useState<AnchorRect | null>(null);

  const points = Math.round(phase.basePoints * phase.pointsMultiplier);
  const urgent = !paused && secondsLeft !== null && secondsLeft <= URGENT_SECONDS;
  const submittedPct = totalPlayers > 0 ? (submittedCount / totalPlayers) * 100 : 0;

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.phaseChip}>
          Fase {phaseNumber} de {totalPhases}
        </span>
        <span className={styles.phaseName}>{phase.name}</span>
        <span className={styles.pointsChip}>
          Vale {points} pts
          {phase.pointsMultiplier !== 1 && (
            <span className={styles.multiplier}>x{phase.pointsMultiplier}</span>
          )}
        </span>
      </div>

      <div className={styles.right}>
        <div
          className={cx(styles.timer, paused && styles.timerPaused, urgent && styles.timerUrgent)}
        >
          <Icon.Clock size={22} />
          <span className={styles.timerValue}>{formatCountdown(secondsLeft, paused)}</span>
        </div>

        <div className={styles.progress}>
          <span className={styles.progressLabel}>
            {submittedCount} de {totalPlayers} enviaram
          </span>
          <Meter value={submittedPct} tone="success" onDark label="Progresso de envios" />
        </div>

        {scoreboard && (
          <div className={styles.scoreboard}>
            <div className={styles.scoreCell}>
              <div className={styles.scoreCellLabel}>Você</div>
              <div className={cx(styles.scoreCellValue, styles.scoreMine)}>
                {scoreboard.myScore}
              </div>
            </div>
            <div className={styles.scoreCell}>
              <div className={styles.scoreCellLabel}>Média</div>
              <div className={cx(styles.scoreCellValue, styles.scoreAverage)}>
                {scoreboard.avgScore}
              </div>
            </div>
          </div>
        )}

        {leaderControls && (
          <button
            type="button"
            className={styles.adminTrigger}
            title="Controles administrativos"
            aria-label="Controles administrativos"
            onClick={(event) => setMenuAnchor(anchorFrom(event.currentTarget))}
          >
            <Icon.More size={18} />
          </button>
        )}
      </div>

      {menuAnchor && leaderControls && (
        <Popover
          anchor={menuAnchor}
          width={260}
          align="end"
          estimatedHeight={200}
          onClose={() => setMenuAnchor(null)}
          label="Controles do líder"
        >
          <div className={styles.adminMenu}>
            <p className={styles.adminMenuLabel}>Controles do líder</p>
            <button
              type="button"
              className={styles.adminItem}
              onClick={() => {
                setMenuAnchor(null);
                leaderControls.onRestartPhase();
              }}
            >
              <Icon.Restart size={18} />
              Reiniciar fase atual
            </button>
            <button
              type="button"
              className={styles.adminItem}
              onClick={() => {
                setMenuAnchor(null);
                leaderControls.onBackToLobby();
              }}
            >
              <Icon.ArrowLeft size={18} />
              Voltar para o lobby
            </button>
            <hr className={styles.adminDivider} />
            <button
              type="button"
              className={cx(styles.adminItem, styles.adminItemDanger)}
              onClick={() => {
                setMenuAnchor(null);
                leaderControls.onFinishMatch();
              }}
            >
              <Icon.Power size={18} />
              Encerrar partida agora
            </button>
          </div>
        </Popover>
      )}
    </header>
  );
}
