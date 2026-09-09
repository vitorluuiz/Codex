import 'server-only';

import { cookies } from 'next/headers';

/**
 * Nome do cookie de sessão. Resolvido num lugar só porque cinco módulos precisam dele
 * (client, session, as actions de auth e de sala, e o callback do OAuth) e um deles lendo
 * um nome diferente dos outros significaria uma sessão invisível, não um erro.
 */
export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'codex_session';

/**
 * Guarda o `state` do fluxo OAuth entre o clique no botão e a volta do provedor. É o que
 * amarra o fluxo a este browser: sem essa conferência, alguém poderia iniciar um login e
 * induzir outra pessoa a completá-lo, deixando-a logada na conta do atacante.
 */
export const OAUTH_STATE_COOKIE = 'codex_oauth_state';

/** Mesma janela do state emitido pela API (OAuthService.StateLifetime). */
export const OAUTH_STATE_MAX_AGE = 600;

/**
 * Grava a sessão emitida pela API. Vive aqui, e não junto das server actions, porque tudo
 * que um módulo `'use server'` exporta vira um endpoint que o browser pode chamar — e uma
 * função que aceita um token e o transforma em cookie não pode ser uma dessas.
 */
export async function persistSession(token: string, expiresIn: number) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: expiresIn,
  });
}
