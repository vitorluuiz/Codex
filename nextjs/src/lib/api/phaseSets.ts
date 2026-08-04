import 'server-only';

import { apiRequestOrNull } from './client';
import type { PhaseSetDraft } from '@/lib/types';

/**
 * `GET /phase-sets/{setId}/draft` — conjunto na forma que o editor manipula.
 *
 * É uma rota separada de `GET /phase-sets/{setId}` (usada pela sala) porque só
 * o autor pode ver gabaritos, casos de teste e resposta esperada.
 */
export function getPhaseSetDraft(setId: string) {
  return apiRequestOrNull<PhaseSetDraft>(`/phase-sets/${setId}/draft`);
}
