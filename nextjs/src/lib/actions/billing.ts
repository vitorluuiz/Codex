'use server';

import { revalidatePath } from 'next/cache';

import { ApiError, ApiNotConfiguredError, apiRequest } from '@/lib/api/client';
import type { PlanIntent, SavePlanIntentInput } from '@/lib/types';

export type PlanIntentActionResult =
  | { ok: true; data: PlanIntent }
  | { ok: false; code: string; message: string };

/** `PUT /billing/plan-intent` — registra ou atualiza a intenção de contratação do usuário. */
export async function savePlanIntentAction(
  input: SavePlanIntentInput,
): Promise<PlanIntentActionResult> {
  try {
    const data = await apiRequest<PlanIntent>('/billing/plan-intent', {
      method: 'PUT',
      body: {
        selectedPlan: input.selectedPlan,
        pricePerception: input.pricePerception,
        subscriptionIntent: input.subscriptionIntent,
        expectedPriceBrl: input.expectedPriceBrl ?? null,
        comment: input.comment ?? null,
      },
    });

    revalidatePath('/configuracoes/pagamentos');
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        code: error.code ?? 'PLAN_INTENT_ERROR',
        message: error.message || 'Não foi possível salvar sua resposta.',
      };
    }

    if (error instanceof ApiNotConfiguredError) {
      return {
        ok: false,
        code: 'API_NOT_CONFIGURED',
        message: 'A API de backend não está configurada neste ambiente.',
      };
    }

    return {
      ok: false,
      code: 'PLAN_INTENT_UNAVAILABLE',
      message: 'Não foi possível registrar sua resposta agora. Tente novamente em instantes.',
    };
  }
}
