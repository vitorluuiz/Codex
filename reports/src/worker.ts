import { Redis } from 'ioredis';

import { buildMatchReport } from './builder.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { normalizeRawMatch, type ReportStore } from './store.js';
import type { MatchReportDocument, RawMatchDocument } from './types.js';

export const REDIS_REPORTS_QUEUE = 'codex:reports:queue';
export const REDIS_REPORTS_JOBS_CHANNEL = 'codex:reports:jobs';

export interface ReportJobPayload {
  matchId: string;
  roomCode?: string;
  matchSnapshot?: RawMatchDocument | Record<string, unknown>;
}

export class ReportWorker {
  private subscriber: Redis | null = null;
  private publisher: Redis | null = null;
  private redisConnected = false;
  private closing = false;
  private readonly processingIds = new Map<string, Promise<MatchReportDocument | null>>();

  constructor(
    private readonly config: Config,
    private readonly store: ReportStore,
    private readonly logger: Logger,
  ) {}

  isRedisConnected(): boolean {
    return this.redisConnected;
  }

  async start(): Promise<void> {
    if (this.config.redisUrl) {
      try {
        this.subscriber = new Redis(this.config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          retryStrategy: (times) => Math.min(times * 1000, 5000),
        });
        this.publisher = new Redis(this.config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          retryStrategy: (times) => Math.min(times * 1000, 5000),
        });

        this.subscriber.on('error', (err: Error) => {
          this.redisConnected = false;
          this.logger.warn('redis subscriber indisponivel', { error: err.message });
        });
        this.publisher.on('error', (err: Error) => {
          this.redisConnected = false;
          this.logger.warn('redis publisher indisponivel', { error: err.message });
        });

        this.subscriber.on('ready', () => {
          this.redisConnected = true;
          void this.subscriber
            ?.subscribe(REDIS_REPORTS_JOBS_CHANNEL)
            .catch((err: Error) =>
              this.logger.warn('falha ao assinar canal de jobs', { error: err.message }),
            );
          void this.drainRedisQueue();
        });

        this.subscriber.on('message', (channel: string, message: string) => {
          if (channel !== REDIS_REPORTS_JOBS_CHANNEL) return;
          void this.handleRawJobMessage(message);
          void this.drainRedisQueue();
        });

        await Promise.allSettled([this.subscriber.connect(), this.publisher.connect()]);
      } catch (error) {
        this.logger.warn('Redis indisponivel no boot — worker rodara via HTTP/Mongo', {
          error: (error as Error).message,
        });
      }
    }

    // Backfill assincrono no startup para partidas finalizadas no MongoDB ainda sem relatorio
    void this.backfillUnprocessedMatches();
  }

  private async backfillUnprocessedMatches(): Promise<void> {
    try {
      const unprocessed = await this.store.listUnprocessedMatchIds(50);
      if (unprocessed.length === 0) return;
      this.logger.info('iniciando backfill de relatorios pendentes do MongoDB', {
        count: unprocessed.length,
      });
      for (const matchId of unprocessed) {
        if (this.closing) break;
        await this.processMatch(matchId, { notifyRealtime: false });
      }
    } catch (error) {
      this.logger.warn('erro durante backfill inicial', { error: (error as Error).message });
    }
  }

  private async drainRedisQueue(): Promise<void> {
    if (!this.publisher || this.closing || !this.redisConnected) return;
    try {
      while (!this.closing) {
        const raw = await this.publisher.lpop(REDIS_REPORTS_QUEUE);
        if (!raw) break;
        await this.handleRawJobMessage(raw);
      }
    } catch (error) {
      this.logger.warn('erro ao drenar fila Redis de relatorios', {
        error: (error as Error).message,
      });
    }
  }

  private async handleRawJobMessage(raw: string): Promise<void> {
    try {
      const parsed = JSON.parse(raw) as ReportJobPayload;
      if (!parsed || typeof parsed.matchId !== 'string') return;
      await this.enqueueJob(parsed);
    } catch (error) {
      this.logger.warn('mensagem de job invalida', { error: (error as Error).message });
    }
  }

  async enqueueJob(job: ReportJobPayload): Promise<void> {
    const matchId = job.matchId.trim();
    if (!matchId) return;

    if (job.matchSnapshot) {
      const normalized = normalizeRawMatch(job.matchSnapshot as Record<string, unknown>);
      await this.store.saveRawMatchSnapshot(normalized);
    }

    // Dispara processamento em segundo plano
    void this.processMatch(matchId, { notifyRealtime: true });
  }

  isProcessing(matchId: string): boolean {
    return this.processingIds.has(matchId.trim().toLowerCase());
  }

  async processMatch(
    matchId: string,
    options: { notifyRealtime: boolean } = { notifyRealtime: true },
  ): Promise<MatchReportDocument | null> {
    const key = matchId.trim().toLowerCase();
    const inFlight = this.processingIds.get(key);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<MatchReportDocument | null> => {
      try {
        const existing = await this.store.getReportByMatchId(matchId);
        if (existing && existing.status === 'ready') {
          if (options.notifyRealtime) {
            await this.publishReportReady(existing);
          }
          return existing;
        }

        const rawMatch = await this.store.getRawMatch(matchId);
        if (!rawMatch) {
          this.logger.warn('partida nao encontrada em matches para gerar relatorio', { matchId });
          return null;
        }

        const report = buildMatchReport(rawMatch, this.config.reportTokenSecret);
        await this.store.saveReport(report);

        this.logger.info('relatorio de partida processado com sucesso', {
          matchId: report.matchId,
          roomCode: report.roomCode,
          participants: report.overview.participantCount,
          phases: report.overview.phaseCount,
        });

        if (options.notifyRealtime) {
          await this.publishReportReady(report);
        }

        return report;
      } catch (error) {
        this.logger.error('falha ao processar relatorio da partida', {
          matchId,
          error: (error as Error).message,
        });
        return null;
      } finally {
        this.processingIds.delete(key);
      }
    })();

    this.processingIds.set(key, promise);
    return promise;
  }

  async ensureUserReportsProcessed(userId: string): Promise<void> {
    const rawMatches = await this.store.listRawMatchesByUser(userId, 30);
    for (const raw of rawMatches) {
      await this.store.saveRawMatchSnapshot(raw);
      const existing = await this.store.getReportByMatchId(raw.id);
      if (!existing) {
        await this.processMatch(raw.id, { notifyRealtime: false });
      }
    }
  }

  private async publishReportReady(report: MatchReportDocument): Promise<void> {
    if (!this.publisher || !this.redisConnected || !report.roomCode) return;

    const brokerChannel = `${this.config.redisChannelPrefix}room:${report.roomCode}`;
    const envelope = {
      channel: `room:${report.roomCode}:match`,
      event: {
        type: 'report.ready',
        matchId: report.matchId,
        shareToken: report.shareToken,
      },
      publishedAt: Date.now(),
    };

    try {
      await this.publisher.publish(brokerChannel, JSON.stringify(envelope));
      this.logger.debug('evento report.ready publicado no Redis', {
        roomCode: report.roomCode,
        matchId: report.matchId,
      });
    } catch (error) {
      this.logger.warn('falha ao publicar report.ready no Redis', {
        roomCode: report.roomCode,
        error: (error as Error).message,
      });
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([
      this.subscriber?.quit() ?? Promise.resolve(),
      this.publisher?.quit() ?? Promise.resolve(),
    ]);
  }
}
