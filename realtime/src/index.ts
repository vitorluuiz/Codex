/** Ponto de entrada do servico de tempo real. */

import { createBroker } from './broker.js';
import { loadConfig } from './config.js';
import { IdentityResolver } from './identity.js';
import { createLogger } from './logger.js';
import { RealtimeServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, { service: 'codex-realtime' });

  const broker = createBroker(config, logger);
  const resolver = new IdentityResolver(config, logger.child({ component: 'identity' }));
  const server = new RealtimeServer({ config, logger, broker, resolver });

  await server.listen();

  let shuttingDown = false;
  const stop = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('sinal recebido', { signal });
    server
      .shutdown()
      .then(() => process.exit(0))
      .catch((error: Error) => {
        logger.error('falha no encerramento', { error: error.message });
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  // Uma excecao nao tratada num handler de socket nao pode derrubar as outras
  // 9.999 conexoes da instancia sem ao menos deixar rastro.
  process.on('unhandledRejection', (reason) => {
    logger.error('promessa rejeitada sem tratamento', { reason: String(reason) });
  });
}

main().catch((error: Error) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'falha ao subir', error: error.message })}\n`);
  process.exit(1);
});
