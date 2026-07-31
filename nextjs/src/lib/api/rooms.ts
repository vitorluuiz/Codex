import 'server-only';

import { apiRequest, apiRequestOrNull } from './client';
import type { Participant, PhaseSetSummary, Room } from '@/lib/types';

/** `GET /rooms/{code}` */
export function getRoom(code: string) {
  return apiRequestOrNull<Room>(`/rooms/${code}`);
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
