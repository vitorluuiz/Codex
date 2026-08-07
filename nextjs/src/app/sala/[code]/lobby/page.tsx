import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { StateMessage } from '@/components/feedback/StateMessage';
import { LobbyView } from '@/components/lobby/LobbyView';
import { ApiNotConfiguredError } from '@/lib/api/client';
import {
  getApprovedParticipants,
  getPendingParticipants,
  getRoom,
  getRoomQueue,
  type RoomQueue,
} from '@/lib/api/rooms';
import { getSession } from '@/lib/api/session';
import type { Participant } from '@/lib/types';

export const metadata: Metadata = { title: 'Lobby da sala' };

/** A sala muda a cada segundo — nada aqui pode ser cacheado. */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ code: string }>;
}

/**
 * Server Component: busca o estado inicial completo do lobby e entrega ao
 * cliente, que a partir daí só recebe deltas pelo WebSocket. Isso evita o
 * "flash de tela vazia" que um lobby só-client teria.
 */
export default async function LobbyPage({ params }: PageProps) {
  const { code } = await params;
  const session = await getSession();

  let room;
  try {
    room = await getRoom(code);
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return (
        <StateMessage variant="centered" title="Sala indisponível" hint="API_BASE_URL / GET /rooms/{code}">
          O front está pronto, mas a API que guarda as salas ainda não foi configurada. Veja
          `docs/api-first-contract.md` para os contratos esperados.
        </StateMessage>
      );
    }
    throw error;
  }

  if (!room) {
    // `GET /rooms/{code}` responde 404 tanto para "esta sala não existe" quanto
    // para "você não é membro dela" — de propósito: o código de 6 dígitos é a
    // credencial da sala e a API não confirma a estranhos que ele existe.
    //
    // Quem tem na sessão um participante **desta** sala já teve o código, então
    // aqui os dois casos são distinguíveis, e o que sobra é "você não está mais
    // nela": ou o líder removeu (a linha do participante some) ou a sala
    // expirou. A tela de entrar é o destino certo dos dois; o 404 genérico
    // deixaria a pessoa achando que digitou errado um código que ela nem
    // digitou.
    if (session.participantId !== null && session.roomCode === code) {
      redirect('/sala?saida=removido');
    }
    notFound();
  }

  const isLeader = Boolean(session.user && session.user.id === room.leader.id);

  // Só o líder enxerga solicitações pendentes e a fila de fases.
  const [approved, pending, queue] = await Promise.all([
    getApprovedParticipants(code),
    isLeader ? getPendingParticipants(code) : Promise.resolve<Participant[]>([]),
    isLeader ? getRoomQueue(code) : Promise.resolve<RoomQueue>({ sets: [], phases: [] }),
  ]);

  // Deduzido da lista de aprovados em vez de pedido à API: quem foi recusado nem
  // chega aqui (`GET /rooms/{code}` responde 404 para ele) e remover apaga a
  // linha, então "é participante desta sala e não está entre os aprovados"
  // significa exatamente "ainda aguarda o líder".
  const awaitingApproval =
    !isLeader &&
    session.participantId !== null &&
    !approved.some((participant) => participant.id === session.participantId);

  return (
    <LobbyView
      room={room}
      isLeader={isLeader}
      viewerParticipantId={session.participantId}
      awaitingApproval={awaitingApproval}
      initialApproved={approved}
      initialPending={pending}
      initialQueue={queue}
    />
  );
}
