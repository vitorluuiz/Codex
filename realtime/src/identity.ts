/**
 * Quem esta do outro lado do socket, e qual o papel dele nesta sala.
 *
 * O token de sessao do Codex e opaco e protegido por ASP.NET Data Protection
 * (`SessionTokenService`): so a propria API consegue le-lo. Nao existe caminho em
 * que este servico decifre o token sozinho — e isso e bom, porque §10 exige
 * reler o papel do banco a cada `subscribe`, e o banco e da API. Entao a
 * resolucao inteira e uma chamada a `POST /internal/realtime/resolve`,
 * autenticada com o mesmo `x-service-token` que o Next usa.
 */

import { createHash } from 'node:crypto';

import type { Config } from './config.js';
import type { Logger } from './logger.js';

export type ParticipantStatus = 'pending' | 'approved' | 'rejected';

export interface Identity {
  readonly userId: string | null;
  readonly participantId: string | null;
  /** Sala a que a sessao pertence — nao a sala pedida no `hello`, se divergirem. */
  readonly roomCode: string | null;
  readonly isLeader: boolean;
  readonly participantStatus: ParticipantStatus | null;
  readonly isApprovedParticipant: boolean;
  /** Preenchidos so para participante: `player.activity` os carrega (§5). */
  readonly displayName: string | null;
  readonly avatarIndex: number | null;
  /**
   * So vem preenchido quando a credencial era um **ticket**: a API devolve o
   * token de sessao por tras dele para que a conexao consiga reler o papel nos
   * `subscribe` seguintes (§10). Um ticket e de uso unico — reapresenta-lo
   * falharia, que e exatamente o ponto dele.
   */
  readonly sessionToken: string | null;
}

export type ResolveFailure = 'unauthenticated' | 'room-not-found' | 'unavailable';

export type ResolveResult =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly reason: ResolveFailure };

export interface Credential {
  /** Cookie `codex_session` do handshake, ou o token de uso unico do `hello`. */
  readonly kind: 'session' | 'ticket';
  readonly value: string;
}

interface ResolveResponseBody {
  userId?: string | null;
  participantId?: string | null;
  roomCode?: string | null;
  isLeader?: boolean;
  participantStatus?: string | null;
  displayName?: string | null;
  avatarIndex?: number | null;
  sessionToken?: string | null;
}

export const ANONYMOUS: Identity = {
  userId: null,
  participantId: null,
  roomCode: null,
  isLeader: false,
  participantStatus: null,
  isApprovedParticipant: false,
  displayName: null,
  avatarIndex: null,
  sessionToken: null,
};

interface CacheEntry {
  readonly expiresAt: number;
  readonly result: ResolveResult;
}

export class IdentityResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  /**
   * `roomCode` nulo resolve so a identidade (usado antes do upgrade, quando a
   * sala ainda nao foi informada); com sala, a resposta traz tambem o papel.
   */
  async resolve(credential: Credential, roomCode: string | null, forceFresh = false): Promise<ResolveResult> {
    // Ticket e de uso unico e vale 30 s: cachear seria guardar o direito de
    // reusar exatamente o que o ticket existe para impedir.
    const cacheable = !forceFresh && credential.kind === 'session' && this.config.roleCacheTtlMs > 0;
    const key = this.config.roleCacheTtlMs > 0 && credential.kind === 'session' ? this.cacheKey(credential, roomCode) : null;

    if (key !== null && !forceFresh) {
      const hit = this.cache.get(key);
      if (hit !== undefined && hit.expiresAt > Date.now()) return hit.result;
      if (hit !== undefined) this.cache.delete(key);
    }

    const result = await this.call(credential, roomCode);

    // Falha de infraestrutura nao entra no cache.
    // Participante com status 'pending' não deve ser cacheado, pois pode ser aprovado a qualquer segundo
    // e o cache impediria a assinatura imediata de canais da sala.
    const isPending = result.ok && result.identity.participantStatus === 'pending';
    if (key !== null && !isPending && (result.ok || result.reason !== 'unavailable')) {
      this.cache.set(key, { expiresAt: Date.now() + this.config.roleCacheTtlMs, result });
      this.sweep();
    } else if (key !== null && isPending) {
      this.cache.delete(key);
    }

    return result;
  }

  private async call(credential: Credential, roomCode: string | null): Promise<ResolveResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.apiTimeoutMs);

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/internal/realtime/resolve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-service-token': this.config.apiServiceToken,
        },
        body: JSON.stringify({
          sessionToken: credential.kind === 'session' ? credential.value : null,
          ticket: credential.kind === 'ticket' ? credential.value : null,
          roomCode,
        }),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: 'unauthenticated' };
      }
      if (response.status === 404) {
        return { ok: false, reason: 'room-not-found' };
      }
      if (!response.ok) {
        this.logger.error('resolve respondeu erro inesperado', { status: response.status });
        return { ok: false, reason: 'unavailable' };
      }

      const body = (await response.json()) as ResolveResponseBody;
      return { ok: true, identity: toIdentity(body) };
    } catch (error) {
      // Inclui timeout (abort) e API fora do ar. Fecha o socket com
      // UNAUTHENTICATED? Nao: `unavailable` e um estado diferente, e quem chama
      // decide — hoje fecha, mas sem afirmar que a credencial era invalida.
      this.logger.error('resolve indisponivel', { error: describe(error) });
      return { ok: false, reason: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A chave e o hash do token, nao o token: um heap dump ou um log acidental
   * desta estrutura nao pode devolver credenciais utilizaveis.
   */
  private cacheKey(credential: Credential, roomCode: string | null): string {
    const digest = createHash('sha256').update(credential.value).digest('base64url');
    return `${credential.kind}:${digest}:${roomCode ?? '-'}`;
  }

  private sweep(): void {
    if (this.cache.size < 4_096) return;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }
}

function toIdentity(body: ResolveResponseBody): Identity {
  const status = normalizeStatus(body.participantStatus);
  return {
    userId: body.userId ?? null,
    participantId: body.participantId ?? null,
    roomCode: body.roomCode ?? null,
    isLeader: body.isLeader === true,
    participantStatus: status,
    isApprovedParticipant: status === 'approved',
    displayName: body.displayName ?? null,
    avatarIndex: typeof body.avatarIndex === 'number' ? body.avatarIndex : null,
    sessionToken: body.sessionToken ?? null,
  };
}

function normalizeStatus(raw: string | null | undefined): ParticipantStatus | null {
  switch (raw) {
    case 'pending':
    case 'approved':
    case 'rejected':
      return raw;
    default:
      return null;
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
