'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ApiError, ApiNotConfiguredError, apiRequest } from '@/lib/api/client';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE,
  SESSION_COOKIE,
  persistSession,
} from '@/lib/cookies';
import type { OAuthProvider } from '@/lib/types';
import type { User } from '@/lib/types';

export interface AuthFormState {
  error: string | null;
}

interface AuthResponse {
  token: string;
  expiresIn: number;
  user: User;
}

function describe(error: unknown): string {
  if (error instanceof ApiNotConfiguredError) {
    return 'A API de autenticação ainda não está configurada. Defina API_BASE_URL.';
  }
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Email ou senha incorretos.';
    if (error.status === 409) return 'Já existe uma conta com este email.';
    return error.message;
  }
  return 'Não foi possível concluir. Tente novamente.';
}

/** `POST /auth/login` */
export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const result = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      withSession: false,
      body: {
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
        rememberMe: formData.get('rememberMe') === 'on',
      },
    });
    await persistSession(result.token, result.expiresIn);
  } catch (error) {
    return { error: describe(error) };
  }
  redirect('/perfil');
}

/** `POST /auth/signup` */
export async function signupAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const result = await apiRequest<AuthResponse>('/auth/signup', {
      method: 'POST',
      withSession: false,
      body: {
        name: String(formData.get('name') ?? ''),
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
      },
    });
    await persistSession(result.token, result.expiresIn);
  } catch (error) {
    return { error: describe(error) };
  }
  redirect('/perfil');
}

/**
 * `POST /auth/logout`
 *
 * O cookie é apagado mesmo se a API falhar: deixar a pessoa presa numa sessão
 * que ela mandou encerrar é pior que uma sessão órfã no servidor, que expira
 * sozinha.
 */
export async function logoutAction() {
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
  } catch {
    /* segue para limpar o cookie de qualquer forma */
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/');
}

/**
 * `POST /auth/oauth/{provider}/authorize` — devolve a URL de consentimento.
 *
 * O `state` volta junto e é guardado num cookie: o callback só aceita o fluxo se o valor da
 * query bater com ele. Redireciona para fora do site em caso de sucesso, então o único
 * retorno possível é o de erro.
 */
export async function startOAuthAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const provider = String(formData.get('provider') ?? '') as OAuthProvider;

  let authorizeUrl: string;
  try {
    const result = await apiRequest<{ authorizeUrl: string; state: string }>(
      `/auth/oauth/${provider}/authorize`,
      { method: 'POST', withSession: false, body: { redirectTo: '/perfil' } },
    );
    authorizeUrl = result.authorizeUrl;

    const store = await cookies();
    store.set(OAUTH_STATE_COOKIE, result.state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: OAUTH_STATE_MAX_AGE,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'OAUTH_PROVIDER_NOT_CONFIGURED') {
      return { error: 'Este provedor ainda não está disponível. Entre com email e senha.' };
    }
    return { error: 'Não foi possível iniciar o login com este provedor.' };
  }
  redirect(authorizeUrl);
}
