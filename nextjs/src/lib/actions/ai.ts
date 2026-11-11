'use server';

import { ApiError, ApiNotConfiguredError, apiRequest, apiRequestOrNull } from '@/lib/api/client';
import type {
  AiDecision,
  AiPhaseRequest,
  AiPhaseResult,
  AiQuizOptionsResult,
  AiUsage,
  AiVariationOptions,
  AiVariationsResult,
  DraftPhase,
  QuizSuggestionMode,
} from '@/lib/types';

export type AiActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; usage?: AiUsage };

function toActionError<T>(error: unknown): AiActionResult<T> {
  if (error instanceof ApiError) {
    return {
      ok: false,
      code: error.code ?? 'AI_PROVIDER_UNAVAILABLE',
      message: error.message,
      usage: error.usage,
    };
  }

  if (error instanceof ApiNotConfiguredError) {
    return {
      ok: false,
      code: 'AI_NOT_CONFIGURED',
      message: 'A geração por IA não está configurada neste ambiente.',
    };
  }

  return {
    ok: false,
    code: 'AI_PROVIDER_UNAVAILABLE',
    message: 'Não foi possível concluir a geração com IA. Tente novamente.',
  };
}

/** `GET /ai/usage` — consulta o consumo atual de créditos e sugestões. */
export async function getAiUsageAction(): Promise<AiUsage | null> {
  try {
    return await apiRequestOrNull<AiUsage>('/ai/usage');
  } catch {
    return null;
  }
}

/** `POST /ai/phases/generate` — gera 1 fase para revisão antes de entrar no conjunto. */
export async function generatePhaseAction(
  request: AiPhaseRequest,
): Promise<AiActionResult<AiPhaseResult>> {
  try {
    const data = await apiRequest<AiPhaseResult>('/ai/phases/generate', {
      method: 'POST',
      body: request,
    });
    return { ok: true, data };
  } catch (error) {
    return toActionError(error);
  }
}

/** `POST /ai/phases/variations` — gera 1 a 5 variações de uma fase existente. */
export async function generateVariationsAction(request: {
  source: DraftPhase;
  options: AiVariationOptions;
}): Promise<AiActionResult<AiVariationsResult>> {
  try {
    const data = await apiRequest<AiVariationsResult>('/ai/phases/variations', {
      method: 'POST',
      body: request,
    });
    return { ok: true, data };
  } catch (error) {
    return toActionError(error);
  }
}

/** `POST /ai/quiz/options/suggest` — sugere novas alternativas para uma fase quiz. */
export async function suggestQuizOptionsAction(request: {
  question: string;
  options: string[];
  correctIndexes: number[];
  count: number;
  mode: QuizSuggestionMode;
}): Promise<AiActionResult<AiQuizOptionsResult>> {
  try {
    const data = await apiRequest<AiQuizOptionsResult>('/ai/quiz/options/suggest', {
      method: 'POST',
      body: request,
    });
    return { ok: true, data };
  } catch (error) {
    return toActionError(error);
  }
}

/** `POST /ai/generations/{generationId}/decision` — registra se o autor aceitou ou descartou. */
export async function decideGenerationAction(
  generationId: string,
  decision: AiDecision,
  acceptedCount?: number,
): Promise<void> {
  try {
    await apiRequest(`/ai/generations/${generationId}/decision`, {
      method: 'POST',
      body: { decision, acceptedCount },
    });
  } catch {
    /* telemetria best-effort: não interrompe o fluxo do editor */
  }
}
