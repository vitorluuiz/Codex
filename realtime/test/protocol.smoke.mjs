// Smoke test do protocolo (contract/websocket-contract.md §2–§10), rodando o
// serviço de verdade contra uma API .NET falsa no lugar de
// /internal/realtime/resolve. Roda sobre o dist/ compilado — `npm test`.
//
// A API é falsa de propósito: o que se verifica aqui é o comportamento do fio
// (quem assina o quê, o que é descartado, quando o socket fecha), e a resolução
// de identidade de verdade já é coberta pelos testes de RealtimeSessionService
// no lado .NET.
//
// Nota: o caso do SIGTERM (§9) falha no Windows por artefato de plataforma —
// `child.kill('SIGTERM')` termina o processo à força e o handler nunca roda.
// Ele é verificado em processo por `shutdown.smoke.mjs`.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const API_PORT = 5599;
const WS_PORT = 4599;
const SERVICE_TOKEN = 'segredo-de-teste';

const ROOM = '482913';
const LEADER_TOKEN = 'tok-leader';
const APPROVED_TOKEN = 'tok-approved';
const PENDING_TOKEN = 'tok-pending';
const TICKET = 'ticket-unico';

const PARTICIPANT_APPROVED = '11111111-1111-1111-1111-111111111111';
const PARTICIPANT_PENDING = '22222222-2222-2222-2222-222222222222';

let ticketUsed = false;
let resolveCalls = 0;

const identities = {
  [LEADER_TOKEN]: { userId: '99999999-9999-9999-9999-999999999999', participantId: null, isLeader: true, participantStatus: null },
  [APPROVED_TOKEN]: { participantId: PARTICIPANT_APPROVED, isLeader: false, participantStatus: 'approved', displayName: 'Diego', avatarIndex: 3 },
  [PENDING_TOKEN]: { participantId: PARTICIPANT_PENDING, isLeader: false, participantStatus: 'pending', displayName: 'Ana', avatarIndex: 1 },
};

const api = createServer((req, res) => {
  if (req.headers['x-service-token'] !== SERVICE_TOKEN) {
    res.writeHead(401).end('{}');
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    resolveCalls += 1;
    const { sessionToken, ticket, roomCode } = JSON.parse(body || '{}');

    let token = sessionToken;
    let fromTicket = false;
    if (ticket) {
      if (ticketUsed || ticket !== TICKET) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'UNAUTHENTICATED' }));
        return;
      }
      ticketUsed = true;
      fromTicket = true;
      token = APPROVED_TOKEN;
    }

    const identity = identities[token];
    if (!identity) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'UNAUTHENTICATED' }));
      return;
    }
    if (roomCode && roomCode !== ROOM) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'ROOM_NOT_FOUND' }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        userId: identity.userId ?? null,
        participantId: identity.participantId,
        roomCode: roomCode ?? null,
        isLeader: roomCode ? identity.isLeader : false,
        participantStatus: roomCode ? identity.participantStatus : null,
        displayName: identity.displayName ?? null,
        avatarIndex: identity.avatarIndex ?? null,
        sessionToken: fromTicket ? token : null,
      }),
    );
  });
});

await new Promise((r) => api.listen(API_PORT, r));

