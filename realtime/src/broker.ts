/**
 * Broker de eventos (contract §9). E ele que torna o servico horizontalmente
 * escalavel: cada instancia guarda so `socket -> canais` na memoria e recebe
 * todos os eventos daqui, entao ligar e desligar instancia nao move estado
 * nenhum e o load balancer nao precisa de afinidade de sessao.
 *
 * Escolha: Redis Pub/Sub, como o contrato indica para comecar.
 *
 * Um canal Redis **por sala** (`codex:rt:room:{code}`), nao um canal global:
 * com canal global toda instancia recebe todo evento de todas as salas e
 * descarta o que nao interessa — o custo de rede cresce com
 * `salas x instancias`. Assinando por sala, uma instancia so recebe trafego das
 * salas que ela de fato atende. O canal logico de destino (`room:x:leader`,
 * `participant:y`) viaja **dentro** do envelope; e ele que decide o fan-out.
 */

import { EventEmitter } from 'node:events';

import { Redis } from 'ioredis';

import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { RealtimeEvent } from './protocol.js';

/** O que a API .NET publica. Ver `RealtimeEventPublisher.cs`. */
export interface Envelope {
  /** Canal logico do contrato §3: `room:482913`, `participant:{guid}`, ... */
  readonly channel: string;
  readonly event: RealtimeEvent;
  readonly publishedAt?: number;
}

export type EnvelopeHandler = (envelope: Envelope, roomCode: string) => void;

export interface Broker {
  /** Idempotente: chamada quando a sala ganha o primeiro assinante local. */
  subscribeRoom(roomCode: string): Promise<void>;
  /** Idempotente: chamada quando o ultimo assinante local sai. */
  unsubscribeRoom(roomCode: string): Promise<void>;
  onEnvelope(handler: EnvelopeHandler): void;
  /** So o broker em memoria usa isto (rota `/dev/publish`). */
  publish(roomCode: string, envelope: Envelope): Promise<void>;
  close(): Promise<void>;
}

export function createBroker(config: Config, logger: Logger): Broker {
  return config.redisUrl === null
    ? new InMemoryBroker(logger)
    : new RedisBroker(config, logger.child({ component: 'broker' }));
}

function roomChannel(prefix: string, roomCode: string): string {
  return `${prefix}room:${roomCode}`;
}

class RedisBroker implements Broker {
  private readonly subscriber: Redis;
  private readonly publisher: Redis;
  private readonly handlers: EnvelopeHandler[] = [];
  private readonly subscribed = new Set<string>();
  private closing = false;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
    const url = config.redisUrl!;

    // `maxRetriesPerRequest: null` deixa o ioredis reconectar indefinidamente em
    // vez de estourar os comandos pendentes: uma queda do Redis degrada o
    // tempo real (nenhum evento chega) mas nao derruba os sockets — os clientes
    // continuam vendo a tela e agindo por HTTP, que e o modo de falha que §8
    // descreve.
    this.subscriber = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null });
    this.publisher = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null });

    this.subscriber.on('message', (channel: string, payload: string) => this.dispatch(channel, payload));
    this.subscriber.on('error', (error: Error) => this.logger.error('redis subscriber', { error: error.message }));
    this.publisher.on('error', (error: Error) => this.logger.error('redis publisher', { error: error.message }));

    // Reconexao do Redis limpa as assinaturas do lado servidor. Sem isto, a
    // instancia volta "conectada" e muda, com todos os sockets abertos.
    this.subscriber.on('ready', () => {
      const rooms = [...this.subscribed];
      if (rooms.length === 0) return;
      this.logger.info('reassinando salas apos reconexao', { rooms: rooms.length });
      void this.subscriber
        .subscribe(...rooms.map((room) => roomChannel(this.config.redisChannelPrefix, room)))
        .catch((error: Error) => this.logger.error('falha ao reassinar', { error: error.message }));
    });
  }

  async subscribeRoom(roomCode: string): Promise<void> {
    if (this.closing || this.subscribed.has(roomCode)) return;
    this.subscribed.add(roomCode);
    try {
      await this.subscriber.subscribe(roomChannel(this.config.redisChannelPrefix, roomCode));
      this.logger.debug('sala assinada no broker', { roomCode });
    } catch (error) {
      this.subscribed.delete(roomCode);
      this.logger.error('falha ao assinar sala', { roomCode, error: (error as Error).message });
    }
  }

  async unsubscribeRoom(roomCode: string): Promise<void> {
    if (!this.subscribed.delete(roomCode)) return;
    try {
      await this.subscriber.unsubscribe(roomChannel(this.config.redisChannelPrefix, roomCode));
      this.logger.debug('sala liberada no broker', { roomCode });
    } catch (error) {
      this.logger.error('falha ao desassinar sala', { roomCode, error: (error as Error).message });
    }
  }

  onEnvelope(handler: EnvelopeHandler): void {
    this.handlers.push(handler);
  }

  async publish(roomCode: string, envelope: Envelope): Promise<void> {
    await this.publisher.publish(
      roomChannel(this.config.redisChannelPrefix, roomCode),
      JSON.stringify(envelope),
    );
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([this.subscriber.quit(), this.publisher.quit()]);
  }

  private dispatch(channel: string, payload: string): void {
    const roomCode = channel.slice(`${this.config.redisChannelPrefix}room:`.length);
    const envelope = parseEnvelope(payload, this.logger);
    if (envelope === null) return;
    for (const handler of this.handlers) handler(envelope, roomCode);
  }
}

/**
 * Fallback de desenvolvimento: uma instancia so, sem Redis. Existe para que
 * `npm start` funcione sem infra, e `config.ts` recusa este modo em producao —
 * com ele, duas instancias nao trocam evento nenhum.
 */
class InMemoryBroker implements Broker {
  private readonly bus = new EventEmitter();
  private readonly handlers: EnvelopeHandler[] = [];
  private readonly subscribed = new Set<string>();

  constructor(private readonly logger: Logger) {
    this.bus.setMaxListeners(0);
    this.logger.warn('REDIS_URL nao configurada: broker em memoria, valido para UMA instancia');
  }

  async subscribeRoom(roomCode: string): Promise<void> {
    this.subscribed.add(roomCode);
  }

  async unsubscribeRoom(roomCode: string): Promise<void> {
    this.subscribed.delete(roomCode);
  }

  onEnvelope(handler: EnvelopeHandler): void {
    this.handlers.push(handler);
  }

  async publish(roomCode: string, envelope: Envelope): Promise<void> {
    if (!this.subscribed.has(roomCode)) return;
    for (const handler of this.handlers) handler(envelope, roomCode);
  }

  async close(): Promise<void> {
    this.bus.removeAllListeners();
  }
}

function parseEnvelope(payload: string, logger: Logger): Envelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    logger.warn('envelope nao e JSON valido', { bytes: payload.length });
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Partial<Envelope>;

  if (typeof candidate.channel !== 'string' || candidate.channel.length === 0) {
    logger.warn('envelope sem canal');
    return null;
  }

  const event = candidate.event;
  if (typeof event !== 'object' || event === null || typeof (event as RealtimeEvent).type !== 'string') {
    logger.warn('envelope sem evento tipado', { channel: candidate.channel });
    return null;
  }

  return { channel: candidate.channel, event: event as RealtimeEvent, publishedAt: candidate.publishedAt };
}
