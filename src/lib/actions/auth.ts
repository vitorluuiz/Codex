'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ApiError, ApiNotConfiguredError, apiRequest } from '@/lib/api/client';
import type { User } from '@/lib/types';

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'codex_session';

export interface AuthFormState {
  error: string | null;
}

interface AuthResponse {
  token: string;
  expiresIn: number;
  user: User;
}

async function persist(token: string, expiresIn: number) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: expiresIn,
  });
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
    await persist(result.token, result.expiresIn);
  } catch (error) {
    return { error: describe(error) };
  }
  redirect('/sala');
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
    await persist(result.token, result.expiresIn);
  } catch (error) {
    return { error: describe(error) };
  }
  redirect('/sala');
}

/** `GET /auth/oauth/{provider}/authorize` — devolve a URL de redirecionamento. */
export async function startOAuthAction(provider: 'google' | 'microsoft' | 'github') {
  let url: string;
  try {
    const result = await apiRequest<{ authorizeUrl: string }>(
      `/auth/oauth/${provider}/authorize`,
      { method: 'POST', withSession: false, body: { redirectTo: '/sala' } },
    );
    url = result.authorizeUrl;
  } catch {
    return { error: 'Não foi possível iniciar o login com este provedor.' };
  }
  redirect(url);
}
