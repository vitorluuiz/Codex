/**
 * Uma conexao. Toda a maquina de estados do §4 mora aqui: `hello`, `subscribe`,
 * `unsubscribe`, `ping`, `activity` — e nada mais. "Responder uma pergunta,
 * avancar de fase, pausar a sala — tudo isso e HTTP."
 */

import type { WebSocket } from 'ws';

import type { Broker } from './broker.js';
import { canSubscribe, channelNames, parseChannel } from './channels.js';
import type { Config } from './config.js';
import type { Credential, Identity, IdentityResolver, ResolveResult } from './identity.js';
import type { Hub, Subscriber } from './hub.js';
import type { Logger } from './logger.js';
import {
  CLOSE_CODES,
  PROTOCOL_VERSION,
  type ErrorMessage,
  type RealtimeErrorCode,
  type ServerMessage,
} from './protocol.js';

/**
 * Teto de canais por socket. O contrato nao fixa um numero, mas os canais uteis
 * a uma conexao sao no maximo quatro (§3) — um cliente pedindo dezenas so pode
 * estar tentando inflar a tabela de fan-out da instancia.
 */
const MAX_CHANNELS_PER_CONNECTION = 16;

/** Quantos quadros aceitar enquanto o `hello` ainda esta sendo resolvido. */
const MAX_QUEUED_WHILE_AUTHENTICATING = 8;

/** §7: o `activity` e descartado se chegar mais rapido que o throttle. */
const ACTIVITY_MIN_INTERVAL_MS = 1_000;

const ROOM_CODE = /^[0-9]{6}$/;

type State = 'awaiting-hello' | 'authenticating' | 'ready' | 'closing';

export interface ConnectionDeps {
  readonly config: Config;
  readonly logger: Logger;
  readonly hub: Hub;
  readonly broker: Broker;
  readonly resolver: IdentityResolver;
}

export interface ConnectionOptions {
  readonly socket: WebSocket;
  readonly id: string;
  /** Cookie `codex_session` lido no handshake, quando o browser o mandou. */
  readonly cookieCredential: Credential | null;
  readonly onClosed: (connection: Connection) => void;
}

export class Connection implements Subscriber {
  readonly id: string;

  private readonly socket: WebSocket;
  private readonly deps: ConnectionDeps;
  private readonly logger: Logger;
  private readonly onClosed: (connection: Connection) => void;

  private state: State = 'awaiting-hello';
  private identity: Identity | null = null;
  private roomCode: string | null = null;
  /**
   * Credencial usada para reler o papel a cada `subscribe`. Comeca como o
   * cookie; se a conexao entrou por ticket, vira o token de sessao que a API
   * devolveu ao consumi-lo — um ticket e de uso unico e nao serve para reler.
   */
  private credential: Credential | null;

  private readonly queued: string[] = [];
  private helloTimer: NodeJS.Timeout | null = null;
  private lastSeenAt = Date.now();
  private lastActivityAt = 0;

  // Token bucket do rate limit de §10 (20 msg/s por conexao).
  private tokens: number;
  private tokensUpdatedAt = Date.now();

  constructor(options: ConnectionOptions, deps: ConnectionDeps) {
    this.id = options.id;
    this.socket = options.socket;
    this.deps = deps;
    this.credential = options.cookieCredential;
    this.onClosed = options.onClosed;
    this.logger = deps.logger.child({ conn: this.id });
    this.tokens = deps.config.rateLimitMessagesPerSecond;

    this.socket.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    this.socket.on('close', () => this.onSocketClosed());
    this.socket.on('error', (error: Error) => {
      this.logger.debug('erro de socket', { error: error.message });
      this.socket.terminate();
    });
    this.socket.on('pong', () => {
      this.lastSeenAt = Date.now();
    });

    // Sem `hello` nao ha sala nem papel: uma conexao muda nao pode ficar
    // ocupando slot indefinidamente.
    this.helloTimer = setTimeout(() => {
      if (this.state === 'awaiting-hello') {
        this.fail('UNAUTHENTICATED', 'O quadro `hello` nao chegou a tempo.');
      }
    }, deps.config.helloTimeoutMs);
    this.helloTimer.unref?.();
  }

  /* ---------------------------------------------------------------------- */
  /* Subscriber                                                              */
  /* ---------------------------------------------------------------------- */

