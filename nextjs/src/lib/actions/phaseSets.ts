'use server';

import { revalidateTag } from 'next/cache';

import {
  getMockCommunityPhaseDraft,
  searchMockCommunityPhases,
} from '@/components/set-library/mockLibrary';
import { ApiNotConfiguredError, apiRequest } from '@/lib/api/client';
import type {
  CommunityPhaseCatalog,
  CommunityPhaseSearchParams,
  DraftPhase,
  PhaseSetDraft,
  PhaseSetLibraryEntry,
  PhaseSetSummary,
} from '@/lib/types';

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

/* -------------------------------------------------------------------------- */
/* Catálogo de fases avulsas da comunidade                                     */
/* -------------------------------------------------------------------------- */

/**
 * `GET /community/phases?q=&subject=&kind=&sort=&limit=&cursor=`
 * Busca paginada de desafios avulsos publicados na comunidade para o modal do editor.
 */
export async function searchCommunityPhasesAction(
  params: CommunityPhaseSearchParams = {},
): Promise<CommunityPhaseCatalog> {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set('q', params.q.trim());
  if (params.subject?.trim()) query.set('subject', params.subject.trim());
  if (params.kind) query.set('kind', params.kind);
  if (params.sort) query.set('sort', params.sort);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.cursor !== undefined) query.set('cursor', String(params.cursor));

  const qs = query.toString();
  try {
    return await apiRequest<CommunityPhaseCatalog>(`/community/phases${qs ? `?${qs}` : ''}`);
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return searchMockCommunityPhases(params);
    }
    throw error;
  }
}

/**
 * `GET /community/phases/{phaseId}`
 * Retorna o detalhe completo de um desafio da comunidade no formato `DraftPhase`
 * (com `originCommunityPhaseId = phaseId`) para importação isolada no editor.
 */
export async function getCommunityPhaseDraftAction(phaseId: string): Promise<DraftPhase> {
  if (phaseId.startsWith('cp_')) {
    const mock = getMockCommunityPhaseDraft(phaseId);
    if (mock) return mock;
  }

  try {
    return await apiRequest<DraftPhase>(`/community/phases/${phaseId}`);
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      const mock = getMockCommunityPhaseDraft(phaseId);
      if (mock) return mock;
    }
    throw error;
  }
}
