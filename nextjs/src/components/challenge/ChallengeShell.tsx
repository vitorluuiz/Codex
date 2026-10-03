'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { RealtimeProvider, useRealtime, useRealtimeEvent } from '@/realtime/RealtimeProvider';
import { channels } from '@/realtime/protocol';
import { useServerCountdown } from '@/realtime/useServerCountdown';
import {
  advancePhaseAction,
  finishMatchAction,
  loadPhaseComparisonAction,
  loadPodiumAction,
  markReadyAction,
  refreshPhaseStateAction,
  removePlayerFromMatchAction,
  restartPhaseAction,
  returnToLobbyAction,
  returnToLobbyAsParticipantAction,
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
import { TimeUpScreen } from './screens/TimeUpScreen';
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
  /** Não-nulo quando a partida já terminou: a tela abre direto no pódio. */
  initialPodium: PodiumEntry[] | null;
}

export function ChallengeShell(props: ChallengeShellProps) {
  const list = [
    channels.room(props.roomCode),
    channels.match(props.roomCode),
  ];
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
  initialPodium,
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

  const [screen, setScreen] = useState<ChallengeScreen>(() => {
    // Partida encerrada abre no pódio — inclusive depois de um F5, que antes
    // redirecionava para o lobby e fazia o resultado sumir.
    if (initialPodium) return 'podium';
    return initialPhaseState.mySubmission ? 'waiting' : 'challenge';
  });
  const [submission, setSubmission] = useState<Submission | null>(initialPhaseState.mySubmission);
  const [comparison, setComparison] = useState<PhaseComparison | null>(null);
  const [podium, setPodium] = useState<PodiumEntry[]>(initialPodium ?? []);
  const [readyMarked, setReadyMarked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Se a fase corrente já fechou. É `ref`, e não `state`, porque quem precisa
   * consultá-lo é o `await` do envio, que rodaria com o valor capturado no clique —
   * e o fechamento acontece justamente *durante* esse `await` para quem envia por
   * último. Ver `submit`.
   */
  const phaseEndedRef = useRef(false);

  /** Se já cutucamos o servidor por causa do fim do cronômetro desta fase. Um por fase. */
  const timeUpPokedRef = useRef(false);

  /**
   * Se a pessoa já clicou em enviar nesta fase — a resposta pode ainda estar em
   * trânsito. Quem envia por último fecha a fase, e o `phase.ended` costuma chegar
   * *antes* da resposta do próprio envio: sem isto, quem respondeu no último segundo
   * veria "Tempo esgotado".
   */
  const answeringRef = useRef(false);

  /** Se o pódio já está em mãos. Um por partida — a página aberta com a partida já encerrada nasce com ele. */
  const podiumFetchedRef = useRef(initialPodium !== null);

  const paused = phaseState.paused;
  const secondsLeft = useServerCountdown(endsAt, paused);
  const phase = phaseState.phase;
  const isLastPhase = phaseState.phaseNumber >= phaseState.totalPhases;

  /**
   * Troca de tela. **O pódio é terminal**: uma vez nele, nada mais o tira — só a
   * navegação para o lobby.
   *
   * A guarda existe porque o fim da partida disputa com respostas HTTP ainda em voo.
   * Quem envia por último fecha a fase e encerra a partida: o servidor publica
   * `phase.ended` e `match.finished` *antes* de responder ao `POST`, então o pódio já
   * está na tela quando o `await` do envio retorna — e a continuação daquele envio,
   * que manda para o feedback individual, apagava o pódio recém-chegado. O sintoma era
   * a partida "nunca acabar" na tela, com o banco já dizendo `finished`.
   */
  const goTo = useCallback((next: ChallengeScreen | ((current: ChallengeScreen) => ChallengeScreen)) => {
    setScreen((current) => {
      if (current === 'podium') return current;
      return typeof next === 'function' ? next(current) : next;
    });
  }, []);

  /**
   * Busca o pódio e mostra. Chamado quando a última fase fecha.
   *
   * Duplica o que o evento `match.finished` já traz, e de propósito: **o fim da partida
   * não pode depender de uma mensagem de WebSocket chegar.** Quem fecha a última fase é
   * quem está com uma requisição HTTP em andamento — essa resposta chega mesmo com o
   * serviço de tempo real fora do ar, e é a única garantia que temos. O `ref` evita a
   * segunda busca quando o evento chega antes.
   */
  const showPodium = useCallback(() => {
    setScreen('podium');

    if (podiumFetchedRef.current) return;
    podiumFetchedRef.current = true;

    startTransition(async () => {
      try {
        setPodium(await loadPodiumAction(match.id));
        setMatchStatus('finished');
      } catch {
        podiumFetchedRef.current = false;
      }
    });
  }, [match.id]);

  /* --- eventos de tempo real --------------------------------------------- */

  useRealtimeEvent('phase.started', (message) => {
    setPhaseState(message.state);
    setEndsAt(message.endsAt);
    goTo('challenge');
    setSubmission(message.state.mySubmission);
    setComparison(null);
    setReadyMarked(false);
    setSubmitting(false);
    // Fase nova (ou reiniciada pelo líder) está aberta de novo.
    phaseEndedRef.current = false;
    timeUpPokedRef.current = false;
    answeringRef.current = false;
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
    setStats((current) =>
      current && current.phaseId === message.phaseId
        ? {
            ...current,
            submittedCount: message.submittedCount,
            totalPlayers: message.totalPlayers,
            readyCount: message.readyCount,
          }
        : current,
    );
  });

  /** A fase acabou: tira quem estava esperando e quem não chegou a responder. */
  const applyPhaseEnded = useCallback(() => {
    phaseEndedRef.current = true;

    goTo((current) => {
      if (current === 'waiting') return 'individual';
      // Ainda no desafio quando a fase fechou: não deu tempo de responder — a menos que
      // a resposta esteja em trânsito, porque quem envia por último recebe o
      // `phase.ended` que ele mesmo causou antes da resposta do próprio envio. O líder
      // fica onde está: a tela dele é o painel, não o desafio.
      if (current === 'challenge' && !isLeader && !answeringRef.current) return 'timeup';
      return current;
    });
  }, [isLeader, goTo]);

  // O servidor decide quando a fase termina (todos enviaram ou o tempo acabou).
  useRealtimeEvent('phase.ended', applyPhaseEnded);

  /**
   * Cronômetro zerado: cutuca a API.
   *
   * A fase fecha preguiçosamente — não há job nem timer no servidor —, então alguém
   * precisa aparecer depois do fim do relógio para que ela feche de fato e o
   * `phase.ended` seja publicado. Sem isto, uma fase em que ninguém respondeu ficava
   * aberta indefinidamente e a turma inteira parava.
   *
   * Todo cliente cutuca, e isso é de propósito: basta um navegador aberto para a
   * turma inteira destravar. Do lado do servidor a operação é idempotente (só o
   * primeiro fecha e publica), e aqui cada um só chama uma vez por fase.
   *
   * A resposta também é usada: se o WebSocket estiver fora do ar, o evento não chega,
   * mas o próprio retorno já confirma que o tempo acabou — e a tela anda mesmo assim.
   */
  useEffect(() => {
    if (secondsLeft !== 0 || paused || phaseEndedRef.current || timeUpPokedRef.current) return;
    if (matchStatus === 'finished') return;

    if (!isLeader && screen === 'challenge' && !answeringRef.current) {
      applyPhaseEnded();
    }

    timeUpPokedRef.current = true;
    startTransition(async () => {
      try {
        const state = await refreshPhaseStateAction(match.id);
        setPhaseState(state);

        // Só conclui pelo retorno se o servidor concordar que o tempo acabou — o
        // relógio local pode ter adiantado, ou o líder pode ter reiniciado a fase
        // entre o tique e a resposta.
        if (state.secondsLeft === 0 && !state.paused) {
          applyPhaseEnded();
        } else if (state.secondsLeft > 0 && !state.paused) {
          timeUpPokedRef.current = false;
        }
      } catch {
        // Falhou o cutucão: o líder ainda pode avançar a fase pela tela dele.
        timeUpPokedRef.current = false;
      }
    });
  }, [secondsLeft, paused, matchStatus, match.id, applyPhaseEnded, isLeader, screen]);

  useRealtimeEvent('submission.graded', (message) => {
    setSubmission(message.submission);
    if (message.submission.score != null) {
      const addedScore = message.submission.score;
      setScoreboard((current) =>
        current ? { ...current, myScore: current.myScore + addedScore } : current,
      );
    }
    goTo((current) => (current === 'waiting' ? 'individual' : current));
  });

  useRealtimeEvent('stats.updated', (message) => {
    setStats(message.stats);
    setScoreboard((current) =>
      current ? { ...current, avgScore: message.stats.teamAvgScore } : current,
    );
  });

  useRealtimeEvent('match.finished', (message) => {
    podiumFetchedRef.current = true;
    setPodium(message.podium);
    setMatchStatus('finished');
    setScreen('podium');
  });

  useRealtimeEvent('match.returned-to-lobby', () => {
    // Quem está no pódio decide sozinho quando sair dele ("Continuar jogando"): o
    // líder voltar ao lobby não volta por ninguém. Quem já está nos resultados da
    // partida terminada (individual ou coletivo) também tem direito de ver sua
    // pontuação e gabarito antes de sair. Nos outros casos o evento quer
    // dizer "o professor encerrou isto aqui antes da hora".
    if (screen !== 'podium' && matchStatus !== 'finished') {
      router.push(`/sala/${roomCode}/lobby`);
    }
  });

  useRealtimeEvent('participant.removed', () => {
    router.replace('/sala?saida=removido');
  });

  useRealtimeEvent('room.closed', () => {
    if (!isLeader) {
      router.replace('/sala?saida=encerrada');
    }
  });

  /* --- ações do aluno ----------------------------------------------------- */

  const submit = useCallback(
    (answer: AnswerPayload) => {
      setSubmitting(true);
      answeringRef.current = true;
      startTransition(async () => {
        try {
          const result = await submitAnswerAction(match.id, phase.id, answer);

          // O tempo acabou antes de o clique chegar ao servidor. Não é erro: a pessoa
          // segue para o feedback como quem não respondeu, em vez de ver uma tela de
          // exceção — e aí "não deu tempo" é mesmo a verdade sobre ela.
          if (result.status === 'phase-closed') {
            answeringRef.current = false;
            applyPhaseEnded();
            return;
          }

          if (result.submission.score != null) {
            const addedScore = result.submission.score;
            setScoreboard((current) =>
              current ? { ...current, myScore: current.myScore + addedScore } : current,
            );
          }

          setSubmission(result.submission);

          // Quem envia por último fecha a fase — e, se era a última da fila, encerra a
          // partida. O servidor publica `phase.ended` e `match.finished` *antes* de
          // responder a este POST. Como o match.finished preserva telas ativas de aluno,
          // navegar para individual ou waiting respeita o fluxo de feedback.
          if (match.mode === 'self-paced' || phaseEndedRef.current) {
            // Sem turma para esperar: vai direto para o feedback.
            goTo('individual');
          } else {
            goTo('waiting');
          }
        } finally {
          // Sem isto, uma falha no envio (a fase fechar entre abrir a tela e clicar,
          // por exemplo) deixaria o botão desabilitado para sempre.
          setSubmitting(false);
        }
      });
    },
    [match.id, match.mode, phase.id, applyPhaseEnded, goTo],
  );

  function openComparison() {
    startTransition(async () => {
      setComparison(await loadPhaseComparisonAction(match.id, phase.id));
      goTo('collective');
    });
  }

  function markReady() {
    setReadyMarked(true);
    startTransition(() => void markReadyAction(match.id, phase.id));
  }

  /**
   * Encerra a partida e mostra o pódio que a própria rota devolve. Compartilhado pelo
   * menu da barra superior e pelo botão da última fase no painel.
   */
  function finishMatch() {
    startTransition(async () => {
      podiumFetchedRef.current = true;
      setPodium(await finishMatchAction(match.id));
      setMatchStatus('finished');
      setScreen('podium');
    });
  }

  /**
   * "Continuar jogando" do pódio. Avisa o servidor **antes** de navegar — e a chamada é
   * diferente para cada lado, porque "voltar ao lobby" quer dizer coisas diferentes.
   *
   * O **participante** chama `me/return`, que tira a marca de "ainda nos resultados" e o
   * devolve à lista ativa do lobby — e, com ela, à contagem de jogadores da próxima
   * partida.
   *
   * O **líder** chama `return-to-lobby`, que devolve a *sala* ao lobby e destrava a fila.
   * Ele também tem esse botão na barra superior, mas a barra some quando o pódio ocupa a
   * tela inteira: com o encerramento automático, o pódio virou a saída normal da partida,
   * e este botão passou a ser o único caminho. Enquanto ele só navegava, a sala ficava
   * presa em `running` e a partida seguinte batia em `MATCH_ALREADY_STARTED`.
   */
  function backToLobby() {
    startTransition(async () => {
      await (isLeader ? returnToLobbyAction(match.id, roomCode) : returnToLobbyAsParticipantAction(roomCode));
      router.push(`/sala/${roomCode}/lobby`);
    });
  }

  /* --- ações do líder ----------------------------------------------------- */

  const leaderControls: LeaderControls | null = isLeader
    ? {
        onRestartPhase: () => startTransition(() => void restartPhaseAction(match.id, phase.id)),
        onBackToLobby: () => startTransition(() => void returnToLobbyAction(match.id, roomCode)),
        onFinishMatch: finishMatch,
      }
    : null;

  /* --- telas de tela cheia ------------------------------------------------ */

  if (screen === 'podium') {
    return (
      <PodiumScreen
        entries={podium}
        onViewReport={() => router.push(`/sala/${roomCode}/relatorio`)}
        onContinue={backToLobby}
      />
    );
  }

  if (screen === 'timeup') {
    return <TimeUpScreen onContinue={openComparison} />;
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
        onViewPodium={showPodium}
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
          isTimeUp={secondsLeft === 0 || phaseEndedRef.current}
          isFirstPhase={phaseState.phaseNumber <= 1}
          isLastPhase={isLastPhase}
          onTogglePause={() => startTransition(() => void setPausedAction(match.id, !paused))}
          onAdvance={(direction) =>
            startTransition(() => void advancePhaseAction(match.id, direction))
          }
          onFinish={finishMatch}
          onRemovePlayer={(participantId) =>
            startTransition(() => void removePlayerFromMatchAction(match.id, participantId))
          }
        />
      ) : (
        <PlayerStage
          phase={phase}
          disabled={connection !== 'open' || paused || submitting || matchStatus === 'finished' || secondsLeft === 0}
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
