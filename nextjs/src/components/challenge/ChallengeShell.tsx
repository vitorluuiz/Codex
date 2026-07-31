'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';

import { RealtimeProvider, useRealtime, useRealtimeEvent } from '@/realtime/RealtimeProvider';
import { channels } from '@/realtime/protocol';
import { useServerCountdown } from '@/realtime/useServerCountdown';
import {
  advancePhaseAction,
  finishMatchAction,
  loadPhaseComparisonAction,
  loadPodiumAction,
  markReadyAction,
  removePlayerFromMatchAction,
  restartPhaseAction,
  returnToLobbyAction,
  setPausedAction,
  submitAnswerAction,
} from '@/lib/actions/match';
import type {
  AnswerPayload,
  Match,
  Phase,
  PhaseComparison,
  PhaseState,
  PhaseStats,
  PlayerScoreboard,
  PodiumEntry,
  Submission,
} from '@/lib/types';
import { ChallengeTopBar, type LeaderControls } from './ChallengeTopBar';
import { LeaderDashboard } from './leader/LeaderDashboard';
import { challengeModuleFor } from './registry';
import { CollectiveFeedbackScreen } from './screens/CollectiveFeedbackScreen';
import { IndividualFeedbackScreen } from './screens/IndividualFeedbackScreen';
import { PodiumScreen } from './screens/PodiumScreen';
import { WaitingScreen } from './screens/WaitingScreen';
import type { ChallengeScreen } from './types';
import styles from './ChallengeShell.module.css';

export interface ChallengeShellProps {
  roomCode: string;
  match: Match;
  isLeader: boolean;
  participantId: string | null;
  initialPhaseState: PhaseState;
  initialStats: PhaseStats | null;
  initialScoreboard: PlayerScoreboard | null;
}

export function ChallengeShell(props: ChallengeShellProps) {
  const list = [channels.match(props.roomCode)];
  if (props.isLeader) list.push(channels.leader(props.roomCode));
  if (props.participantId) list.push(channels.participant(props.participantId));

  return (
    <RealtimeProvider roomCode={props.roomCode} channels={list}>
      <ChallengeContent {...props} />
    </RealtimeProvider>
  );
}

/**
 * Casca da tela de Desafios.
 *
 * É o suporte comum a todos os tipos de fase: barra superior, cronômetro
 * sincronizado, contadores da turma, o ciclo envio → espera → feedback
 * individual → comparação → pódio, e o painel do líder. Ela não sabe o que é um
 * quiz ou um desafio de código — pergunta ao `registry` qual componente
 * renderizar e passa `onSubmit`.
 */
