'use client';

import { useState } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Button, Meter, Popover, Switch, anchorFrom, type AnchorRect } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type { LeaderPlayerRow, MatchMode, Phase, PhaseStats } from '@/lib/types';
import { challengeModuleFor } from '../registry';
import styles from './LeaderDashboard.module.css';

interface LeaderDashboardProps {
  phase: Phase;
  stats: PhaseStats | null;
  matchMode: MatchMode;
  paused: boolean;
  isFirstPhase: boolean;
  isLastPhase: boolean;
  onTogglePause: () => void;
  onAdvance: (direction: 'next' | 'previous') => void;
  onFinish: () => void;
  onRemovePlayer: (participantId: string) => void;
}

/**
 * Painel de acompanhamento do líder.
 *
 * Dois modos: **anônimo** (só a fase e agregados grossos, seguro para projetar
 * na parede) e **avançado** (métricas por aluno). O toggle é local — não muda
 * nada no servidor.
 */
export function LeaderDashboard({
  phase,
  stats,
  matchMode,
  paused,
  isFirstPhase,
  isLastPhase,
  onTogglePause,
  onAdvance,
  onFinish,
  onRemovePlayer,
}: LeaderDashboardProps) {
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<{ player: LeaderPlayerRow; anchor: AnchorRect } | null>(
    null,
  );

  const { LeaderPreview } = challengeModuleFor(phase);
  const isLive = matchMode === 'live';

  return (
    <div className={styles.dashboard}>
      {paused && (
        <div className={styles.pausedBanner}>
          <Icon.Pause size={20} />
          Sala pausada — o cronômetro dos alunos está parado.
        </div>
      )}

      <div className={styles.head}>
        <h1 className={styles.headTitle}>Painel de acompanhamento</h1>
        <div className={styles.modeToggle}>
          <span>Modo avançado e individual</span>
          <Switch
            label="Modo avançado e individual"
            checked={advanced}
            onChange={setAdvanced}
          />
        </div>
      </div>

      {!advanced && (
        <section className={styles.previewCard}>
          <p className={styles.cardLabel}>Fase em andamento</p>
          <LeaderPreview phase={phase} />
        </section>
      )}

      {stats === null ? (
        <p className={styles.cardNote}>Aguardando as primeiras respostas da turma…</p>
      ) : (
        <>
          <div className={styles.statGrid}>
            {advanced && (
              <div className={styles.card}>
                <p className={styles.cardLabel}>Taxa de acerto</p>
                <div className={cx(styles.cardValue, styles.cardValueSuccess)}>
                  {stats.accuracyRate}%
                </div>
                <p className={styles.cardNote}>
                  {stats.correctCount} de {stats.gradedCount} corretas até agora
                </p>
              </div>
            )}

            <div className={styles.card}>
              <p className={styles.cardLabel}>Tempo médio de resposta</p>
              <div className={styles.cardValue}>{stats.avgResponseSeconds}s</div>
              {advanced && (
                <p className={styles.cardNote}>Mais rápido: {stats.fastestResponseSeconds}s</p>
              )}
            </div>

            <div className={styles.card}>
              <p className={styles.cardLabel}>Pontuação média da turma</p>
              <div className={cx(styles.cardValue, styles.cardValueStreak)}>
                {stats.teamAvgScore}
              </div>
              {advanced && (
                <p className={styles.cardNote}>Maior pontuação: {stats.teamTopScore} pts</p>
              )}
            </div>

            <div className={styles.card}>
              <p className={styles.cardLabel}>Enviaram</p>
              <div className={styles.cardValue}>
                {stats.submittedCount}/{stats.totalPlayers}
              </div>
              <Meter
                className={styles.cardMeter}
                value={percent(stats.submittedCount, stats.totalPlayers)}
                tone="primary"
                label="Envios"
              />
            </div>

            {isLive && (
              <div className={styles.card}>
                <p className={styles.cardLabel}>Prontos para a próxima fase</p>
                <div className={styles.cardValue}>
                  {stats.readyCount}/{stats.totalPlayers}
                </div>
                <Meter
                  className={styles.cardMeter}
                  value={percent(stats.readyCount, stats.totalPlayers)}
                  tone="success"
                  label="Prontos"
                />
              </div>
            )}
          </div>

          {advanced && (
            <>
              <div className={styles.chartRow}>
                <section className={styles.panel}>
                  <h2 className={styles.panelTitle}>Distribuição de respostas</h2>
                  <div className={styles.bars}>
                    {phase.kind === 'quiz'
                      ? stats.answerDistribution.map((entry) => (
                          <DistributionBar
                            key={entry.optionId}
                            label={entry.label}
                            count={entry.count}
                            max={maxOf(stats.answerDistribution.map((item) => item.count))}
                            tone={entry.correct ? 'success' : 'info'}
                            highlight={entry.correct}
                          />
                        ))
                      : stats.gradingDistribution.map((entry) => (
                          <DistributionBar
                            key={entry.status}
                            label={GRADING_LABEL[entry.status]}
                            count={entry.count}
                            max={maxOf(stats.gradingDistribution.map((item) => item.count))}
                            tone={GRADING_TONE[entry.status]}
                            highlight={entry.status === 'correct'}
                          />
                        ))}
                  </div>
                </section>

                <section className={styles.panel}>
                  <h2 className={styles.panelTitle}>Tempo de resposta por faixa</h2>
                  <div className={styles.columns}>
                    {stats.responseTimeBuckets.map((bucket) => (
                      <div key={bucket.label} className={styles.column}>
                        <span className={styles.columnCount}>{bucket.count}</span>
                        <div
                          className={styles.columnBar}
                          style={cssVars({
                            '--bar-height': `${Math.max(
                              8,
                              percent(
                                bucket.count,
                                maxOf(stats.responseTimeBuckets.map((item) => item.count)),
                              ),
                            )}%`,
                          })}
                        />
                        <span className={styles.columnLabel}>{bucket.label}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className={styles.tablePanel}>
                <div className={styles.tableHead}>
                  <h2 className={styles.panelTitle}>Acompanhamento por aluno</h2>
                  <span className={styles.tableCount}>
                    Mostrando {stats.players.length} de {stats.totalPlayers}
                  </span>
                </div>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Aluno</th>
                        <th scope="col">Status</th>
                        <th scope="col">Tempo</th>
                        <th scope="col">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.players.map((player) => (
                        <tr
                          key={player.participantId}
                          className={styles.row}
                          onClick={(event) =>
                            setSelected({ player, anchor: anchorFrom(event.currentTarget) })
                          }
                        >
                          <td>
                            <span className={styles.playerCell}>
                              <Avatar index={player.avatarIndex} size="xs" plain name={player.name} />
                              {player.name}
                            </span>
                          </td>
                          <td>
                            <span
                              className={cx(
                                styles.statusChip,
                                player.status === 'submitted' && styles.statusSubmitted,
                              )}
                            >
                              {player.status === 'submitted' ? 'Enviado' : 'Pendente'}
                            </span>
                          </td>
                          <td className={styles.timeCell}>
                            {player.elapsedSeconds !== null ? `${player.elapsedSeconds}s` : '—'}
                          </td>
                          <td
                            className={cx(
                              styles.resultCell,
                              player.correct === true && styles.resultCorrect,
                              player.correct === false && styles.resultIncorrect,
                            )}
                          >
                            {resultLabel(player.correct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" size="lg" onClick={onTogglePause}>
          {paused ? 'Retomar sala' : 'Pausar sala'}
        </Button>

        <div className={styles.footerRight}>
          {isLive && stats && stats.readyCount < stats.totalPlayers && (
            <span className={styles.footerNote}>
              {stats.totalPlayers - stats.readyCount} alunos ainda não estão prontos
            </span>
          )}
          {!isLive && (
            <Button variant="secondary" size="lg" disabled={isFirstPhase} onClick={() => onAdvance('previous')}>
              Fase anterior
            </Button>
          )}
          {/*
            Na última fase não há para onde avançar: a API responde
            `409 INVALID_DIRECTION` a um `advance`, e o caminho para terminar é
            `finish`. É a mesma troca que a tela do aluno já faz ("Ver pódio" no
            lugar de "Próxima fase") em CollectiveFeedbackScreen.
          */}
          {isLastPhase ? (
            <Button size="lg" onClick={onFinish}>
              Encerrar partida
            </Button>
          ) : (
            <Button size="lg" onClick={() => onAdvance('next')}>
              Próxima fase
            </Button>
          )}
        </div>
      </div>

      {selected && (
        <Popover
          anchor={selected.anchor}
          onClose={() => setSelected(null)}
          label={`Detalhes de ${selected.player.name}`}
        >
          <div className={styles.popoverCard}>
            <div className={styles.popoverHead}>
              <Avatar index={selected.player.avatarIndex} size="sm" plain />
              <div>
                <div className={styles.popoverName}>{selected.player.name}</div>
                <div className={styles.popoverMeta}>
                  <span
                    className={cx(
                      styles.statusChip,
                      selected.player.status === 'submitted' && styles.statusSubmitted,
                    )}
                  >
                    {selected.player.status === 'submitted' ? 'Enviado' : 'Pendente'}
                  </span>
                  <span className={styles.popoverMetaText}>
                    {selected.player.elapsedSeconds !== null
                      ? `${selected.player.elapsedSeconds}s`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.popoverResult}>
              <span className={styles.popoverResultLabel}>Resultado</span>
              <span
                className={cx(
                  styles.resultCell,
                  selected.player.correct === true && styles.resultCorrect,
                  selected.player.correct === false && styles.resultIncorrect,
                )}
              >
                {resultLabel(selected.player.correct)}
              </span>
            </div>

            <Button
              size="sm"
              variant="danger"
              block
              onClick={() => {
                onRemovePlayer(selected.player.participantId);
                setSelected(null);
              }}
            >
              Remover jogador
            </Button>
          </div>
        </Popover>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const GRADING_LABEL = {
  correct: 'Corretas',
  incorrect: 'Incorretas',
  awaiting: 'Aguardando avaliação',
} as const;

const GRADING_TONE = {
  correct: 'success',
  incorrect: 'danger',
  awaiting: 'muted',
} as const;

function DistributionBar({
  label,
  count,
  max,
  tone,
  highlight,
}: {
  label: string;
  count: number;
  max: number;
  tone: 'success' | 'danger' | 'muted' | 'info';
  highlight: boolean;
}) {
  return (
    <div>
      <div className={cx(styles.barHeader, highlight && styles.barHeaderCorrect)}>
        <span>{label}</span>
        <span>{count} alunos</span>
      </div>
      <Meter value={percent(count, max)} tone={tone} size="thick" label={label} />
    </div>
  );
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function maxOf(values: number[]): number {
  return Math.max(1, ...values);
}

function resultLabel(correct: boolean | null): string {
  if (correct === null) return '—';
  return correct ? 'Correto' : 'Incorreto';
}
