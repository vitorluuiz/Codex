import type { ActiveRoom } from '@/lib/types';

/**
 * Vocabulário compartilhado entre os dois lugares que oferecem "Voltar para a
 * sala": o cartão da tela de entrar e a lista do histórico do perfil. Fica num
 * módulo só porque as duas telas nomeiam o mesmo estado — se divergissem, a
 * mesma sala apareceria como "Lobby" num lugar e "Aguardando" no outro.
 */

export const ROOM_STATUS_LABEL: Record<ActiveRoom['status'], string> = {
  lobby: 'No lobby',
  running: 'Em andamento',
  // `GET /rooms/active` não lista sala encerrada; o rótulo existe para o tipo
  // ficar exaustivo e não virar `undefined` se um dia listar.
  finished: 'Encerrada',
};

/**
 * A segunda linha do cartão: o que era esta sala.
 *
 * Para o líder é a fila (`setTitle` e `phaseCount` só vêm para ele — é rota de
 * líder). Para o participante é quem conduz, que é o mesmo nome que ele já lê no
 * lobby em "Aguardando … iniciar a partida".
 */
export function describeActiveRoom(room: ActiveRoom): string {
  if (room.role !== 'leader') return `Sala de ${room.leaderName}`;

  const phases = room.phaseCount ?? 0;
  const queue = phases === 1 ? '1 fase' : `${phases} fases`;
  return room.setTitle ? `${room.setTitle} · ${queue}` : queue;
}
