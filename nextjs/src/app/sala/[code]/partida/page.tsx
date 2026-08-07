import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { ChallengeShell } from '@/components/challenge/ChallengeShell';
import { StateMessage } from '@/components/feedback/StateMessage';
import { ApiNotConfiguredError } from '@/lib/api/client';
import { getCurrentPhase, getMatch, getMyScoreboard, getPhaseStats, getPodium } from '@/lib/api/match';
import { getRoom } from '@/lib/api/rooms';
import { getSession } from '@/lib/api/session';
import type { PhaseStats, PlayerScoreboard } from '@/lib/types';

export const metadata: Metadata = { title: 'Desafio' };

/** A fase corrente muda a cada segundo — sem cache. */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ code: string }>;
}

/**
 * Server Component da tela de Desafios.
 *
 * Busca de uma vez tudo que a casca precisa para o primeiro render — sala,
 * partida, fase corrente e (conforme o papel) métricas ou placar — e entrega ao
 * `<ChallengeShell>`, que a partir daí vive de eventos do WebSocket.
 */
export default async function MatchPage({ params }: PageProps) {
  const { code } = await params;
  const session = await getSession();

  let room;
  try {
    room = await getRoom(code);
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return (
        <StateMessage
          variant="centered"
          title="Partida indisponível"
          hint="API_BASE_URL / GET /rooms/{code}/match"
        >
          A interface está pronta, mas a API da partida ainda não foi configurada. Os contratos
          esperados estão em `docs/api-first-contract.md`.
        </StateMessage>
      );
    }
    throw error;
  }

  // Mesma leitura do lobby: 404 com um participante desta sala na sessão é
  // "você não está mais nela", não "esta sala não existe".
  if (!room) {
    if (session.participantId !== null && session.roomCode === code) {
      redirect('/sala?saida=removido');
    }
    notFound();
  }

  const match = await getMatch(code);
  const isLeader = Boolean(session.user && session.user.id === room.leader.id);
  const phaseState = await getCurrentPhase(match.id);

  // Partida encerrada é o pódio, não um redirecionamento para o lobby: quem recarrega
  // a página no fim da partida quer ver o resultado de novo, e é dali que sai tanto o
  // "Continuar jogando" do aluno quanto a volta do líder ao lobby. Redirecionar aqui
  // fazia o pódio desaparecer no primeiro F5, para todo mundo.
  const podium = match.status === 'finished' ? await getPodium(match.id) : null;

  const [stats, scoreboard] = await Promise.all([
    isLeader
      ? getPhaseStats(match.id, phaseState.phase.id)
      : Promise.resolve<PhaseStats | null>(null),
    isLeader ? Promise.resolve<PlayerScoreboard | null>(null) : getMyScoreboard(match.id),
  ]);

  return (
    <ChallengeShell
      roomCode={code}
      match={match}
      isLeader={isLeader}
      participantId={session.participantId}
      initialPhaseState={phaseState}
      initialStats={stats}
      initialScoreboard={scoreboard}
      initialPodium={podium}
    />
  );
}
