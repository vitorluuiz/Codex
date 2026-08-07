'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  PROTOCOL_VERSION,
  type Channel,
  type ClientMessage,
  type ServerMessage,
} from './protocol';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

type Listener = (message: ServerMessage) => void;

interface RealtimeContextValue {
  state: ConnectionState;
  /** Diferença entre o relógio do servidor e o local, em ms. */
  clockOffset: number;
  send: (message: ClientMessage) => void;
  subscribe: (listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

const RECONNECT_STEPS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];
const PING_INTERVAL_MS = 20_000;

/** Jitter de §8: sem ele, 30 alunos reconectam no mesmo milissegundo. */
function withJitter(delay: number): number {
  return Math.round(delay * (0.7 + Math.random() * 0.6));
}

/**
 * Fallback do §2: quando o cookie não viaja no handshake (iframe, ITP do
 * Safari), a sessão vai no campo `token` do `hello`. O ticket é de uso único e
 * vale 30 s, então é buscado imediatamente antes de cada tentativa — nunca
 * guardado entre reconexões.
 */
async function fetchTicket(): Promise<string | null> {
  try {
    const response = await fetch('/api/realtime-ticket', { method: 'POST', cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { ticket?: string };
    return body.ticket ?? null;
  } catch {
    return null;
  }
}

interface RealtimeProviderProps {
  roomCode: string;
  channels: Channel[];
  children: ReactNode;
}

/**
 * Mantém um único socket por aba e reentrega as mensagens aos hooks.
 *
 * Reconexão: backoff exponencial com teto. Ao reabrir, o `hello` é reenviado e
 * o servidor responde com o estado corrente da fase, então não há necessidade
 * de replay de eventos perdidos.
 */
export function RealtimeProvider({ roomCode, channels, children }: RealtimeProviderProps) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [clockOffset, setClockOffset] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Set<Listener>());
  const attemptRef = useRef(0);
  const channelsKey = channels.join('|');

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_REALTIME_URL;
    if (!url) {
      setState('closed');
      return;
    }

    /**
     * Encerramento desta execução do efeito. Precisa ser local, não um ref
     * compartilhado: o cleanup roda enquanto o socket antigo ainda está
     * fechando, e um ref seria zerado pela execução seguinte antes do `onclose`
     * do socket velho chegar. Ele então se veria como queda espontânea, entraria
     * no backoff e reabriria — dois sockets vivos alimentando o mesmo conjunto
     * de listeners, ou seja, todo evento entregue duas vezes. Em StrictMode isso
     * acontece em toda montagem.
     */
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    /** Chegou a receber `ready` nesta tentativa? Decide se o ticket é preciso. */
    let ready = false;
    /** Último `error` desta tentativa — nem toda falha se resolve com ticket. */
    let lastErrorCode: string | null = null;
    /** Ligado quando um socket morre antes do `ready` por falta de sessão. */
    let needsTicket = false;
    /**
     * O servidor mandou `participant.removed`: esta sala acabou para esta
     * pessoa. Sobrevive às tentativas porque o efeito não é remontado — quem
     * navega para fora é a tela, e até isso acontecer o backoff já teria
     * reaberto o socket pelo menos uma vez.
     */
    let removed = false;

    async function connect() {
      setState(attemptRef.current === 0 ? 'connecting' : 'reconnecting');
      ready = false;
      lastErrorCode = null;

      // Buscado antes de abrir o socket porque o `hello` é o primeiro quadro e
      // não há como esperar por uma promessa no meio do `onopen`.
      const ticket = needsTicket ? await fetchTicket() : null;
      if (disposed) return;

      const socket = new WebSocket(url!);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          socket.close();
          return;
        }
        attemptRef.current = 0;
        setState('open');

        // No caminho normal o token real viaja no cookie httpOnly e este campo
        // vai vazio; o servidor lê o cookie do handshake e nem chega a aceitar a
        // conexão se ele não valer (§10).
        socket.send(
          JSON.stringify({
            type: 'hello',
            v: PROTOCOL_VERSION,
            token: ticket ?? '',
            roomCode,
          } satisfies ClientMessage),
        );
        socket.send(
          JSON.stringify({
            type: 'subscribe',
            channels: channelsKey.split('|') as Channel[],
          } satisfies ClientMessage),
        );

        pingTimer = setInterval(() => {
          socket.send(JSON.stringify({ type: 'ping', sentAt: Date.now() } satisfies ClientMessage));
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        if (disposed) return;

        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }

        if (message.type === 'pong' || message.type === 'ready') {
          // Estimativa simples de offset: assume latência simétrica.
          const roundTrip = message.type === 'pong' ? Date.now() - message.sentAt : 0;
          setClockOffset(message.serverTime + roundTrip / 2 - Date.now());
        }

        if (message.type === 'ready') ready = true;
        if (message.type === 'error') lastErrorCode = message.code;
        if (message.type === 'participant.removed') removed = true;

        listenersRef.current.forEach((listener) => listener(message));
      };

      socket.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        if (disposed) return;

        // "Se a versão do protocolo não bater, o front trata como 'recarregue a
        // página'" (§2). Insistir só produziria a mesma recusa em loop.
        if (lastErrorCode === 'PROTOCOL_VERSION') {
          setState('closed');
          return;
        }

        // Expulsão: o servidor fechou de propósito (§10). Reconectar seria
        // remontar um socket que a autorização de canal já não aceita — o
        // servidor devolveria `FORBIDDEN_CHANNEL` para sempre, no ritmo do
        // backoff. Quem tira a tela do ar é o handler de `participant.removed`;
        // isto só garante que o socket não a persiga até lá.
        if (removed) {
          setState('closed');
          return;
        }

        // Morreu antes do `ready` sem o servidor reclamar de sala ou de canal:
        // ou o upgrade foi recusado por falta de cookie, ou o `hello` não tinha
        // credencial. Nos dois casos, a próxima tentativa leva ticket.
        if (!ready && (lastErrorCode === null || lastErrorCode === 'UNAUTHENTICATED')) {
          needsTicket = true;
        }

        setState('reconnecting');
        const step = RECONNECT_STEPS_MS[Math.min(attemptRef.current, RECONNECT_STEPS_MS.length - 1)]!;
        attemptRef.current += 1;
        reconnectTimer = setTimeout(() => void connect(), withJitter(step));
      };

      socket.onerror = () => socket.close();
    }

    void connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [roomCode, channelsKey]);

  const value = useMemo<RealtimeContextValue>(
    () => ({ state, clockOffset, send, subscribe }),
    [state, clockOffset, send, subscribe],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime precisa estar dentro de <RealtimeProvider>.');
  }
  return context;
}

/** Assina um tipo específico de evento do servidor. */
export function useRealtimeEvent<T extends ServerMessage['type']>(
  type: T,
  handler: (message: Extract<ServerMessage, { type: T }>) => void,
) {
  const { subscribe } = useRealtime();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === type) {
          handlerRef.current(message as Extract<ServerMessage, { type: T }>);
        }
      }),
    [subscribe, type],
  );
}
