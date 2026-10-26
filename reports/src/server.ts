import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { toIndividualReport } from './builder.js';
import type { Config } from './config.js';
import { generateMatchReportExcel } from './excel.js';
import type { Logger } from './logger.js';
import type { ReportStore } from './store.js';
import type { ReportJobPayload, ReportWorker } from './worker.js';

function verifyToken(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const expBuf = Buffer.from(expected, 'utf8');
  const actBuf = Buffer.from(actual, 'utf8');
  if (expBuf.length !== actBuf.length) return false;
  return timingSafeEqual(expBuf, actBuf);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { code, message });
}

function sendBinary(
  res: ServerResponse,
  contentType: string,
  filename: string,
  buffer: Buffer,
): void {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  res.writeHead(200, {
    'content-type': contentType,
    'content-disposition': `attachment; filename="${safeName}"`,
    'content-length': buffer.length,
    'cache-control': 'no-store',
  });
  res.end(buffer);
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total <= 16 * 1024 * 1024) chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

export interface ReportsHttpServer {
  readonly server: Server;
  listen(): Promise<number>;
  close(): Promise<void>;
}

export function createReportsServer(
  config: Config,
  store: ReportStore,
  worker: ReportWorker,
  logger: Logger,
): ReportsHttpServer {
  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    if (method === 'GET' && path === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        mongo: store.isMongoConnected() ? 'connected' : 'memory',
        redis: worker.isRedisConnected() ? 'connected' : 'disabled',
      });
      return;
    }

    const tokenHeader = req.headers['x-service-token'];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    if (!verifyToken(config.apiServiceToken, token)) {
      sendError(res, 401, 'INVALID_SERVICE_TOKEN', 'Cabeçalho x-service-token inválido.');
      return;
    }

    try {
      // POST /internal/jobs — Enfileira processamento de relatorio em segundo plano
      if (method === 'POST' && path === '/internal/jobs') {
        const body = await readJsonBody<ReportJobPayload>(req);
        if (!body || typeof body.matchId !== 'string' || !body.matchId.trim()) {
          sendError(res, 400, 'VALIDATION_ERROR', 'matchId é obrigatório.');
          return;
        }
        await worker.enqueueJob(body);
        sendJson(res, 202, {
          matchId: body.matchId.trim(),
          status: 'processing',
        });
        return;
      }

      // GET /reports/matches/:matchId/status
      const statusMatch = /^\/reports\/matches\/([^/]+)\/status$/.exec(path);
      if (method === 'GET' && statusMatch) {
        const matchId = decodeURIComponent(statusMatch[1]!);
        const existing = await store.getReportByMatchId(matchId);
        if (existing) {
          sendJson(res, 200, {
            matchId: existing.matchId,
            status: existing.status,
            shareToken: existing.shareToken,
            generatedAt: existing.generatedAt,
          });
          return;
        }
        if (worker.isProcessing(matchId)) {
          sendJson(res, 200, { matchId, status: 'processing' });
          return;
        }
        const rawMatch = await store.getRawMatch(matchId);
        if (rawMatch) {
          void worker.processMatch(matchId, { notifyRealtime: true });
          sendJson(res, 200, { matchId, status: 'processing' });
          return;
        }
        sendJson(res, 200, { matchId, status: 'not_found' });
        return;
      }

      // GET /reports/matches/:matchId/export/xlsx
      const matchXlsx = /^\/reports\/matches\/([^/]+)\/export\/xlsx$/.exec(path);
      if (method === 'GET' && matchXlsx) {
        const matchId = decodeURIComponent(matchXlsx[1]!);
        const report =
          (await store.getReportByMatchId(matchId)) ??
          (await worker.processMatch(matchId, { notifyRealtime: false }));
        if (!report) {
          sendError(res, 404, 'REPORT_NOT_FOUND', 'Relatório da partida não encontrado.');
          return;
        }
        const buf = await generateMatchReportExcel(report);
        sendBinary(
          res,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          `relatorio-${report.roomCode}-${report.matchId.slice(0, 8)}.xlsx`,
          buf,
        );
        return;
      }

      // GET /reports/share/:shareToken/export/xlsx
      const shareXlsx = /^\/reports\/share\/([^/]+)\/export\/xlsx$/.exec(path);
      if (method === 'GET' && shareXlsx) {
        const shareToken = decodeURIComponent(shareXlsx[1]!);
        const report = await store.getReportByShareToken(shareToken);
        if (!report) {
          sendError(res, 404, 'REPORT_NOT_FOUND', 'Relatório não encontrado.');
          return;
        }
        const buf = await generateMatchReportExcel(report);
        sendBinary(
          res,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          `relatorio-${report.roomCode}-${report.matchId.slice(0, 8)}.xlsx`,
          buf,
        );
        return;
      }

      // GET /reports/matches/:matchId/participants/:participantOrUserId
      const partMatch = /^\/reports\/matches\/([^/]+)\/participants\/([^/]+)$/.exec(path);
      if (method === 'GET' && partMatch) {
        const matchId = decodeURIComponent(partMatch[1]!);
        const targetId = decodeURIComponent(partMatch[2]!).toLowerCase();
        const report =
          (await store.getReportByMatchId(matchId)) ??
          (await worker.processMatch(matchId, { notifyRealtime: false }));
        if (!report) {
          sendError(res, 404, 'REPORT_NOT_FOUND', 'Relatório da partida não encontrado.');
          return;
        }
        const participant = report.participants.find(
          (p) =>
            p.participantId.toLowerCase() === targetId ||
            (p.userId && p.userId.toLowerCase() === targetId),
        );
        if (!participant) {
          sendError(
            res,
            404,
            'PARTICIPANT_NOT_FOUND',
            'Participante não encontrado neste relatório.',
          );
          return;
        }
        sendJson(res, 200, toIndividualReport(report, participant));
        return;
      }

      // GET /reports/matches/:matchId
      const matchReportRoute = /^\/reports\/matches\/([^/]+)$/.exec(path);
      if (method === 'GET' && matchReportRoute) {
        const matchId = decodeURIComponent(matchReportRoute[1]!);
        const report =
          (await store.getReportByMatchId(matchId)) ??
          (await worker.processMatch(matchId, { notifyRealtime: false }));
        if (!report) {
          sendError(res, 404, 'REPORT_NOT_FOUND', 'Relatório da partida não encontrado.');
          return;
        }
        sendJson(res, 200, report);
        return;
      }

      // GET /reports/share/:shareToken
      const shareRoute = /^\/reports\/share\/([^/]+)$/.exec(path);
      if (method === 'GET' && shareRoute) {
        const shareToken = decodeURIComponent(shareRoute[1]!);
        const report = await store.getReportByShareToken(shareToken);
        if (!report) {
          sendError(res, 404, 'REPORT_NOT_FOUND', 'Relatório compartilhado não encontrado.');
          return;
        }
        sendJson(res, 200, report);
        return;
      }

      // GET /reports/individual/:accessToken
      const indivRoute = /^\/reports\/individual\/([^/]+)$/.exec(path);
      if (method === 'GET' && indivRoute) {
        const accessToken = decodeURIComponent(indivRoute[1]!);
        const indiv = await store.getIndividualByAccessToken(accessToken);
        if (!indiv) {
          sendError(res, 404, 'REPORT_NOT_FOUND', 'Relatório individual não encontrado.');
          return;
        }
        sendJson(res, 200, indiv);
        return;
      }

      // GET /reports/users/:userId/history
      const historyRoute = /^\/reports\/users\/([^/]+)\/history$/.exec(path);
      if (method === 'GET' && historyRoute) {
        const userId = decodeURIComponent(historyRoute[1]!);
        await worker.ensureUserReportsProcessed(userId);
        const history = await store.getUserHistory(userId);
        sendJson(res, 200, history);
        return;
      }

      sendError(res, 404, 'NOT_FOUND', 'Rota não encontrada no serviço de relatórios.');
    } catch (error) {
      logger.error('erro nao tratado no servidor HTTP de relatorios', {
        path,
        error: (error as Error).message,
      });
      sendError(res, 500, 'INTERNAL_ERROR', 'Falha interna ao processar relatório.');
    }
  });

  return {
    server,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          const addr = server.address();
          const port = typeof addr === 'object' && addr !== null ? addr.port : config.port;
          resolve(port);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
