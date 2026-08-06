/**
 * Servidor HTTP + upgrade de WebSocket.
 *
 * Duas coisas acontecem aqui e em nenhum outro lugar: a checagem de `Origin` e a
 * autenticacao **antes** do upgrade (§10: "Nunca aceite conexao para autenticar
 * depois"). Uma conexao que chega aqui sem credencial valida nunca chega a
 * existir como socket.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type WebSocket } from 'ws';

import type { Broker } from './broker.js';
import type { Config } from './config.js';
import { Connection, type ConnectionDeps } from './connection.js';
import { Hub } from './hub.js';
import type { Credential, IdentityResolver } from './identity.js';
import type { Logger } from './logger.js';

export interface RealtimeServerDeps {
  readonly config: Config;
  readonly logger: Logger;
  readonly broker: Broker;
  readonly resolver: IdentityResolver;
}

export class RealtimeServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly hub: Hub;
  private readonly connections = new Set<Connection>();
  private readonly connectionDeps: ConnectionDeps;
  private heartbeat: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(private readonly deps: RealtimeServerDeps) {
    this.hub = new Hub(deps.broker, deps.logger.child({ component: 'hub' }));
    this.connectionDeps = {
      config: deps.config,
      logger: deps.logger,
      hub: this.hub,
      broker: deps.broker,
      resolver: deps.resolver,
    };

    this.http = createServer((request, response) => this.onRequest(request, response));

    // `noServer`: o upgrade so acontece depois que a autenticacao passa.
    // `maxPayload` implementa o limite de quadro de §10 — o `ws` fecha com 1009
    // sozinho, sem o quadro chegar a ser montado na memoria do processo.
    this.wss = new WebSocketServer({ noServer: true, maxPayload: deps.config.maxFrameBytes });

    this.http.on('upgrade', (request, socket, head) => {
      void this.onUpgrade(request, socket, head);
    });
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.http.listen(this.deps.config.port, this.deps.config.host, resolve);
    });

    const period = Math.max(1_000, Math.floor(this.deps.config.idleTimeoutMs / 2));
    this.heartbeat = setInterval(() => this.sweep(), period);
    this.heartbeat.unref?.();

    this.deps.logger.info('servico de tempo real ouvindo', {
      port: this.deps.config.port,
      path: this.deps.config.path,
      broker: this.deps.config.redisUrl === null ? 'memory' : 'redis',
    });
  }

  /**
   * §9: ao receber SIGTERM, a instancia manda `{"type":"error","code":"RECONNECT"}`
   * e fecha com 1001. Os clientes reconectam no backoff e caem em outra
   * instancia. O upgrade passa a responder 503 antes disso, para nao aceitar
   * conexao que vai ser derrubada em seguida.
   */
  async shutdown(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    this.deps.logger.info('encerrando', { connections: this.connections.size });

    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    for (const connection of [...this.connections]) connection.drain();

    const deadline = Date.now() + this.deps.config.shutdownGraceMs;
    while (this.connections.size > 0 && Date.now() < deadline) {
      await delay(50);
    }

    this.hub.dispose();
    this.wss.close();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
    await this.deps.broker.close();
  }

  /* ---------------------------------------------------------------------- */
  /* HTTP                                                                    */
  /* ---------------------------------------------------------------------- */

  private onRequest(request: IncomingMessage, response: ServerResponse): void {
    if (request.method === 'GET' && request.url === '/health') {
      // Sem `x-service-token`: e a rota que o orquestrador chama, igual ao
      // /health da API .NET.
      json(response, this.draining ? 503 : 200, {
        status: this.draining ? 'draining' : 'ok',
        connections: this.connections.size,
        ...this.hub.stats,
        uptimeSeconds: Math.round(process.uptime()),
      });
      return;
    }

    if (this.deps.config.devPublishEnabled && request.method === 'POST' && request.url === '/dev/publish') {
      void this.onDevPublish(request, response);
      return;
    }

    json(response, 404, { error: 'not_found' });
  }

  /** Injeta um envelope no broker sem passar pela API. So fora de producao. */
  private async onDevPublish(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > 64 * 1024) {
        json(response, 413, { error: 'payload_too_large' });
        return;
      }
      chunks.push(chunk as Buffer);
    }

    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        roomCode?: string;
        channel?: string;
        event?: Record<string, unknown>;
      };

      if (typeof body.roomCode !== 'string' || typeof body.channel !== 'string' || body.event === undefined) {
        json(response, 400, { error: 'roomCode, channel e event sao obrigatorios' });
        return;
      }

      await this.deps.broker.publish(body.roomCode, {
        channel: body.channel,
        event: body.event as { type: string },
        publishedAt: Date.now(),
      });
      json(response, 202, { published: true });
    } catch (error) {
      json(response, 400, { error: (error as Error).message });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Upgrade                                                                 */
  /* ---------------------------------------------------------------------- */

  private async onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (this.draining) {
      reject(socket, 503, 'Service Unavailable');
      return;
    }

    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== this.deps.config.path) {
      reject(socket, 404, 'Not Found');
      return;
    }

    if (!this.originAllowed(request.headers.origin)) {
      this.deps.logger.warn('origin recusada', { origin: request.headers.origin });
      reject(socket, 403, 'Forbidden');
      return;
    }

    const cookie = readCookie(request.headers.cookie, this.deps.config.sessionCookieName);
    const credential: Credential | null = cookie === null ? null : { kind: 'session', value: cookie };

    // Com cookie: valida agora, antes do upgrade — o caso normal. Sem cookie: o
    // §2 preve o fallback de ticket, que so pode chegar no `hello`, ja dentro do
    // socket. Entao o upgrade acontece, mas a conexao nasce com um prazo
    // (`helloTimeoutMs`) para se identificar e nao pode assinar nada ate la.
    if (credential !== null) {
      const result = await this.deps.resolver.resolve(credential, null);
      if (!result.ok) {
        if (result.reason === 'unavailable') {
          reject(socket, 503, 'Service Unavailable');
        } else {
          reject(socket, 401, 'Unauthorized');
        }
        return;
      }
    }

    this.wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      this.accept(ws, credential);
    });
  }

  private accept(ws: WebSocket, cookieCredential: Credential | null): void {
    const connection = new Connection(
      {
        socket: ws,
        id: randomUUID(),
        cookieCredential,
        onClosed: (closed) => {
          this.connections.delete(closed);
        },
      },
      this.connectionDeps,
    );

    this.connections.add(connection);
  }

  private originAllowed(origin: string | undefined): boolean {
    const { allowedOrigins, isProduction } = this.deps.config;
    if (allowedOrigins.includes('*')) return true;

    // Sem `Origin` nao ha browser do outro lado, entao nao ha o ataque que a
    // allowlist existe para impedir (site terceiro abrindo socket com o cookie
    // da vitima). Em producao mesmo assim recusamos: e trafego que nao deveria
    // existir. Em dev, liberar deixa `wscat` funcionar.
    if (origin === undefined) return !isProduction;

    return allowedOrigins.includes(origin);
  }

  private sweep(): void {
    const now = Date.now();
    for (const connection of [...this.connections]) {
      if (!connection.checkAlive(now, this.deps.config.idleTimeoutMs)) {
        this.deps.logger.debug('socket ocioso derrubado', { conn: connection.id });
        connection.close(1001, 'idle_timeout');
      }
    }
  }
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;

    const value = part.slice(index + 1).trim();
    if (value.length === 0) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
