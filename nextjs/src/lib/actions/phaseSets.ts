'use server';

import { revalidateTag } from 'next/cache';

import { apiRequest } from '@/lib/api/client';
import type { PhaseSetDraft, PhaseSetSummary } from '@/lib/types';

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
  const saved = draft.id
    ? await apiRequest<PhaseSetDraft>(`/phase-sets/${draft.id}/draft`, {
        method: 'PUT',
        body: { title: draft.title, phases: draft.phases },
      })
    : await apiRequest<PhaseSetDraft>('/phase-sets', {
        method: 'POST',
        body: { title: draft.title, phases: draft.phases },
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