function ChallengeContent({
  roomCode,
  match,
  isLeader,
  initialPhaseState,
  initialStats,
  initialScoreboard,
}: ChallengeShellProps) {
  const router = useRouter();
  const { state: connection } = useRealtime();
  const [, startTransition] = useTransition();

  /* --- estado vindo do servidor ------------------------------------------ */

  const [phaseState, setPhaseState] = useState<PhaseState>(initialPhaseState);
  const [endsAt, setEndsAt] = useState<number | null>(
    initialPhaseState.secondsLeft > 0 ? Date.now() + initialPhaseState.secondsLeft * 1000 : null,
  );
  const [stats, setStats] = useState<PhaseStats | null>(initialStats);
  const [scoreboard, setScoreboard] = useState<PlayerScoreboard | null>(initialScoreboard);
  const [matchStatus, setMatchStatus] = useState(match.status);

  /* --- estado local do aluno --------------------------------------------- */

  const [screen, setScreen] = useState<ChallengeScreen>(
    initialPhaseState.mySubmission ? 'waiting' : 'challenge',
  );
  const [submission, setSubmission] = useState<Submission | null>(initialPhaseState.mySubmission);
  const [comparison, setComparison] = useState<PhaseComparison | null>(null);
  const [podium, setPodium] = useState<PodiumEntry[]>([]);
  const [readyMarked, setReadyMarked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const paused = phaseState.paused;
  const secondsLeft = useServerCountdown(endsAt, paused);
  const phase = phaseState.phase;
  const isLastPhase = phaseState.phaseNumber >= phaseState.totalPhases;

  /* --- eventos de tempo real --------------------------------------------- */

  useRealtimeEvent('phase.started', (message) => {
    setPhaseState(message.state);
    setEndsAt(message.endsAt);
    setScreen('challenge');
    setSubmission(message.state.mySubmission);
    setComparison(null);
    setReadyMarked(false);
    setSubmitting(false);
  });

  useRealtimeEvent('phase.paused', (message) => {
    setPhaseState((state) => ({ ...state, paused: message.paused }));
    setEndsAt(message.endsAt);
  });

  useRealtimeEvent('phase.progress', (message) => {
    setPhaseState((state) => ({
      ...state,
      submittedCount: message.submittedCount,
      totalPlayers: message.totalPlayers,
    }));
  });

  // O servidor decide quando a fase termina (todos enviaram ou o tempo acabou).
  useRealtimeEvent('phase.ended', () => {
    setScreen((current) => (current === 'waiting' ? 'individual' : current));
  });

  useRealtimeEvent('submission.graded', (message) => {
    setSubmission(message.submission);
    setScreen((current) => (current === 'waiting' ? 'individual' : current));
  });

  useRealtimeEvent('stats.updated', (message) => {
    setStats(message.stats);
    setScoreboard((current) =>
      current ? { ...current, avgScore: message.stats.teamAvgScore } : current,
    );
  });

  useRealtimeEvent('match.finished', (message) => {
    setPodium(message.podium);
    setMatchStatus('finished');
    setScreen('podium');
  });

  useRealtimeEvent('match.returned-to-lobby', () => {
    router.push(`/sala/${roomCode}/lobby`);
  });

  useRealtimeEvent('participant.removed', () => {
    router.push('/sala');
  });

  /* --- ações do aluno ----------------------------------------------------- */

  const submit = useCallback(
    (answer: AnswerPayload) => {
      setSubmitting(true);
      startTransition(async () => {
        const result = await submitAnswerAction(match.id, phase.id, answer);
        setSubmission(result);
        setSubmitting(false);

        if (match.mode === 'self-paced') {
          // Sem turma para esperar: vai direto para o feedback.
          setScreen('individual');
        } else {
          setScreen('waiting');
        }
      });
    },
    [match.id, match.mode, phase.id],
  );

  function openComparison() {
    startTransition(async () => {
      setComparison(await loadPhaseComparisonAction(match.id, phase.id));
      setScreen('collective');
    });
  }

  function markReady() {
    setReadyMarked(true);
    startTransition(() => void markReadyAction(match.id, phase.id));
  }

  function openPodium() {
    startTransition(async () => {
      setPodium(await loadPodiumAction(match.id));
      setScreen('podium');
    });
  }

  /* --- ações do líder ----------------------------------------------------- */

  const leaderControls: LeaderControls | null = isLeader
    ? {
        onRestartPhase: () => startTransition(() => void restartPhaseAction(match.id, phase.id)),
        onBackToLobby: () => startTransition(() => void returnToLobbyAction(match.id)),
        onFinishMatch: () => startTransition(() => void finishMatchAction(match.id)),
      }
    : null;

  /* --- telas de tela cheia ------------------------------------------------ */

  if (screen === 'podium') {
    return (
      <PodiumScreen
        entries={podium}
        onViewReport={() => router.push(`/sala/${roomCode}/relatorio`)}
        onContinue={() => router.push(`/sala/${roomCode}/lobby`)}
      />
    );
  }

  if (screen === 'collective' && comparison) {
    return (
      <CollectiveFeedbackScreen
        comparison={comparison}
        isLastPhase={isLastPhase}
        waitsForLeader={match.mode === 'live'}
        readyMarked={readyMarked}
        onMarkReady={markReady}
        onNextPhase={() => startTransition(() => void advancePhaseAction(match.id, 'next'))}
        onViewPodium={openPodium}
      />
    );
  }

  if (screen === 'individual' && submission) {
    return (
      <IndividualFeedbackScreen
        phase={phase}
        submission={submission}
        totalScore={scoreboard?.myScore ?? 0}
        onContinue={openComparison}
      />
    );
  }

  if (screen === 'waiting') {
    return (
      <WaitingScreen
        submittedCount={phaseState.submittedCount}
        totalPlayers={phaseState.totalPlayers}
        secondsLeft={secondsLeft}
        paused={paused}
      />
    );
  }

  /* --- tela do desafio ---------------------------------------------------- */

  return (
    <div className={styles.screen}>
      {connection !== 'open' && (
        <p className={styles.connectionBanner}>
          {connection === 'closed'
            ? 'Sem conexão em tempo real — os números podem estar desatualizados.'
            : 'Reconectando…'}
        </p>
      )}

      <ChallengeTopBar
        phase={phase}
        phaseNumber={phaseState.phaseNumber}
        totalPhases={phaseState.totalPhases}
        secondsLeft={secondsLeft}
        paused={paused}
        submittedCount={phaseState.submittedCount}
        totalPlayers={phaseState.totalPlayers}
        scoreboard={isLeader ? null : scoreboard}
        leaderControls={leaderControls}
      />

      {isLeader ? (
        <LeaderDashboard
          phase={phase}
          stats={stats}
          matchMode={match.mode}
          paused={paused}
          isFirstPhase={phaseState.phaseNumber <= 1}
          onTogglePause={() => startTransition(() => void setPausedAction(match.id, !paused))}
          onAdvance={(direction) =>
            startTransition(() => void advancePhaseAction(match.id, direction))
          }
          onRemovePlayer={(participantId) =>
            startTransition(() => void removePlayerFromMatchAction(match.id, participantId))
          }
        />
      ) : (
        <PlayerStage
          phase={phase}
          disabled={paused || submitting || matchStatus === 'finished'}
          onSubmit={submit}
          matchId={match.id}
        />
      )}
    </div>
  );
}

/** Área do aluno: escolhe o componente do tipo da fase e o coloca na coluna. */
function PlayerStage({
  phase,
  disabled,
  onSubmit,
  matchId,
}: {
  phase: Phase;
  disabled: boolean;
  onSubmit: (answer: AnswerPayload) => void;
  matchId: string;
}) {
  const { Player } = challengeModuleFor(phase);

  return (
    <div className={styles.playerStage}>
      <Player phase={phase} disabled={disabled} onSubmit={onSubmit} matchId={matchId} />
    </div>
  );
}
