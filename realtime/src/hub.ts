/**
 * O registro `canal -> sockets` desta instancia e o fan-out.
 *
 * E o unico estado que o servico guarda, e ele e descartavel: se a instancia
 * morre, os clientes reconectam em outra e reassinam (contract §8/§9). Nada
 * aqui precisa sobreviver a um restart.
 */

import { isEventAllowedOnChannel, parseChannel } from './channels.js';
import type { Broker, Envelope } from './broker.js';
import type { Logger } from './logger.js';
import { CLOSE_CODES, type RealtimeEvent } from './protocol.js';
import { Throttler, throttleKey } from './throttle.js';

export interface Subscriber {
  readonly id: string;
  /** Recebe o quadro ja serializado — ver `Delivery` abaixo. */
  sendRaw(payload: string): void;
  close(code: number, reason: string): void;
}

interface Delivery {
  readonly channel: string;
  readonly event: RealtimeEvent;
}

export class Hub {
  private readonly channels = new Map<string, Set<Subscriber>>();
  /** Quantas assinaturas locais existem por sala — refcount do broker. */
  private readonly roomRefs = new Map<string, number>();
  /** Por assinante: canal -> sala, para decrementar certo no disconnect. */
  private readonly bySubscriber = new Map<Subscriber, Map<string, string>>();
  private readonly throttler: Throttler<Delivery>;

  constructor(
    private readonly broker: Broker,
    private readonly logger: Logger,
  ) {
    this.throttler = new Throttler<Delivery>((delivery) => this.flush(delivery));
    this.broker.onEnvelope((envelope) => this.receive(envelope));
  }

  /**
   * `roomCode` e a sala **da conexao**, nao a do canal: `participant:{id}` nao
   * traz sala no nome, mas o evento dele e publicado no canal Redis da sala em
   * que a pessoa esta. Sem amarrar os dois, o socket de um participante nunca
   * receberia a propria correcao.
   */
  add(subscriber: Subscriber, channel: string, roomCode: string): void {
    let set = this.channels.get(channel);
    if (set === undefined) {
      set = new Set();
      this.channels.set(channel, set);
    }
    if (set.has(subscriber)) return;
    set.add(subscriber);

    let owned = this.bySubscriber.get(subscriber);
    if (owned === undefined) {
      owned = new Map();
      this.bySubscriber.set(subscriber, owned);
    }
    owned.set(channel, roomCode);

    this.retainRoom(roomCode);
  }

  remove(subscriber: Subscriber, channel: string): void {
    const owned = this.bySubscriber.get(subscriber);
    const roomCode = owned?.get(channel);
    if (owned === undefined || roomCode === undefined) return;

    owned.delete(channel);
    if (owned.size === 0) this.bySubscriber.delete(subscriber);

    const set = this.channels.get(channel);
    if (set !== undefined) {
      set.delete(subscriber);
      if (set.size === 0) {
        this.channels.delete(channel);
        this.throttler.flushPrefix(`${channel}|`);
      }
    }

    this.releaseRoom(roomCode);
  }

  removeAll(subscriber: Subscriber): void {
    const owned = this.bySubscriber.get(subscriber);
    if (owned === undefined) return;
    for (const channel of [...owned.keys()]) this.remove(subscriber, channel);
    this.bySubscriber.delete(subscriber);
  }

  channelsOf(subscriber: Subscriber): string[] {
    return [...(this.bySubscriber.get(subscriber)?.keys() ?? [])];
  }

  get stats(): { channels: number; rooms: number; subscribers: number; pendingThrottles: number } {
    return {
      channels: this.channels.size,
      rooms: this.roomRefs.size,
      subscribers: this.bySubscriber.size,
      pendingThrottles: this.throttler.size,
    };
  }

  dispose(): void {
    this.throttler.clear();
  }

  private receive(envelope: Envelope): void {
    const channel = parseChannel(envelope.channel);
    if (channel === null) {
      this.logger.warn('envelope com canal invalido', { channel: envelope.channel });
      return;
    }

    // §3 ao contrario: um publicador que erre o canal nao vaza dado individual
    // num canal coletivo. Descartar e mais seguro que entregar "por garantia".
    if (!isEventAllowedOnChannel(channel.kind, envelope.event.type)) {
      this.logger.warn('evento recusado no canal', {
        channel: channel.raw,
        kind: channel.kind,
        event: envelope.event.type,
      });
      return;
    }

    // Eventos terminais de fase ou partida: descarrega qualquer atualização pendente
    // de contadores ou métricas antes de entregar o encerramento.
    if (envelope.event.type === 'phase.ended' || envelope.event.type === 'match.finished') {
      this.throttler.flushPrefix(`room:${channel.roomCode}:`);
    }

    // Sem assinante local: nao vale nem serializar. Acontece o tempo todo — a
    // instancia assina a sala inteira, mas pode nao ter ninguem no `:leader`.
    if (!this.channels.has(channel.raw)) return;

    const { key, windowMs } = throttleKey(channel.raw, envelope.event);
    this.throttler.submit(key, windowMs, { channel: channel.raw, event: envelope.event });
  }

  private flush(delivery: Delivery): void {
    const set = this.channels.get(delivery.channel);
    if (set === undefined || set.size === 0) return;

    // Serializa uma vez para os N sockets do canal. Numa sala de 30 pessoas isso
    // e a diferenca entre 1 e 30 `JSON.stringify` por evento.
    const payload = JSON.stringify(delivery.event);
    for (const subscriber of set) subscriber.sendRaw(payload);

    // §10: "Ao expulsar alguem, feche o socket dele alem de publicar
    // participant.removed. So mandar o evento deixa a conexao viva recebendo
    // eventos da sala."
    if (delivery.event.type === 'participant.removed') {
      for (const subscriber of [...set]) {
        subscriber.close(CLOSE_CODES.policyViolation, 'removed_by_leader');
      }
    }
  }

  private retainRoom(roomCode: string): void {
    const next = (this.roomRefs.get(roomCode) ?? 0) + 1;
    this.roomRefs.set(roomCode, next);
    if (next === 1) {
      void this.broker.subscribeRoom(roomCode);
    }
  }

  private releaseRoom(roomCode: string): void {
    const current = this.roomRefs.get(roomCode);
    if (current === undefined) return;

    if (current <= 1) {
      this.roomRefs.delete(roomCode);
      void this.broker.unsubscribeRoom(roomCode);
      return;
    }
    this.roomRefs.set(roomCode, current - 1);
  }
}
