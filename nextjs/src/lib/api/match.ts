import 'server-only';

import { apiRequest } from './client';
import type {
  Match,
  PhaseComparison,
  PhaseState,
  PhaseStats,
  PlayerScoreboard,
  PodiumEntry,
} from '@/lib/types';

/** `GET /rooms/{code}/match` — partida corrente da sala. */
export function getMatch(code: string) {
  return apiRequest<Match>(`/rooms/${code}/match`);
}

/**
 * `GET /matches/{matchId}/current-phase`
 * Estado da fase em andamento para quem está pedindo. O servidor omite
 * `correctOptionId` / `correctWords` enquanto a fase não termina.
 */
export function getCurrentPhase(matchId: string) {
  return apiRequest<PhaseState>(`/matches/${matchId}/current-phase`);
}

/** `GET /matches/{matchId}/phases/{phaseId}/stats` — só para o líder. */
export function getPhaseStats(matchId: string, phaseId: string) {
  return apiRequest<PhaseStats>(`/matches/${matchId}/phases/${phaseId}/stats`);
}

/** `GET /matches/{matchId}/scoreboard/me` */
export function getMyScoreboard(matchId: string) {
  return apiRequest<PlayerScoreboard>(`/matches/${matchId}/scoreboard/me`);
}

/** `GET /matches/{matchId}/phases/{phaseId}/comparison` */
export function getPhaseComparison(matchId: string, phaseId: string) {
  return apiRequest<PhaseComparison>(`/matches/${matchId}/phases/${phaseId}/comparison`);
}

/** `GET /matches/{matchId}/podium` */
export function getPodium(matchId: string) {
  return apiRequest<PodiumEntry[]>(`/matches/${matchId}/podium`);
}
