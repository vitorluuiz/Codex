/**
 * Configuracao por variavel de ambiente. Nao ha arquivo de config versionado: o
 * servico e desenhado para rodar em N instancias identicas (contract §9), entao
 * tudo que muda entre elas tem que vir do ambiente, nunca do disco.
 *
 * Carregue o `.env` com o flag nativo do Node (`--env-file-if-exists=.env`, ja no
 * script `start`) — nao ha dependencia de dotenv de proposito.
 */

export interface Config {
  readonly port: number;
  readonly host: string;
  /** Caminho do upgrade. O front usa `NEXT_PUBLIC_REALTIME_URL=ws://host/realtime`. */
  readonly path: string;

  /** Base da API .NET. O WS so fala com ela para resolver identidade e papel. */
  readonly apiBaseUrl: string;
  /** Mesmo segredo do `x-service-token` da API — sem ele nenhuma chamada passa. */
  readonly apiServiceToken: string;
  readonly apiTimeoutMs: number;

  readonly sessionCookieName: string;

  /** Vazio = broker em memoria (uma instancia so, ver `broker.ts`). */
  readonly redisUrl: string | null;
  readonly redisChannelPrefix: string;

  /**
   * Allowlist de `Origin` (contract §10). `*` desliga a checagem — aceitavel em
   * dev, nunca em producao.
   */
  readonly allowedOrigins: readonly string[];

  readonly maxFrameBytes: number;
  readonly rateLimitMessagesPerSecond: number;
  /** Quanto tempo um socket pode ficar sem mandar `hello` antes de ser fechado. */
  readonly helloTimeoutMs: number;
  /** Janela de deduplicacao da releitura de papel a cada `subscribe` (§10). */
  readonly roleCacheTtlMs: number;
  /** Sem trafego do cliente por este tempo: ping do servidor; o dobro fecha. */
  readonly idleTimeoutMs: number;
  readonly shutdownGraceMs: number;

  readonly logLevel: LogLevel;
  readonly isProduction: boolean;
  /**
   * Habilita `POST /dev/publish`, que injeta um envelope no broker sem passar
   * pela API. So para desenvolvimento — recusado quando NODE_ENV=production.
   */
  readonly devPublishEnabled: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class ConfigError extends Error {}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new ConfigError(
      `${name} nao configurada. O servico falha fechado: sem ela nao ha como provar ` +
        `para a API que a chamada veio daqui (mesma politica do ServiceTokenMiddleware).`,
    );
  }
  return value;
}

function optional(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value === '' ? fallback : value;
}

/**
 * `minimum` e 1 por padrao porque zero nao faz sentido para porta, timeout ou
 * limite de quadro — um `0` ali seria um erro de digitacao virando um servico
 * que aceita tudo. As unicas excecoes sao os valores em que zero e uma opcao de
 * verdade ("desliga o cache"), e elas pedem `minimum: 0` explicitamente.
 */
function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, minimum = 1): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new ConfigError(`${name} deve ser um inteiro >= ${minimum} (recebido: ${raw}).`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env.NODE_ENV === 'production';

  const allowedOrigins = optional(env, 'REALTIME_ALLOWED_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    throw new ConfigError('REALTIME_ALLOWED_ORIGINS ficou vazia — seria aceitar socket de qualquer site.');
  }

  const redisUrl = optional(env, 'REDIS_URL', '') || null;
  if (isProduction && redisUrl === null) {
    throw new ConfigError(
      'REDIS_URL e obrigatoria em producao: sem broker compartilhado cada instancia so ' +
        'entrega os eventos que ela mesma recebeu, e o fan-out entre instancias some.',
    );
  }

  if (isProduction && allowedOrigins.includes('*')) {
    throw new ConfigError('REALTIME_ALLOWED_ORIGINS=* nao e aceito em producao (contract §10).');
  }

  return {
    port: integer(env, 'PORT', 4001),
    host: optional(env, 'REALTIME_HOST', '0.0.0.0'),
    path: optional(env, 'REALTIME_PATH', '/realtime'),

    apiBaseUrl: optional(env, 'API_BASE_URL', 'http://localhost:5282').replace(/\/+$/, ''),
    apiServiceToken: required(env, 'API_SERVICE_TOKEN'),
    apiTimeoutMs: integer(env, 'API_TIMEOUT_MS', 5_000),

    sessionCookieName: optional(env, 'SESSION_COOKIE_NAME', 'codex_session'),

    redisUrl,
    redisChannelPrefix: optional(env, 'REDIS_CHANNEL_PREFIX', 'codex:rt:'),

    allowedOrigins,

    maxFrameBytes: integer(env, 'REALTIME_MAX_FRAME_BYTES', 8 * 1024),
    rateLimitMessagesPerSecond: integer(env, 'REALTIME_RATE_LIMIT_PER_SECOND', 20),
    helloTimeoutMs: integer(env, 'REALTIME_HELLO_TIMEOUT_MS', 5_000),
    // Zero e valido: releitura do papel a cada `subscribe`, sem deduplicacao.
    roleCacheTtlMs: integer(env, 'REALTIME_ROLE_CACHE_TTL_MS', 1_000, 0),
    idleTimeoutMs: integer(env, 'REALTIME_IDLE_TIMEOUT_MS', 45_000),
    shutdownGraceMs: integer(env, 'REALTIME_SHUTDOWN_GRACE_MS', 5_000),

    logLevel: optional(env, 'LOG_LEVEL', isProduction ? 'info' : 'debug') as LogLevel,
    isProduction,
    devPublishEnabled: !isProduction && optional(env, 'REALTIME_DEV_PUBLISH', '') === '1',
  };
}
