// O Windows não entrega SIGTERM: `child.kill('SIGTERM')` termina o processo à
// força, então o handler de §9 nunca roda e o smoke principal vê close=1006.
// Aqui o servidor sobe no mesmo processo e `shutdown()` é chamado direto — que é
// exatamente o que o handler de SIGTERM faz em produção.
import { createServer } from 'node:http';
import WebSocket from 'ws';

import { createBroker } from '../dist/broker.js';
import { loadConfig } from '../dist/config.js';
import { IdentityResolver } from '../dist/identity.js';
import { createLogger } from '../dist/logger.js';
import { RealtimeServer } from '../dist/server.js';

const API_PORT = 5601;
const WS_PORT = 4601;

const api = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { roomCode } = JSON.parse(body || '{}');
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        participantId: '11111111-1111-1111-1111-111111111111',
        roomCode: roomCode ?? null,
        isLeader: false,
        participantStatus: roomCode ? 'approved' : null,
        displayName: 'Diego',
        avatarIndex: 3,
      }),
    );
  });
});
await new Promise((r) => api.listen(API_PORT, r));

const config = loadConfig({
  ...process.env,
  PORT: String(WS_PORT),
  API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
  API_SERVICE_TOKEN: 'segredo-de-teste',
  REDIS_URL: '',
  REALTIME_ALLOWED_ORIGINS: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const logger = createLogger('error', {});
const broker = createBroker(config, logger);
const server = new RealtimeServer({ config, logger, broker, resolver: new IdentityResolver(config, logger) });
await server.listen();

const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/realtime`, {
  headers: { origin: 'http://localhost:3000', cookie: 'codex_session=tok' },
});
const messages = [];
ws.on('message', (d) => messages.push(JSON.parse(String(d))));
await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ type: 'hello', v: 1, token: '', roomCode: '482913' }));
ws.send(JSON.stringify({ type: 'subscribe', channels: ['room:482913'] }));
await new Promise((r) => setTimeout(r, 400));

const closed = new Promise((r) => ws.on('close', (code) => r(code)));
const upgradeAfterDrain = new Promise((resolve) => {
  setTimeout(() => {
    const late = new WebSocket(`ws://127.0.0.1:${WS_PORT}/realtime`, { headers: { origin: 'http://localhost:3000' } });
    late.on('error', () => resolve('recusado'));
    late.on('open', () => resolve('aceito'));
  }, 20);
});

await server.shutdown();
const code = await Promise.race([closed, new Promise((r) => setTimeout(() => r(null), 2000))]);
const late = await upgradeAfterDrain;

const gotReconnect = messages.some((m) => m.type === 'error' && m.code === 'RECONNECT');
const ok = gotReconnect && code === 1001 && late === 'recusado';

console.log(`${gotReconnect ? 'PASS' : 'FALHOU'}  SIGTERM manda {"type":"error","code":"RECONNECT"} (§9)`);
console.log(`${code === 1001 ? 'PASS' : 'FALHOU'}  ...e fecha com 1001 — close=${code}`);
console.log(`${late === 'recusado' ? 'PASS' : 'FALHOU'}  Upgrade durante o dreno é recusado — ${late}`);

api.close();
process.exit(ok ? 0 : 1);
