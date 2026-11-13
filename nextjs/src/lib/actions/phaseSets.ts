'use server';

import { revalidateTag } from 'next/cache';

import { apiRequest } from '@/lib/api/client';
import type { PhaseSetDraft, PhaseSetLibraryEntry, PhaseSetSummary } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* CRUD de conjuntos                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `PUT /phase-sets/{setId}/draft` (ou `POST /phase-sets` quando `id` é `null`).
 *
 * O editor salva o conjunto inteiro de uma vez, não fase por fase. A ordem das
 * fases é a do array — não existe campo de posição para sair de sincronia com
 * o que o autor vê no rail.
 */
export async function savePhaseSetAction(draft: PhaseSetDraft): Promise<PhaseSetDraft> {
  const body = {
    title: draft.title,
    phases: draft.phases,
    ...(draft.subject !== undefined ? { subject: draft.subject } : {}),
    ...(draft.folder !== undefined ? { folder: draft.folder } : {}),
    ...(draft.coverUrl !== undefined ? { coverUrl: draft.coverUrl } : {}),
  };

  const saved = draft.id
    ? await apiRequest<PhaseSetDraft>(`/phase-sets/${draft.id}/draft`, {
        method: 'PUT',
        body,
      })
    : await apiRequest<PhaseSetDraft>('/phase-sets', {
        method: 'POST',
        body,
      });

  revalidateTag('phase-sets:owned');
  return saved;
}

/** `PATCH /phase-sets/{setId}` — só o título, usado pelo diálogo de renomear. */
export async function renamePhaseSetAction(
  setId: string,
  title: string,
): Promise<PhaseSetSummary> {
  const set = await apiRequest<PhaseSetSummary>(`/phase-sets/${setId}`, {
    method: 'PATCH',
    body: { title },
  });
  revalidateTag('phase-sets:owned');
  return set;
}

/** `DELETE /phase-sets/{setId}` */
export async function deletePhaseSetAction(setId: string): Promise<void> {
  await apiRequest(`/phase-sets/${setId}`, { method: 'DELETE' });
  revalidateTag('phase-sets:owned');
}

/** `POST /phase-sets/{setId}/publish` — publica versão imutável na comunidade. */
export async function publishPhaseSetAction(setId: string): Promise<PhaseSetLibraryEntry> {
  const published = await apiRequest<PhaseSetLibraryEntry>(`/phase-sets/${setId}/publish`, {
    method: 'POST',
  });
  revalidateTag('phase-sets:community');
  revalidateTag('phase-sets:owned');
  return published;
}

/** `POST /phase-sets/{setId}/copy` — copia conjunto para os conjuntos privados do usuário. */
export async function copyPhaseSetAction(setId: string): Promise<PhaseSetDraft> {
  const copy = await apiRequest<PhaseSetDraft>(`/phase-sets/${setId}/copy`, {
    method: 'POST',
  });
  revalidateTag('phase-sets:owned');
  return copy;
}