  sendRaw(payload: string): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(payload);
  }

  close(code: number, reason: string): void {
    if (this.state === 'closing') return;
    this.state = 'closing';
    this.socket.close(code, reason);
  }

  /* ---------------------------------------------------------------------- */
  /* Ciclo de vida                                                           */
  /* ---------------------------------------------------------------------- */

  /** Chamado pelo heartbeat do servidor. `false` = socket morto, derrubar. */
  checkAlive(now: number, timeoutMs: number): boolean {
    if (now - this.lastSeenAt > timeoutMs) return false;
    if (this.socket.readyState === this.socket.OPEN) this.socket.ping();
    return true;
  }

  /** §9: encerramento gracioso — o cliente reconecta e cai em outra instancia. */
  drain(): void {
    this.send({ type: 'error', code: 'RECONNECT', message: 'Instancia encerrando; reconecte.' } satisfies ErrorMessage);
    this.close(CLOSE_CODES.goingAway, 'server_shutdown');
  }

  private onSocketClosed(): void {
    this.state = 'closing';
    if (this.helloTimer !== null) clearTimeout(this.helloTimer);
    this.deps.hub.removeAll(this);
    this.onClosed(this);
  }

  /* ---------------------------------------------------------------------- */
  /* Entrada                                                                 */
  /* ---------------------------------------------------------------------- */

  private onMessage(data: unknown, isBinary: boolean): void {
    if (this.state === 'closing') return;
    this.lastSeenAt = Date.now();

    if (!this.spendToken()) {
      this.fail('RATE_LIMITED', 'Limite de mensagens por segundo excedido.');
      return;
    }

    // O protocolo e JSON em quadros de texto. Binario nao existe no §4 — nem
    // como erro; e so descartado, ja tendo custado uma ficha do rate limit.
    if (isBinary) return;

    const text = String(data);

    // `subscribe` chega junto com `hello` (o RealtimeProvider manda os dois no
    // mesmo `onopen`, sem esperar o `ready`), mas resolver o `hello` e uma ida
    // a API. Enfileirar aqui e o que evita recusar uma assinatura legitima por
    // uma corrida que o proprio cliente de referencia produz.
    if (this.state === 'authenticating') {
      if (this.queued.length < MAX_QUEUED_WHILE_AUTHENTICATING) this.queued.push(text);
      return;
    }

    this.dispatch(text);
  }

  private dispatch(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.debug('quadro nao e JSON');
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) return;
    const message = parsed as Record<string, unknown>;

    switch (message.type) {
      case 'hello':
        void this.onHello(message);
        return;
      case 'subscribe':
        void this.onSubscribe(message, true);
        return;
      case 'unsubscribe':
        void this.onSubscribe(message, false);
        return;
      case 'ping':
        this.onPing(message);
        return;
      case 'activity':
        this.onActivity(message);
        return;
      default:
        // "Nenhuma outra mensagem do cliente e aceita." Descartar em silencio e
        // deliberado: responder erro daria a um cliente hostil um canal barato
        // para gerar trafego de volta.
        this.logger.debug('tipo de mensagem ignorado', { type: String(message.type) });
    }
  }

  private async onHello(message: Record<string, unknown>): Promise<void> {
    if (this.state !== 'awaiting-hello') return;

    if (message.v !== PROTOCOL_VERSION) {
      this.fail('PROTOCOL_VERSION', `Este servidor fala a versao ${PROTOCOL_VERSION} do protocolo.`);
      return;
    }

    const roomCode = typeof message.roomCode === 'string' ? message.roomCode.trim() : '';
    if (!ROOM_CODE.test(roomCode)) {
      // Mesmo code que sala inexistente, pelo mesmo motivo do `RoomAccessService`
      // da API: nao dar sinal diferente entre "malformado" e "nao existe".
      this.fail('ROOM_NOT_FOUND', 'Sala nao encontrada.');
      return;
    }

    const ticket = typeof message.token === 'string' && message.token.length > 0 ? message.token : null;
    const credential: Credential | null =
      ticket !== null ? { kind: 'ticket', value: ticket } : this.credential;

    if (credential === null) {
      this.fail('UNAUTHENTICATED', 'Sessao ausente: nem cookie no handshake, nem ticket no hello.');
      return;
    }

    this.state = 'authenticating';
    const result = await this.deps.resolver.resolve(credential, roomCode);

    if (this.state !== 'authenticating') return; // fechou no meio da resolucao
    if (!this.acceptIdentity(result)) return;

    this.roomCode = roomCode;

    // Ticket e de uso unico: guardar o token de sessao que a API devolveu ao
    // consumi-lo e o que permite reler o papel nos `subscribe` seguintes.
    const sessionToken = this.identity!.sessionToken;
    this.credential =
      sessionToken !== null
        ? { kind: 'session', value: sessionToken }
        : credential.kind === 'session'
          ? credential
          : null;

    if (this.helloTimer !== null) {
      clearTimeout(this.helloTimer);
      this.helloTimer = null;
    }

    this.state = 'ready';
    const identity = this.identity!;

    this.send({
      type: 'ready',
      v: PROTOCOL_VERSION,
      participantId: identity.participantId,
      isLeader: identity.isLeader,
      serverTime: Date.now(),
    });

    this.logger.debug('conexao pronta', {
      roomCode,
      isLeader: identity.isLeader,
      status: identity.participantStatus,
    });

    const backlog = this.queued.splice(0, this.queued.length);
    for (const text of backlog) this.dispatch(text);
  }

  private acceptIdentity(result: ResolveResult): boolean {
    if (result.ok) {
      this.identity = result.identity;
      return true;
    }

    switch (result.reason) {
      case 'room-not-found':
        this.fail('ROOM_NOT_FOUND', 'Sala nao encontrada.');
        return false;
      case 'unavailable':
        // Nao e "sua credencial e invalida" — e "nao consegui perguntar". O
        // cliente reconecta no backoff de §8 e tenta de novo.
        this.fail('RECONNECT', 'Nao foi possivel validar a sessao agora.');
        return false;
      case 'unauthenticated':
      default:
        this.fail('UNAUTHENTICATED', 'Sessao invalida ou expirada.');
        return false;
    }
  }

  private async onSubscribe(message: Record<string, unknown>, subscribing: boolean): Promise<void> {
    if (this.state !== 'ready' || this.roomCode === null) return;

    const requested = Array.isArray(message.channels) ? message.channels : [];
    if (requested.length === 0) return;

    if (!subscribing) {
      for (const raw of requested) {
        const channel = parseChannel(raw);
        if (channel !== null) this.deps.hub.remove(this, channel.raw);
      }
      return;
    }

    // §10: "Autorizacao por canal a cada subscribe, sempre relendo o papel do
    // banco — nao confie no isLeader que voce mandou no ready cinco minutos
    // atras (o lider pode ter mudado)." Uma releitura por quadro `subscribe`,
    // nao por canal: e o mesmo instante logico. `roleCacheTtlMs` (1 s) absorve
    // rajadas sem esticar a janela de um papel obsoleto.
    const identity = await this.currentIdentity();
    if (identity === null || this.state !== 'ready') return;

    for (const raw of requested) {
      const channel = parseChannel(raw);
      if (channel === null || !canSubscribe(channel, identity)) {
        this.send({
          type: 'error',
          code: 'FORBIDDEN_CHANNEL',
          message: `Canal indisponivel para esta sessao: ${String(raw)}`,
        });
        continue;
      }

      if (this.deps.hub.channelsOf(this).length >= MAX_CHANNELS_PER_CONNECTION) {
        this.fail('RATE_LIMITED', 'Canais demais para uma conexao.');
        return;
      }

      this.deps.hub.add(this, channel.raw, this.roomCode);
    }
  }

  private onPing(message: Record<string, unknown>): void {
    const sentAt = typeof message.sentAt === 'number' ? message.sentAt : 0;
    // §6: o par `sentAt`/`serverTime` e o que da ao cliente o offset de relogio.
    // Por isso responde mesmo antes do `ready` — medir latencia nao depende de
    // saber quem e.
    this.send({ type: 'pong', sentAt, serverTime: Date.now() });
  }

  private onActivity(message: Record<string, unknown>): void {
    if (this.state !== 'ready' || this.roomCode === null) return;

    const identity = this.identity;
    // Sinal de aluno. O lider nao "digita" — e ele quem le o painel.
    if (identity === null || identity.participantId === null || !identity.isApprovedParticipant) return;

    const state = message.state;
    if (state !== 'typing' && state !== 'idle') return;
    if (typeof message.phaseId !== 'string') return;

    const now = Date.now();
    if (now - this.lastActivityAt < ACTIVITY_MIN_INTERVAL_MS) return;
    this.lastActivityAt = now;

    // Vai pelo broker, nao direto ao hub local: o lider pode estar conectado em
    // outra instancia. E o unico caso em que este servico publica — e mesmo
    // assim nada e gravado (§1: "efemero por natureza e nao vale uma escrita").
    void this.deps.broker
      .publish(this.roomCode, {
        channel: channelNames.leader(this.roomCode),
        event: {
          type: 'player.activity',
          participantId: identity.participantId,
          name: identity.displayName ?? '',
          avatarIndex: identity.avatarIndex ?? 0,
          state,
        },
        publishedAt: now,
      })
      .catch((error: Error) => this.logger.debug('activity nao publicada', { error: error.message }));
  }

  /* ---------------------------------------------------------------------- */
  /* Auxiliares                                                              */
  /* ---------------------------------------------------------------------- */

  private async currentIdentity(): Promise<Identity | null> {
    if (this.credential === null || this.roomCode === null) return this.identity;

    const result = await this.deps.resolver.resolve(this.credential, this.roomCode);
    if (!result.ok) {
      // Papel sumiu no meio da sessao (expulso, sessao expirada): derruba, em
      // vez de continuar servindo com o papel antigo.
      if (result.reason !== 'unavailable') {
        this.fail('UNAUTHENTICATED', 'Sessao invalida ou expirada.');
        return null;
      }
      return this.identity;
    }

    this.identity = result.identity;
    return result.identity;
  }

  private spendToken(): boolean {
    const now = Date.now();
    const capacity = this.deps.config.rateLimitMessagesPerSecond;
    this.tokens = Math.min(capacity, this.tokens + ((now - this.tokensUpdatedAt) * capacity) / 1_000);
    this.tokensUpdatedAt = now;

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private send(message: ServerMessage): void {
    this.sendRaw(JSON.stringify(message));
  }

  private fail(code: RealtimeErrorCode, message: string): void {
    this.send({ type: 'error', code, message } satisfies ErrorMessage);
    this.close(code === 'RECONNECT' ? CLOSE_CODES.goingAway : CLOSE_CODES.policyViolation, code);
  }
}
