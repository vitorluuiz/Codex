'use server';

import { revalidateTag } from 'next/cache';

import { apiRequest } from '@/lib/api/client';
import type { Room, User } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* Dados da conta                                                              */
/* -------------------------------------------------------------------------- */

/** `PATCH /users/me` */
export async function updateProfileAction(
  patch: Partial<Pick<User, 'name' | 'email' | 'avatarIndex'>>,
): Promise<User> {
  const user = await apiRequest<User>('/users/me', { method: 'PATCH', body: patch });
  revalidateTag('user:me');
  return user;
}

/* -------------------------------------------------------------------------- */
/* Criação de sala a partir do perfil                                          */
/* -------------------------------------------------------------------------- */

/**
 * `POST /rooms` — abre uma sala nova e devolve o código.
 *
 * `setId` é opcional: quando o líder clica em "Iniciar" no card de um conjunto,
 * a sala já nasce com aquele conjunto na fila. Deixar o servidor fazer isso numa
 * chamada só evita o lobby aparecer vazio por um instante antes da fila chegar.
 */
export async function createRoomAction(setId?: string): Promise<string> {
  const room = await apiRequest<Pick<Room, 'code'>>('/rooms', {
    method: 'POST',
    body: setId ? { setId } : {},
  });
  return room.code;
}

/* -------------------------------------------------------------------------- */
/* Relatórios                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `POST /matches/{matchId}/report/export` — dispara a exportação.
 *
 * A resposta é `202` com um `jobId`: montar o PDF de uma turma grande estoura o
 * timeout de request, então a UI só confirma que o download foi enfileirado.
 */
export async function exportMatchReportAction(
  matchId: string,
  format: 'pdf' | 'xlsx' = 'pdf',
): Promise<string> {
  const job = await apiRequest<{ jobId: string }>(`/matches/${matchId}/report/export`, {
    method: 'POST',
    body: { format },
  });
  return job.jobId;
}
