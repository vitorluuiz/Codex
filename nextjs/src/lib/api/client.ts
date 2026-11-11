import 'server-only';

import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '@/lib/cookies';
import type { AiUsage } from '@/lib/types';

/**
 * Cliente HTTP usado exclusivamente por Server Components e Server Actions.
 * O browser nunca fala com a API diretamente — só com o servidor de WebSocket.
 */

export class ApiNotConfiguredError extends Error {
  constructor(public readonly endpoint: string) {
    super(`API_BASE_URL não configurada (endpoint requerido: ${endpoint})`);
    this.name = 'ApiNotConfiguredError';
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly code: string | null,
    message: string,
    public readonly usage?: AiUsage,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Segundos de cache do Next. `0` desliga (padrão para tudo que é de partida). */
  revalidate?: number;
  /** Tags de cache para invalidação via `revalidateTag`. */
  tags?: string[];
  /** Envia o cookie de sessão da pessoa junto. Padrão: `true`. */
  withSession?: boolean;
}

async function buildHeaders(withSession: boolean): Promise<Headers> {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json',
  });

  const serviceToken = process.env.API_SERVICE_TOKEN;
  if (serviceToken) headers.set('x-service-token', serviceToken);

  if (withSession) {
    const store = await cookies();
    const session = store.get(SESSION_COOKIE)?.value;
    if (session) headers.set('authorization', `Bearer ${session}`);
  }

  return headers;
}

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const base = process.env.API_BASE_URL;
  if (!base) throw new ApiNotConfiguredError(endpoint);

  const { method = 'GET', body, revalidate = 0, tags, withSession = true } = options;

  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: await buildHeaders(withSession),
    body: body === undefined ? undefined : JSON.stringify(body),
    next: revalidate > 0 ? { revalidate, tags } : { revalidate: 0, tags },
  });

  if (!response.ok) {
    let code: string | null = null;
    let message = response.statusText;
    let usage: AiUsage | undefined;
    try {
      const payload = (await response.json()) as {
        code?: string;
        message?: string;
        usage?: AiUsage;
      };
      code = payload.code ?? null;
      message = payload.message ?? message;
      usage = payload.usage;
    } catch {
      /* corpo não-JSON: mantém o statusText */
    }
    throw new ApiError(response.status, endpoint, code, message, usage);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Variante que devolve `null` em vez de estourar quando a API ainda não existe
 * ou o recurso não foi encontrado. Usada em telas que sabem renderizar vazio.
 */
export async function apiRequestOrNull<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T | null> {
  try {
    return await apiRequest<T>(endpoint, options);
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) return null;
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
