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
  const closedByUsRef = useRef(false);
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

    closedByUsRef.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    function connect() {
      setState(attemptRef.current === 0 ? 'connecting' : 'reconnecting');

      const socket = new WebSocket(url!);
      socketRef.current = socket;

      socket.onopen = () => {
        attemptRef.current = 0;
        setState('open');

        // O token real viaja no cookie httpOnly; o servidor lê o cookie do
        // handshake. Esse campo cobre o caso de cookie indisponível (Safari ITP
        // em iframe), quando o valor é injetado via /api/realtime-ticket.
        socket.send(
          JSON.stringify({
            type: 'hello',
            v: PROTOCOL_VERSION,
            token: '',
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

        listenersRef.current.forEach((listener) => listener(message));
      };

      socket.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        if (closedByUsRef.current) return;

        setState('reconnecting');
        const delay =
          RECONNECT_STEPS_MS[Math.min(attemptRef.current, RECONNECT_STEPS_MS.length - 1)];
        attemptRef.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    }

    connect();

    return () => {
      closedByUsRef.current = true;
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