const service = spawn(process.execPath, ['dist/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(WS_PORT),
    API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
    API_SERVICE_TOKEN: SERVICE_TOKEN,
    REDIS_URL: '',
    REALTIME_ALLOWED_ORIGINS: 'http://localhost:3000',
    REALTIME_DEV_PUBLISH: '1',
    REALTIME_ROLE_CACHE_TTL_MS: '0',
    LOG_LEVEL: 'warn',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

await new Promise((r) => setTimeout(r, 900));

// Sem isto, "recusou a conexão" e "o serviço nem subiu" viram o mesmo PASS.
const boot = await fetch(`http://127.0.0.1:${WS_PORT}/health`).catch(() => null);
if (!boot || boot.status !== 200) {
  console.error('FALHOU: o serviço não subiu — todo o resto seria falso positivo.');
  service.kill();
  api.close();
  process.exit(1);
}

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

function open({ cookie, origin = 'http://localhost:3000' } = {}) {
  const headers = { origin };
  if (cookie) headers.cookie = `codex_session=${cookie}`;
  return new WebSocket(`ws://127.0.0.1:${WS_PORT}/realtime`, { headers });
}

function collect(ws, ms = 700) {
  const messages = [];
  ws.on('message', (d) => messages.push(JSON.parse(String(d))));
  return new Promise((r) => setTimeout(() => r(messages), ms));
}

async function publish(channel, event) {
  await fetch(`http://127.0.0.1:${WS_PORT}/dev/publish`, {
    method: 'POST',
    body: JSON.stringify({ roomCode: ROOM, channel, event }),
  });
}

try {
  /* 1. origem fora da allowlist não passa do upgrade ------------------------ */
  {
    const ws = open({ cookie: APPROVED_TOKEN, origin: 'https://site-malicioso.example' });
    const failed = await new Promise((r) => {
      ws.on('error', () => r(true));
      ws.on('open', () => r(false));
    });
    check('Origin fora da allowlist é recusada antes do upgrade', failed);
  }

  /* 2. cookie inválido não vira socket ------------------------------------- */
  {
    const ws = open({ cookie: 'tok-invalido' });
    const failed = await new Promise((r) => {
      ws.on('error', () => r(true));
      ws.on('open', () => r(false));
    });
    check('Cookie inválido é recusado antes do upgrade (§10)', failed);
  }

  /* 3. participante aprovado: ready + canais permitidos --------------------- */
  let approved;
  {
    approved = open({ cookie: APPROVED_TOKEN });
    await new Promise((r) => approved.on('open', r));
    const messages = collect(approved, 900);
    approved.send(JSON.stringify({ type: 'hello', v: 1, token: '', roomCode: ROOM }));
    approved.send(JSON.stringify({ type: 'subscribe', channels: [`room:${ROOM}`, `room:${ROOM}:match`, `participant:${PARTICIPANT_APPROVED}`] }));
    const got = await messages;
    const ready = got.find((m) => m.type === 'ready');
    check('hello devolve ready com participantId e isLeader', ready?.participantId === PARTICIPANT_APPROVED && ready.isLeader === false, JSON.stringify(ready));
    check('Aprovado assina room, match e o próprio canal privado sem erro', !got.some((m) => m.type === 'error'));
  }

  /* 4. canal de líder é negado a participante ------------------------------- */
  {
    const messages = collect(approved, 600);
    approved.send(JSON.stringify({ type: 'subscribe', channels: [`room:${ROOM}:leader`, `participant:${PARTICIPANT_PENDING}`] }));
    const got = await messages;
    const errors = got.filter((m) => m.type === 'error' && m.code === 'FORBIDDEN_CHANNEL');
    check('room:*:leader e canal privado alheio => FORBIDDEN_CHANNEL', errors.length === 2, `${errors.length} erro(s)`);
  }

  /* 5. pendente não entra no canal da sala ---------------------------------- */
  {
    const ws = open({ cookie: PENDING_TOKEN });
    await new Promise((r) => ws.on('open', r));
    const messages = collect(ws, 800);
    ws.send(JSON.stringify({ type: 'hello', v: 1, token: '', roomCode: ROOM }));
    ws.send(JSON.stringify({ type: 'subscribe', channels: [`room:${ROOM}`] }));
    const got = await messages;
    check('Participante pending não assina room:{code} (§3)', got.some((m) => m.type === 'error' && m.code === 'FORBIDDEN_CHANNEL'));
    ws.close();
  }

  /* 6. fan-out de evento publicado ------------------------------------------ */
  {
    const messages = collect(approved, 700);
    await publish(`room:${ROOM}`, { type: 'participant.joined', participant: { id: 'p_9', displayName: 'Ana' } });
    const got = await messages;
    check('Evento publicado chega ao assinante do canal', got.some((m) => m.type === 'participant.joined'));
  }

  /* 7. evento no canal errado é descartado ---------------------------------- */
  {
    const messages = collect(approved, 700);
    await publish(`room:${ROOM}`, { type: 'submission.graded', submission: { score: 100 } });
    const got = await messages;
    check('Evento individual publicado em canal coletivo é descartado', !got.some((m) => m.type === 'submission.graded'));
  }

  /* 8. throttle de phase.progress ------------------------------------------- */
  {
    const messages = collect(approved, 900);
    for (let i = 0; i < 10; i += 1) {
      await publish(`room:${ROOM}:match`, { type: 'phase.progress', phaseId: 'ph_1', submittedCount: i, totalPlayers: 28, readyCount: 0 });
    }
    const got = (await messages).filter((m) => m.type === 'phase.progress');
    const last = got.at(-1);
    check('phase.progress sai no máx. ~2x por segundo (§7)', got.length <= 3 && got.length >= 1, `${got.length} quadro(s)`);
    check('O último valor não se perde no throttle', last?.submittedCount === 9, `submittedCount=${last?.submittedCount}`);
  }

  /* 9. transição não é throttled -------------------------------------------- */
  {
    const messages = collect(approved, 500);
    await publish(`room:${ROOM}:match`, { type: 'phase.started', phaseNumber: 1, totalPhases: 8, endsAt: Date.now() + 45000, state: {} });
    await publish(`room:${ROOM}:match`, { type: 'phase.ended', phaseId: 'ph_1' });
    const got = await messages;
    check('phase.started e phase.ended saem imediatos', got.filter((m) => m.type.startsWith('phase.')).length === 2);
  }

  /* 10. ping/pong ------------------------------------------------------------ */
  {
    const messages = collect(approved, 400);
    const sentAt = Date.now();
    approved.send(JSON.stringify({ type: 'ping', sentAt }));
    const pong = (await messages).find((m) => m.type === 'pong');
    check('pong ecoa sentAt e traz serverTime (§6)', pong?.sentAt === sentAt && typeof pong.serverTime === 'number');
  }

  /* 11. líder recebe player.activity do aluno ------------------------------- */
  {
    const leader = open({ cookie: LEADER_TOKEN });
    await new Promise((r) => leader.on('open', r));
    const leaderMessages = collect(leader, 1200);
    leader.send(JSON.stringify({ type: 'hello', v: 1, token: '', roomCode: ROOM }));
    leader.send(JSON.stringify({ type: 'subscribe', channels: [`room:${ROOM}:leader`] }));
    await new Promise((r) => setTimeout(r, 300));

    const studentEcho = collect(approved, 800);
    approved.send(JSON.stringify({ type: 'activity', phaseId: 'ph_1', state: 'typing' }));

    const got = await leaderMessages;
    const activity = got.find((m) => m.type === 'player.activity');
    check('Líder assina room:*:leader', !got.some((m) => m.type === 'error'));
    check('activity do aluno chega ao líder com nome e avatar', activity?.participantId === PARTICIPANT_APPROVED && activity.name === 'Diego' && activity.avatarIndex === 3, JSON.stringify(activity));
    check('activity nunca é retransmitido ao próprio aluno (§7)', !(await studentEcho).some((m) => m.type === 'player.activity'));
    leader.close();
  }

  /* 12. expulsão fecha o socket --------------------------------------------- */
  {
    const closed = new Promise((r) => approved.on('close', (code) => r(code)));
    await publish(`participant:${PARTICIPANT_APPROVED}`, { type: 'participant.removed', reason: 'removed_by_leader' });
    const code = await Promise.race([closed, new Promise((r) => setTimeout(() => r(null), 800))]);
    check('participant.removed fecha o socket da pessoa (§10)', code !== null, `close=${code}`);
  }

  /* 13. versão de protocolo errada ------------------------------------------ */
  {
    const ws = open({ cookie: APPROVED_TOKEN });
    await new Promise((r) => ws.on('open', r));
    const messages = collect(ws, 500);
    ws.send(JSON.stringify({ type: 'hello', v: 99, token: '', roomCode: ROOM }));
    const got = await messages;
    check('v incompatível => PROTOCOL_VERSION e fecha', got.some((m) => m.type === 'error' && m.code === 'PROTOCOL_VERSION'));
  }

  /* 14. sala inexistente ----------------------------------------------------- */
  {
    const ws = open({ cookie: APPROVED_TOKEN });
    await new Promise((r) => ws.on('open', r));
    const messages = collect(ws, 600);
    ws.send(JSON.stringify({ type: 'hello', v: 1, token: '', roomCode: '000000' }));
    const got = await messages;
    check('roomCode desconhecido => ROOM_NOT_FOUND', got.some((m) => m.type === 'error' && m.code === 'ROOM_NOT_FOUND'));
  }

  /* 15. ticket sem cookie ---------------------------------------------------- */
  {
    const ws = open();
    await new Promise((r) => ws.on('open', r));
    const messages = collect(ws, 900);
    ws.send(JSON.stringify({ type: 'hello', v: 1, token: TICKET, roomCode: ROOM }));
    ws.send(JSON.stringify({ type: 'subscribe', channels: [`room:${ROOM}`] }));
    const got = await messages;
    check('Sem cookie, o ticket do hello autentica (§2)', got.some((m) => m.type === 'ready') && !got.some((m) => m.type === 'error'));
    ws.close();
  }

  /* 16. ticket é de uso único ------------------------------------------------ */
  {
    const ws = open();
    await new Promise((r) => ws.on('open', r));
    const messages = collect(ws, 700);
    ws.send(JSON.stringify({ type: 'hello', v: 1, token: TICKET, roomCode: ROOM }));
    const got = await messages;
    check('Reuso do ticket => UNAUTHENTICATED', got.some((m) => m.type === 'error' && m.code === 'UNAUTHENTICATED'));
  }

  /* 17. sem hello, o socket cai --------------------------------------------- */
  {
    const ws = open({ cookie: APPROVED_TOKEN });
    await new Promise((r) => ws.on('open', r));
    const closed = await new Promise((r) => {
      ws.on('close', () => r(true));
      setTimeout(() => r(false), 6500);
    });
    check('Socket sem hello é derrubado no timeout', closed);
  }

  /* 18. rate limit ----------------------------------------------------------- */
  {
    const ws = open({ cookie: APPROVED_TOKEN });
    await new Promise((r) => ws.on('open', r));
    const messages = collect(ws, 900);
    ws.send(JSON.stringify({ type: 'hello', v: 1, token: '', roomCode: ROOM }));
    await new Promise((r) => setTimeout(r, 250));
    for (let i = 0; i < 40; i += 1) ws.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
    const got = await messages;
    check('Mais de 20 msg/s => RATE_LIMITED (§10)', got.some((m) => m.type === 'error' && m.code === 'RATE_LIMITED'));
  }

  /* 19. quadro maior que 8 KB ------------------------------------------------ */
  {
    const ws = open({ cookie: APPROVED_TOKEN });
    await new Promise((r) => ws.on('open', r));
    const closed = new Promise((r) => ws.on('close', (code) => r(code)));
    ws.send(JSON.stringify({ type: 'ping', sentAt: Date.now(), pad: 'x'.repeat(9000) }));
    const code = await Promise.race([closed, new Promise((r) => setTimeout(() => r(null), 900))]);
    check('Quadro acima de 8 KB fecha com 1009 (§10)', code === 1009, `close=${code}`);
  }

  /* 20. health --------------------------------------------------------------- */
  {
    const res = await fetch(`http://127.0.0.1:${WS_PORT}/health`);
    const body = await res.json();
    check('/health responde ok com contadores', res.status === 200 && body.status === 'ok' && typeof body.connections === 'number', JSON.stringify(body));
  }

  /* 21. encerramento gracioso ------------------------------------------------ */
  // Pulado no Windows: `child.kill('SIGTERM')` termina o processo à força (o
  // Windows não tem sinais POSIX), então o handler de §9 nunca chega a rodar.
  // `shutdown.smoke.mjs` cobre o mesmo caminho chamando `shutdown()` direto.
  if (process.platform === 'win32') {
    console.log('PULADO  SIGTERM (§9) — coberto por shutdown.smoke.mjs neste sistema');
  } else {
    const ws = open({ cookie: APPROVED_TOKEN });
    await new Promise((r) => ws.on('open', r));
    const messages = [];
    ws.on('message', (d) => messages.push(JSON.parse(String(d))));
    const closed = new Promise((r) => ws.on('close', (code) => r(code)));
    ws.send(JSON.stringify({ type: 'hello', v: 1, token: '', roomCode: ROOM }));
    await new Promise((r) => setTimeout(r, 300));

    service.kill('SIGTERM');
    const code = await Promise.race([closed, new Promise((r) => setTimeout(() => r(null), 3000))]);
    check('SIGTERM manda RECONNECT e fecha com 1001 (§9)', messages.some((m) => m.type === 'error' && m.code === 'RECONNECT') && code === 1001, `close=${code}`);
  }

  console.log(`\nchamadas ao /internal/realtime/resolve: ${resolveCalls}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  service.kill();
  api.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
