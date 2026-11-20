import 'server-only';

import { apiRequestOrNull } from './client';
import type { PlanIntent } from '@/lib/types';

interface PlanIntentEnvelope {
  intent: PlanIntent | null;
}

/**
 * `GET /billing/plan-intent` — consulta a resposta já registrada pelo usuário
 * na pesquisa provisória de planos. Degrada para `null` quando a API não
 * estiver configurada.
 */
export async function getPlanIntent(): Promise<PlanIntent | null> {
  try {
    const response = await apiRequestOrNull<PlanIntentEnvelope>('/billing/plan-intent');
    return response?.intent ?? null;
  } catch {
    return null;
  }
}
