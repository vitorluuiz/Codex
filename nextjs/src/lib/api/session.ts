import 'server-only';

import { cookies } from 'next/headers';

import { apiRequestOrNull } from './client';
import { SESSION_COOKIE } from '@/lib/cookies';
import type { Session } from '@/lib/types';

const EMPTY: Session = { user: null, participantId: null, roomCode: null };

/** `GET /session` — resolve o cookie em usuário + participação corrente. */
export async function getSession(): Promise<Session> {
  const store = await cookies();
  if (!store.get(SESSION_COOKIE)) return EMPTY;

  const session = await apiRequestOrNull<Session>('/session');
  return session ?? EMPTY;
}
