'use server';

import { cookies } from 'next/headers';
import { revalidateTag } from 'next/cache';

import { ApiError, ApiNotConfiguredError, apiRequest } from '@/lib/api/client';
import { SESSION_COOKIE } from '@/lib/cookies';
import type { RoomQueue } from '@/lib/api/rooms';
import type {
  AvatarIndex,
  JoinRejectionReason,
  Participant,
  PhaseSetSummary,
  Room,
} from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* Entrada na sala                                                             */
/* -------------------------------------------------------------------------- */

export type CheckCodeResult =
  | { ok: true; room: Pick<Room, 'code' | 'capacity' | 'requireAccount'> }
  | { ok: false; reason: JoinRejectionReason; message?: string };

function toFailure(error: unknown): { ok: false; reason: JoinRejectionReason; message?: string } {
  if (error instanceof ApiNotConfiguredError) return { ok: false, reason: 'network' };
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'ROOM_NOT_FOUND':
        return { ok: false, reason: 'not_found' };
      case 'ROOM_LOCKED':
        return { ok: false, reason: 'locked' };
      case 'ACCOUNT_REQUIRED':
        return { ok: false, reason: 'account_required' };
      case 'ROOM_FULL':
        return { ok: false, reason: 'full' };
      case 'USERNAME_TAKEN':
        return { ok: false, reason: 'username_taken' };
      case 'RATE_LIMITED':
        return { ok: false, reason: 'rate_limited' };
      case 'VALIDATION_ERROR':
        return { ok: false, reason: 'validation', message: error.message };
      default:
        if (error.status === 404) return { ok: false, reason: 'not_found' };
        if (error.status === 429) return { ok: false, reason: 'rate_limited' };
        if (error.status === 400) {
          return { ok: false, reason: 'validation', message: error.message };
        }
        return { ok: false, reason: 'network' };
    }
  }
  return { ok: false, reason: 'network' };
}

/**
 * `GET /rooms/{code}/availability`
 * Valida o código antes de pedir nome e avatar, para o erro aparecer no passo certo.
 */
export async function checkRoomCodeAction(code: string): Promise<CheckCodeResult> {
  const cleanCode = code.replace(/\D/g, '').slice(0, 6);
  if (cleanCode.length !== 6) {
    return {
      ok: false,
      reason: 'validation',
      message: 'Digite os 6 dígitos do código da sala.',
    };
  }

  try {
    const room = await apiRequest<Pick<Room, 'code' | 'capacity' | 'requireAccount'>>(
      `/rooms/${cleanCode}/availability`,
    );
    return { ok: true, room };
  } catch (error) {
    return toFailure(error);
  }
}

export type JoinResult =
  | { ok: true; participant: Participant }
  | { ok: false; reason: JoinRejectionReason; message?: string };

