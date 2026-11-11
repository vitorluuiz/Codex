import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createReportsServer } from './server.js';
import { HybridReportStore } from './store.js';
import { ReportWorker } from './worker.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, { service: 'codex-reports' });

  const store = new HybridReportStore(config, logger.child({ component: 'store' }));
  const worker = new ReportWorker(config, store, logger.child({ component: 'worker' }));
  const httpServer = createReportsServer(config, store, worker, logger.child({ component: 'http' }));

  await worker.start();
  const port = await httpServer.listen();

  logger.info('servico de relatorios no ar', {
    host: config.host,
    port,
    mongoConfigured: config.mongoUrl !== null,
    redisConfigured: config.redisUrl !== null,
  });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('encerrando servico de relatorios', { signal });
    await Promise.allSettled([httpServer.close(), worker.close(), store.close()]);
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: Error) => {
  process.stderr.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: error.message })}\n`,
  );
  process.exit(1);
});
