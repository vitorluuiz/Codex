import 'server-only';

import { apiRequestOrNull } from './client';
import type {
  CommunityPhaseSetSearch,
  CommunityPhaseSetSearchParams,
  OwnedPhaseSetList,
} from '@/lib/types';

/**
 * `GET /phase-sets/owned` — conjuntos privados da pessoa e os metadados do
 * workspace (disciplinas, pastas e capa) para a aba "Meus conjuntos".
 *
 * É rota separada de `GET /phase-sets` (o seletor do lobby) porque aquela abre
 * no meio de uma aula e não pode esperar as agregações de acerto médio e
 * duração que só o card da biblioteca lê.
 */
export function getOwnedPhaseSets() {
  return apiRequestOrNull<OwnedPhaseSetList>('/phase-sets/owned', {
    tags: ['phase-sets:owned'],
  });
}

/**
 * `GET /phase-sets/community` — busca conjuntos publicados na comunidade
 * (versão mais recente de cada um, inclusive os publicados pela própria pessoa).
 */
export function searchCommunityPhaseSets(params: CommunityPhaseSetSearchParams = {}) {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set('q', params.q.trim());
  if (params.subject) query.set('subject', params.subject);
  if (params.kind) query.set('kind', params.kind);
  if (params.sort) query.set('sort', params.sort);

  const qs = query.toString();
  return apiRequestOrNull<CommunityPhaseSetSearch>(
    `/phase-sets/community${qs ? `?${qs}` : ''}`,
    { tags: ['phase-sets:community'] },
  );
}
