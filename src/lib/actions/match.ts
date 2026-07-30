'use server';

import { apiRequest } from '@/lib/api/client';
import type {
  AnswerPayload,
  CodeRunResult,
  PhaseComparison,
  PodiumEntry,
  Submission,
} from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* Leituras sob demanda (disparadas pela UI, não no render)                     */
/* -------------------------------------------------------------------------- */

/** `GET /matches/{matchId}/phases/{phaseId}/comparison` */
export async function loadPhaseComparisonAction(
  matchId: string,
  phaseId: string,
): Promise<PhaseComparison> {
  return apiRequest<PhaseComparison>(`/matches/${matchId}/phases/${phaseId}/comparison`);
}

/** `GET /matches/{matchId}/podium` */
export async function loadPodiumAction(matchId: string): Promise<PodiumEntry[]> {
  return apiRequest<PodiumEntry[]>(`/matches/${matchId}/podium`);
}

/* -------------------------------------------------------------------------- */
/* Aluno                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `POST /matches/{matchId}/phases/{phaseId}/submissions`
 *
 * A correção é do servidor: a UI nunca sabe a resposta certa antes de enviar.
 * Para `quiz`/`fill` a resposta volta já corrigida; para `text`/`code` volta com
 * `grading: 'pending'` e o resultado chega depois pelo WebSocket
 * (`submission.graded`).
 */
export async function submitAnswerAction(
  matchId: string,
  phaseId: string,
  answer: AnswerPayload,
): Promise<Submission> {
  return apiRequest<Submission>(`/matches/${matchId}/phases/${phaseId}/submissions`, {
    method: 'POST',
    body: { answer },
  });
}

/** `POST /matches/{matchId}/phases/{phaseId}/run` — execução de teste, não conta como envio. */
export async function runCodeAction(
  matchId: string,
  phaseId: string,
  languageId: string,
  source: string,
): Promise<CodeRunResult> {
  return apiRequest<CodeRunResult>(`/matches/${matchId}/phases/${phaseId}/run`, {
    method: 'POST',
    body: { languageId, source },
  });
}

/** `POST /matches/{matchId}/phases/{phaseId}/ready` — modo ao vivo. */
export async function markReadyAction(matchId: string, phaseId: string) {
  await apiRequest(`/matches/${matchId}/phases/${phaseId}/ready`, { method: 'POST' });
}

/* -------------------------------------------------------------------------- */
/* Líder                                                                       */
/* -------------------------------------------------------------------------- */

/** `POST /matches/{matchId}/advance` */
export async function advancePhaseAction(matchId: string, direction: 'next' | 'previous') {
  await apiRequest(`/matches/${matchId}/advance`, { method: 'POST', body: { direction } });
}

/** `POST /matches/{matchId}/pause` */
export async function setPausedAction(matchId: string, paused: boolean) {
  await apiRequest(`/matches/${matchId}/pause`, { method: 'POST', body: { paused } });
}

/** `POST /matches/{matchId}/phases/{phaseId}/restart` */
export async function restartPhaseAction(matchId: string, phaseId: string) {
  await apiRequest(`/matches/${matchId}/phases/${phaseId}/restart`, { method: 'POST' });
}

/** `POST /matches/{matchId}/finish` */
export async function finishMatchAction(matchId: string) {
  await apiRequest(`/matches/${matchId}/finish`, { method: 'POST' });
}

/** `POST /matches/{matchId}/return-to-lobby` */
export async function returnToLobbyAction(matchId: string) {
  await apiRequest(`/matches/${matchId}/return-to-lobby`, { method: 'POST' });
}

/** `DELETE /matches/{matchId}/participants/{participantId}` */
export async function removePlayerFromMatchAction(matchId: string, participantId: string) {
  await apiRequest(`/matches/${matchId}/participants/${participantId}`, { method: 'DELETE' });
}
