import 'server-only';

import { ApiError, apiRequest, apiRequestOrNull } from './client';
import type { ActiveRoom, Participant, PhaseSetSummary, Room } from '@/lib/types';

/** `GET /rooms/{code}` */
export function getRoom(code: string) {
  return apiRequestOrNull<Room>(`/rooms/${code}`);
}

/**
 * `GET /rooms/active` — salas de pé das quais quem chamou faz parte.
 *
 * Resolvida pela sessão, não por um id no caminho: o código de 6 dígitos é a
 * única credencial da sala, então ele não pode sair num perfil que qualquer um
 * abre. Sem sessão a API responde `[]` (200), que é o caso normal da tela de
 * entrar.
 *
 * **Falha vira lista vazia, e não exceção**, ao contrário do resto deste
 * módulo. É a única chamada das duas telas que a usa (`/sala` e `/perfil`) que
 * não carrega o conteúdo principal delas: um erro aqui deve sumir com o cartão
 * "Voltar para a sala", não derrubar a tela de entrar — que é exatamente o
 * acidente registrado em `api-implementation-status.md` §2 (rota ausente
 * quebrando render em vez de degradar).
 */
export async function getActiveRooms(): Promise<ActiveRoom[]> {
  try {
    return (await apiRequestOrNull<ActiveRoom[]>('/rooms/active')) ?? [];
  } catch (error) {
    if (error instanceof ApiError) return [];
    throw error;
  }
}

/** `GET /rooms/{code}/participants?status=approved` */
export function getApprovedParticipants(code: string) {
  return apiRequest<Participant[]>(`/rooms/${code}/participants?status=approved`);
}

/** `GET /rooms/{code}/participants?status=pending` */
export function getPendingParticipants(code: string) {
  return apiRequest<Participant[]>(`/rooms/${code}/participants?status=pending`);
}

/**
 * `GET /rooms/{code}/queue`
 * Fila de fases já montada pelo líder, com os conjuntos que a originaram.
 */
export interface RoomQueue {
  sets: { setId: string; title: string; color: string; phaseCount: number }[];
  phases: {
    id: string;
    setId: string;
    name: string;
    kind: string;
    basePoints: number;
    pointsMultiplier: number;
    timeSeconds: number;
  }[];
}

export function getRoomQueue(code: string) {
  return apiRequest<RoomQueue>(`/rooms/${code}/queue`);
}

/** `GET /phase-sets?scope=owned|community&q=` */
export function listPhaseSets(scope: 'owned' | 'community', query = '') {
  const params = new URLSearchParams({ scope });
  if (query) params.set('q', query);
  return apiRequest<PhaseSetSummary[]>(`/phase-sets?${params.toString()}`);
}
