import type { LogLevel } from './config.js';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bound: Record<string, unknown>): Logger;
}

export function createLogger(level: LogLevel, bound: Record<string, unknown> = {}): Logger {
  const threshold = ORDER[level] ?? ORDER.info;

  function write(entry: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (ORDER[entry] < threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: entry,
      msg: message,
      ...bound,
      ...fields,
    });
    if (entry === 'error' || entry === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (extra) => createLogger(level, { ...bound, ...extra }),
  };
}
