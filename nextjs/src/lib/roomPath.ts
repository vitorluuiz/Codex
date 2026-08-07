import type { RoomStatus } from '@/lib/types';

/**
 * Para onde "Voltar para a sala" leva.
 *
 * A sala pode estar em andamento quando alguém volta — mandar todo mundo para o
 * lobby faria o líder ter que achar sozinho o caminho da partida em curso. O
 * `finished` não chega aqui na prática (`GET /rooms/active` não lista sala
 * encerrada), mas se chegasse o lobby é o destino certo: é para lá que a tela de
 * partida também redireciona quando a partida acabou.
 */
export function roomPath(room: { code: string; status: RoomStatus }): string {
  return room.status === 'running' ? `/sala/${room.code}/partida` : `/sala/${room.code}/lobby`;
}
