import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { ApiError, apiRequest } from '@/lib/api/client';
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

/**
 * Redireciona com `Location` relativo, resolvido pelo browser contra o endereço que ele
 * mesmo usou. `NextResponse.redirect` exigiria uma URL absoluta, e montá-la a partir de
 * `request.url` mandava a pessoa para `0.0.0.0:3000` em produção: atrás do Caddy, o servidor
 * do Next enxerga o próprio socket de escuta, não o domínio público.
 */
function redirectTo(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

/**
 * Toda falha vira a mesma volta para o login: a pessoa nunca vê uma página de erro crua, e
 * a tela não conta qual provedor recusou o quê. O motivo real vai para o log do servidor,
 * que é onde alguém pode agir sobre ele.
 */
function failure(reason: string) {
  console.error(`[oauth] callback recusado: ${reason}`);
  return redirectTo('/entrar?erro=oauth');
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

  if (!PROVIDERS.includes(provider as OAuthProvider)) {
    return failure(`provedor desconhecido na rota: ${provider}`);
  }

  const query = request.nextUrl.searchParams;
  const code = query.get('code');
  const state = query.get('state');

  // `error` é o que o provedor manda quando a pessoa cancela o consentimento.
  const providerError = query.get('error');
  if (providerError) return failure(`${provider} respondeu error=${providerError}`);
  if (!code || !state) return failure(`${provider} voltou sem code ou sem state`);

  // A amarra ao browser: sem ela, alguém poderia iniciar um fluxo e induzir outra pessoa a
  // completá-lo, deixando-a logada numa conta que não é dela.
  if (!expectedState) return failure('cookie de state ausente ou expirado');
  if (expectedState !== state) return failure('state da query não bate com o do cookie');

  let result: CallbackResponse;
  try {
    result = await apiRequest<CallbackResponse>(`/auth/oauth/${provider}/callback`, {
      method: 'POST',
      withSession: false,
      body: { code, state },
    });
  } catch (error) {
    // O código do contrato é o que diz onde olhar: OAUTH_EXCHANGE_FAILED aponta para o
    // provedor, OAUTH_EMAIL_NOT_VERIFIED para a conta, INTERNAL_ERROR para o banco.
    const detail =
      error instanceof ApiError
        ? `${error.status} ${error.code ?? 'sem code'}: ${error.message}`
        : String(error);
    return failure(`API recusou o callback de ${provider} — ${detail}`);
  }

  await persistSession(result.token, result.expiresIn);
  return redirectTo(result.redirectTo);
}
