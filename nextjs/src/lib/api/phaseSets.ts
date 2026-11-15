import 'server-only';

import { apiRequestOrNull } from './client';
import type { PhaseLimits, PhaseSetDetail, PhaseSetDraft } from '@/lib/types';

export const DEFAULT_PHASE_LIMITS: PhaseLimits = {
  maxQuestionLength: 4000,
  maxOptionLength: 300,
  maxExpectedAnswerLength: 2000,
  maxStarterCodeLength: 4096,
  maxTestCasesLength: 4096,
};

/**
 * `GET /phase-sets/{setId}` — detalhe completo de um conjunto privado ou público
 * da comunidade para a tela de visualização.
 */
export function getPhaseSetDetail(setId: string) {
  return apiRequestOrNull<PhaseSetDetail>(`/phase-sets/${setId}`);
}

/**
 * `GET /phase-sets/{setId}/draft` — conjunto na forma que o editor manipula.
 *
 * É uma rota separada de `GET /phase-sets/{setId}` (usada pela sala) porque só
 * o autor pode ver gabaritos, casos de teste e resposta esperada.
 */
export function getPhaseSetDraft(setId: string) {
  return apiRequestOrNull<PhaseSetDraft>(`/phase-sets/${setId}/draft`);
}

/**
 * `GET /phase-sets/limits` — limites de tamanho de campos para exibição e validação.
 */
export async function getPhaseLimits(): Promise<PhaseLimits> {
  const limits = await apiRequestOrNull<PhaseLimits>('/phase-sets/limits');
  return limits ?? DEFAULT_PHASE_LIMITS;
}