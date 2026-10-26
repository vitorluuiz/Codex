import 'server-only';

import { apiRequestOrNull } from './client';
import type { AiUsage } from '@/lib/types';

/**
 * `GET /ai/usage` — busca a cota inicial de IA ao abrir o editor de conjuntos.
 * Degrada para `null` quando a API ou a IA não estiver configurada.
 */
export async function getAiUsage(): Promise<AiUsage | null> {
  try {
    return await apiRequestOrNull<AiUsage>('/ai/usage');
  } catch {
    return null;
  }
}