/** `POST /rooms/{code}/participants` */
export async function joinRoomAction(
  code: string,
  displayName: string,
  avatarIndex: AvatarIndex,
): Promise<JoinResult> {
  const cleanCode = code.replace(/\D/g, '').slice(0, 6);
  const trimmedName = displayName.trim();

  if (cleanCode.length !== 6) {
    return {
      ok: false,
      reason: 'validation',
      message: 'O código da sala precisa ter 6 dígitos.',
    };
  }
  if (!trimmedName || trimmedName.length > 80) {
    return {
      ok: false,
      reason: 'validation',
      message: 'O nome de usuário deve ter entre 1 e 80 caracteres.',
    };
  }

  try {
    const result = await apiRequest<{ participant: Participant; token: string; expiresIn: number }>(
      `/rooms/${cleanCode}/participants`,
      { method: 'POST', body: { displayName: trimmedName, avatarIndex } },
    );

    const store = await cookies();
    store.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: result.expiresIn,
    });

    return { ok: true, participant: result.participant };
  } catch (error) {
    return toFailure(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Controles do líder no lobby                                                 */
/* -------------------------------------------------------------------------- */

/** `PATCH /rooms/{code}` */
export async function updateRoomSettingsAction(
  code: string,
  patch: Partial<Pick<Room, 'locked' | 'requireAccount' | 'capacity'>>,
) {
  await apiRequest(`/rooms/${code}`, { method: 'PATCH', body: patch });
  revalidateTag(`room:${code}`);
}

/**
 * `DELETE /rooms/{code}` — encerra a sala inteira sem o líder precisar entrar
 * nela. Usado pelo botão "Encerrar sala" do histórico do perfil.
 */
export async function closeRoomAction(code: string) {
  await apiRequest(`/rooms/${code}`, { method: 'DELETE' });
  revalidateTag(`room:${code}`);
}

/** `POST /rooms/{code}/participants/{id}/approve` */
export async function approveParticipantAction(code: string, participantId: string) {
  await apiRequest(`/rooms/${code}/participants/${participantId}/approve`, { method: 'POST' });
  revalidateTag(`room:${code}:participants`);
}

/** `POST /rooms/{code}/participants/{id}/reject` */
export async function rejectParticipantAction(code: string, participantId: string) {
  await apiRequest(`/rooms/${code}/participants/${participantId}/reject`, { method: 'POST' });
  revalidateTag(`room:${code}:participants`);
}

/** `DELETE /rooms/{code}/participants/{id}` */
export async function removeParticipantAction(code: string, participantId: string) {
  await apiRequest(`/rooms/${code}/participants/${participantId}`, { method: 'DELETE' });
  revalidateTag(`room:${code}:participants`);
}

/* -------------------------------------------------------------------------- */
/* Fila de fases                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Todas as mutações da fila devolvem a fila inteira já recalculada pelo
 * servidor. É mais barato que refetch e mantém a UI e o banco na mesma verdade
 * (cores dos conjuntos, ordem e contagens são decididas no servidor).
 */

/** `GET /phase-sets?scope=&q=` */
export async function searchPhaseSetsAction(
  scope: 'owned' | 'community',
  query: string,
): Promise<PhaseSetSummary[]> {
  const params = new URLSearchParams({ scope });
  if (query) params.set('q', query);
  return apiRequest<PhaseSetSummary[]>(`/phase-sets?${params.toString()}`);
}

/** `POST /rooms/{code}/queue/sets` */
export async function addSetToQueueAction(code: string, setId: string): Promise<RoomQueue> {
  const queue = await apiRequest<RoomQueue>(`/rooms/${code}/queue/sets`, {
    method: 'POST',
    body: { setId },
  });
  revalidateTag(`room:${code}:queue`);
  return queue;
}

/** `DELETE /rooms/{code}/queue/sets/{setId}` */
export async function removeSetFromQueueAction(code: string, setId: string): Promise<RoomQueue> {
  const queue = await apiRequest<RoomQueue>(`/rooms/${code}/queue/sets/${setId}`, {
    method: 'DELETE',
  });
  revalidateTag(`room:${code}:queue`);
  return queue;
}

/** `PATCH /rooms/{code}/queue/sets/{setId}` — aplica valores a todas as fases do conjunto. */
export async function updateSetDefaultsAction(
  code: string,
  setId: string,
  patch: { basePoints: number; pointsMultiplier: number; timeSeconds: number },
): Promise<RoomQueue> {
  const queue = await apiRequest<RoomQueue>(`/rooms/${code}/queue/sets/${setId}`, {
    method: 'PATCH',
    body: patch,
  });
  revalidateTag(`room:${code}:queue`);
  return queue;
}

/** `PATCH /rooms/{code}/queue/phases/{phaseId}` */
export async function updateQueuedPhaseAction(
  code: string,
  phaseId: string,
  patch: Partial<{
    name: string;
    basePoints: number;
    pointsMultiplier: number;
    timeSeconds: number;
    expectedAnswer: string;
  }>,
): Promise<RoomQueue> {
  const queue = await apiRequest<RoomQueue>(`/rooms/${code}/queue/phases/${phaseId}`, {
    method: 'PATCH',
    body: patch,
  });
  revalidateTag(`room:${code}:queue`);
  return queue;
}

/** `DELETE /rooms/{code}/queue/phases/{phaseId}` */
export async function removeQueuedPhaseAction(code: string, phaseId: string): Promise<RoomQueue> {
  const queue = await apiRequest<RoomQueue>(`/rooms/${code}/queue/phases/${phaseId}`, {
    method: 'DELETE',
  });
  revalidateTag(`room:${code}:queue`);
  return queue;
}

/** `PUT /rooms/{code}/queue/order` */
export async function reorderQueueAction(code: string, phaseIds: string[]): Promise<RoomQueue> {
  const queue = await apiRequest<RoomQueue>(`/rooms/${code}/queue/order`, {
    method: 'PUT',
    body: { phaseIds },
  });
  revalidateTag(`room:${code}:queue`);
  return queue;
}

/** `GET /rooms/{code}/queue/phases/{phaseId}` — detalhe completo para o modal “Ver desafio”. */
export async function getQueuedPhaseDetailAction(code: string, phaseId: string) {
  return apiRequest<import('@/lib/types').Phase>(`/rooms/${code}/queue/phases/${phaseId}`);
}

/* -------------------------------------------------------------------------- */
/* Início da partida                                                           */
/* -------------------------------------------------------------------------- */

/** `POST /rooms/{code}/match` */
export async function startMatchAction(code: string, mode: 'live' | 'self-paced') {
  const match = await apiRequest<{ id: string }>(`/rooms/${code}/match`, {
    method: 'POST',
    body: { mode },
  });
  return match.id;
}
