import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { apiRequest } from '@/lib/api/client';
import { OAUTH_STATE_COOKIE, persistSession } from '@/lib/cookies';
import type { OAuthProvider, User } from '@/lib/types';

/**
 * Onde o provedor devolve a pessoa depois do consentimento.
 *
 * O contrato dizia que este callback bateria na API, mas ele chega como uma navegação de
 * browser, sem o `x-service-token` que o `ServiceTokenMiddleware` exige de tudo. Então ele
 * aterrissa aqui: o Next confere o `state`, chama a API pelo servidor e grava o cookie —
 * exatamente o caminho que o login por email e senha já percorre.
 */

const PROVIDERS: OAuthProvider[] = ['google', 'microsoft', 'github'];

interface CallbackResponse {
  token: string;
  expiresIn: number;
  user: User;
  redirectTo: string;
}

/** Toda falha vira a mesma volta para o login: a pessoa nunca vê uma página de erro crua. */
function failure(request: NextRequest) {
  return NextResponse.redirect(new URL('/entrar?erro=oauth', request.url));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const store = await cookies();
  const expectedState = store.get(OAUTH_STATE_COOKIE)?.value;

  // O cookie é de uso único, independentemente do que aconteça daqui para baixo.
  store.delete(OAUTH_STATE_COOKIE);

  if (!PROVIDERS.includes(provider as OAuthProvider)) return failure(request);

  const query = request.nextUrl.searchParams;
  const code = query.get('code');
  const state = query.get('state');

  // `error` é o que o provedor manda quando a pessoa cancela o consentimento.
  if (query.get('error') || !code || !state) return failure(request);

  // A amarra ao browser: sem ela, alguém poderia iniciar um fluxo e induzir outra pessoa a
  // completá-lo, deixando-a logada numa conta que não é dela.
  if (!expectedState || expectedState !== state) return failure(request);

  let result: CallbackResponse;
  try {
    result = await apiRequest<CallbackResponse>(`/auth/oauth/${provider}/callback`, {
      method: 'POST',
      withSession: false,
      body: { code, state },
    });
  } catch {
    return failure(request);
  }

  await persistSession(result.token, result.expiresIn);
  return NextResponse.redirect(new URL(result.redirectTo, request.url));
}
