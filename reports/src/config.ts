export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  readonly port: number;
  readonly host: string;
  readonly apiServiceToken: string;
  readonly reportTokenSecret: string;
  readonly mongoUrl: string | null;
  readonly mongoDb: string;
  readonly redisUrl: string | null;
  readonly redisChannelPrefix: string;
  readonly logLevel: LogLevel;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiServiceToken = (env.API_SERVICE_TOKEN ?? '').trim();
  if (!apiServiceToken) {
    throw new Error('API_SERVICE_TOKEN obrigatoria — o servico de relatorios recusa subir sem ela.');
  }

  const reportTokenSecret = (env.REPORT_TOKEN_SECRET ?? '').trim() || apiServiceToken;

  const portRaw = Number(env.PORT ?? '4002');
  const port = Number.isInteger(portRaw) && portRaw >= 0 && portRaw <= 65535 ? portRaw : 4002;
  const host = (env.REPORTS_HOST ?? '0.0.0.0').trim() || '0.0.0.0';

  const mongoUrl = (env.MONGO_URL ?? '').trim() || null;
  const mongoDb = (env.MONGO_DB ?? 'codex').trim() || 'codex';

  const redisUrl = (env.REDIS_URL ?? '').trim() || null;
  const redisChannelPrefix = (env.REDIS_CHANNEL_PREFIX ?? 'codex:rt:').trim() || 'codex:rt:';

  const levelRaw = (env.LOG_LEVEL ?? 'info').toLowerCase();
  const logLevel: LogLevel =
    levelRaw === 'debug' || levelRaw === 'info' || levelRaw === 'warn' || levelRaw === 'error'
      ? levelRaw
      : 'info';

  return {
    port,
    host,
    apiServiceToken,
    reportTokenSecret,
    mongoUrl,
    mongoDb,
    redisUrl,
    redisChannelPrefix,
    logLevel,
  };
}
