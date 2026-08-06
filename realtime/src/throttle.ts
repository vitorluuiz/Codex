/**
 * Throttling de fan-out (contract §7).
 *
 * "Eventos de transicao vao na hora; eventos de contador vao em lote." A
 * implementacao e leading + trailing edge: o primeiro evento da janela sai
 * imediatamente (uma barra de progresso que so comeca a subir depois de 500 ms
 * parece travada), e os que chegam durante a janela sao **colapsados no ultimo**
 * e emitidos quando a janela fecha. Colapsar e correto porque estes eventos
 * carregam estado absoluto, nao incremento: `submittedCount: 13` sobrescreve
 * `submittedCount: 12` sem perda.
 *
 * O throttle e por instancia, e isso basta: um socket vive em uma instancia so,
 * entao ninguem recebe mais de 1 evento por janela mesmo com N instancias.
 */

export interface ThrottleRule {
  /** Janela em ms. `0` = sem throttle. */
  readonly windowMs: number;
  /**
   * Sufixo que separa as filas dentro de um mesmo canal. `player.activity` usa
   * o participante: sem isso, um aluno digitando abafaria o sinal dos outros —
   * o painel do lider mostra uma linha por pessoa, nao uma so.
   */
  readonly keyBy?: readonly string[];
}

export const THROTTLE_RULES: Readonly<Record<string, ThrottleRule>> = {
  'phase.progress': { windowMs: 500 },
  'stats.updated': { windowMs: 1_000 },
  'player.activity': { windowMs: 1_000, keyBy: ['participantId'] },
};

export type Flush<T> = (value: T) => void;

interface Slot<T> {
  timer: NodeJS.Timeout;
  pending: T | null;
}

export class Throttler<T> {
  private readonly slots = new Map<string, Slot<T>>();

  constructor(private readonly flush: Flush<T>) {}

  /** @returns `true` se o valor saiu agora; `false` se ficou para o fim da janela. */
  submit(key: string, windowMs: number, value: T): boolean {
    if (windowMs <= 0) {
      this.flush(value);
      return true;
    }

    const existing = this.slots.get(key);
    if (existing !== undefined) {
      existing.pending = value;
      return false;
    }

    this.flush(value);
    this.slots.set(key, { timer: this.arm(key, windowMs), pending: null });
    return true;
  }

  /** Descarta o que estiver pendente para as chaves com este prefixo. */
  clearPrefix(prefix: string): void {
    for (const [key, slot] of this.slots) {
      if (!key.startsWith(prefix)) continue;
      clearTimeout(slot.timer);
      this.slots.delete(key);
    }
  }

  clear(): void {
    for (const slot of this.slots.values()) clearTimeout(slot.timer);
    this.slots.clear();
  }

  get size(): number {
    return this.slots.size;
  }

  private arm(key: string, windowMs: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      const slot = this.slots.get(key);
      if (slot === undefined) return;

      if (slot.pending === null) {
        // Janela fechou sem nada acumulado: some com a chave em vez de manter um
        // timer vivo por sala para sempre.
        this.slots.delete(key);
        return;
      }

      const value = slot.pending;
      slot.pending = null;
      slot.timer = this.arm(key, windowMs);
      this.flush(value);
    }, windowMs);

    // Nao segura o event loop: um throttle pendente nao pode adiar o shutdown.
    timer.unref?.();
    return timer;
  }
}

export function throttleKey(channel: string, event: Record<string, unknown>): {
  key: string;
  windowMs: number;
} {
  const type = String(event.type);
  const rule = THROTTLE_RULES[type];
  if (rule === undefined) return { key: `${channel}|${type}`, windowMs: 0 };

  const discriminators = (rule.keyBy ?? []).map((field) => String(event[field] ?? '')).join('|');
  return {
    key: discriminators.length > 0 ? `${channel}|${type}|${discriminators}` : `${channel}|${type}`,
    windowMs: rule.windowMs,
  };
}
