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

export interface RealtimeContextValue {
  roomCode: string;
  state: ConnectionState;
  /** Diferença entre o relógio do servidor e o local, em ms. */
  clockOffset: number;
  send: (message: ClientMessage) => void;
  subscribe: (listener: Listener) => () => void;
  /** Registra canais adicionais necessários para componentes ativos. */
  registerChannels: (channels: Channel[]) => () => void;
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

export interface RealtimeProviderProps {
  roomCode: string;
  channels?: Channel[];
  children: ReactNode;
}

function NestedChannelRegistrar({
  channels = [],
  children,
}: {
  channels?: Channel[];
  children: ReactNode;
}) {
  useRealtimeChannels(channels);
  return <>{children}</>;
}

function RootRealtimeProvider({
  roomCode,
  initialChannels = [],
  children,
}: {
  roomCode: string;
  initialChannels?: Channel[];
  children: ReactNode;
}) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [clockOffset, setClockOffset] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Set<Listener>());
  const attemptRef = useRef(0);
  const readyRef = useRef(false);

  // Canais desejados pelo conjunto de componentes ativos (com contagem de referências)
  const channelCountsRef = useRef<Map<Channel, number>>(new Map());
  // Canais cuja assinatura já foi confirmada / enviada ao servidor nesta conexão
  const activeServerChannelsRef = useRef<Set<Channel>>(new Set());

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

  const syncChannels = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !readyRef.current) {
      return;
    }

    const desired = new Set<Channel>();
    for (const [ch, count] of channelCountsRef.current.entries()) {
      if (count > 0) desired.add(ch);
    }

    const toSubscribe: Channel[] = [];
    const toUnsubscribe: Channel[] = [];

    for (const ch of desired) {
      if (!activeServerChannelsRef.current.has(ch)) {
        toSubscribe.push(ch);
      }
    }

    for (const ch of activeServerChannelsRef.current) {
      if (!desired.has(ch)) {
        toUnsubscribe.push(ch);
      }
    }

    if (toSubscribe.length > 0) {
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          channels: toSubscribe,
        } satisfies ClientMessage),
      );
      for (const ch of toSubscribe) {
        activeServerChannelsRef.current.add(ch);
      }
    }

    if (toUnsubscribe.length > 0) {
      socket.send(
        JSON.stringify({
          type: 'unsubscribe',
          channels: toUnsubscribe,
        } satisfies ClientMessage),
      );
      for (const ch of toUnsubscribe) {
        activeServerChannelsRef.current.delete(ch);
      }
    }
  }, []);

  const registerChannels = useCallback(
    (channelsToRegister: Channel[]) => {
      for (const ch of channelsToRegister) {
        channelCountsRef.current.set(ch, (channelCountsRef.current.get(ch) ?? 0) + 1);
      }
      syncChannels();

      return () => {
        for (const ch of channelsToRegister) {
          const count = channelCountsRef.current.get(ch) ?? 1;
          if (count <= 1) {
            channelCountsRef.current.delete(ch);
          } else {
            channelCountsRef.current.set(ch, count - 1);
          }
        }
        syncChannels();
      };
    },
    [syncChannels],
  );

  // Registra canais iniciais passados via prop
  const initialChannelsKey = initialChannels.join('|');
  useEffect(() => {
    if (initialChannels.length === 0) return;
    return registerChannels(initialChannels);
  }, [registerChannels, initialChannelsKey]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_REALTIME_URL;
    if (!url) {
      setState('closed');
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    let ready = false;
    let lastErrorCode: string | null = null;
    let needsTicket = false;
    let removed = false;

    async function connect() {
      setState(attemptRef.current === 0 ? 'connecting' : 'reconnecting');
      ready = false;
      readyRef.current = false;
      lastErrorCode = null;

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

        // Envia assinaturas para todos os canais desejados até este momento
        const initialDesired: Channel[] = [];
        for (const [ch, count] of channelCountsRef.current.entries()) {
          if (count > 0) initialDesired.push(ch);
        }
        if (initialDesired.length > 0) {
          socket.send(
            JSON.stringify({
              type: 'subscribe',
              channels: initialDesired,
            } satisfies ClientMessage),
          );
          activeServerChannelsRef.current = new Set(initialDesired);
        } else {
          activeServerChannelsRef.current.clear();
        }

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
          const roundTrip = message.type === 'pong' ? Date.now() - message.sentAt : 0;
          setClockOffset(message.serverTime + roundTrip / 2 - Date.now());
        }

        if (message.type === 'ready') {
          ready = true;
          readyRef.current = true;
          syncChannels();
        }
        if (message.type === 'error') {
          lastErrorCode = message.code;
          if (message.code === 'FORBIDDEN_CHANNEL') {
            activeServerChannelsRef.current.clear();
            setTimeout(() => {
              if (!disposed && readyRef.current) syncChannels();
            }, 500);
          }
        }
        if (message.type === 'participant.removed' || message.type === 'room.closed') removed = true;

        listenersRef.current.forEach((listener) => listener(message));
      };

      socket.onclose = () => {
        readyRef.current = false;
        activeServerChannelsRef.current.clear();
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
      readyRef.current = false;
      activeServerChannelsRef.current.clear();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [roomCode]);

  const value = useMemo<RealtimeContextValue>(
    () => ({ roomCode, state, clockOffset, send, subscribe, registerChannels }),
    [roomCode, state, clockOffset, send, subscribe, registerChannels],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/**
 * Mantém um único socket por sala e reentrega as mensagens aos hooks.
 *
 * Se já estiver dentro de um `RealtimeProvider` para a mesma sala (por exemplo,
 * no layout de `/sala/[code]`), ele reutiliza a conexão aberta e apenas gerencia
 * dinamicamente as assinaturas dos `channels` passados.
 */
export function RealtimeProvider({ roomCode, channels = [], children }: RealtimeProviderProps) {
  const parent = useContext(RealtimeContext);
  if (parent && parent.roomCode === roomCode) {
    return <NestedChannelRegistrar channels={channels}>{children}</NestedChannelRegistrar>;
  }

  return (
    <RootRealtimeProvider roomCode={roomCode} initialChannels={channels}>
      {children}
    </RootRealtimeProvider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime precisa estar dentro de <RealtimeProvider>.');
  }
  return context;
}

/** Assina canais dinamicamente na conexão WebSocket existente sem reiniciá-la. */
export function useRealtimeChannels(channels: Channel[]) {
  const { registerChannels } = useRealtime();
  const channelsKey = channels.join('|');

  useEffect(() => {
    if (channels.length === 0) return;
    return registerChannels(channels);
  }, [registerChannels, channelsKey]);
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
