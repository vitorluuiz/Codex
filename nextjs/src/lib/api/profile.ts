import 'server-only';

import { apiRequestOrNull } from './client';
import type { LeaderProfile } from '@/lib/types';

/**
 * `GET /users/{id}/profile` — perfil público de liderança.
 *
 * `userId` ausente significa "o meu": a API resolve pela sessão. São a mesma
 * rota porque o servidor decide o que é público (conjuntos e histórico visíveis)
 * sem o front precisar saber quem está olhando.
 */
export function getLeaderProfile(userId?: string) {
  return apiRequestOrNull<LeaderProfile>(`/users/${userId ?? 'me'}/profile`);
}
