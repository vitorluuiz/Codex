/**
 * Espelho servidor do contrato em `nextjs/src/realtime/protocol.ts`, descrito em
 * prosa em `contract/websocket-contract.md`. As duas pontas tem que concordar
 * quadro a quadro; a diferenca de conteudo e deliberada:
 *
 * - O front tipa o **payload** dos eventos (`Participant`, `PhaseState`, ...)
 *   porque ele desenha com esses campos.
 * - Aqui os payloads sao opacos. O servico **transporta** estado, nao e dono de
 *   nenhum (§1) — se ele tipasse `PhaseState`, toda mudanca de campo da API
 *   viraria um deploy do WS sem nenhum ganho. O que ele valida e o envelope: o
 *   `type` existe? e permitido no canal em que foi publicado?
 */

export const PROTOCOL_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Cliente -> servidor                                                         */
/* -------------------------------------------------------------------------- */

export type ClientMessage =
  | { type: 'hello'; v: number; token: string; roomCode: string }
  | { type: 'subscribe'; channels: string[] }
  | { type: 'unsubscribe'; channels: string[] }
  | { type: 'ping'; sentAt: number }
  | { type: 'activity'; phaseId: string; state: ActivityState };

export type ActivityState = 'typing' | 'idle';

export const CLIENT_MESSAGE_TYPES = ['hello', 'subscribe', 'unsubscribe', 'ping', 'activity'] as const;

/* -------------------------------------------------------------------------- */
/* Servidor -> cliente                                                         */
/* -------------------------------------------------------------------------- */

/**
 * `RECONNECT` nao esta na uniao do `protocol.ts` do front na versao original,
 * mas o §9 do contrato o exige no encerramento gracioso. Ele foi acrescentado
 * la nesta leva — ver `contract/websocket-implementation-log.md`.
 */
export type RealtimeErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_CHANNEL'
  | 'ROOM_NOT_FOUND'
  | 'PROTOCOL_VERSION'
  | 'RATE_LIMITED'
  | 'RECONNECT';

export interface ReadyMessage {
  type: 'ready';
  v: number;
  participantId: string | null;
  isLeader: boolean;
  serverTime: number;
}

export interface PongMessage {
  type: 'pong';
  sentAt: number;
  serverTime: number;
}

export interface ErrorMessage {
  type: 'error';
  code: RealtimeErrorCode;
  message: string;
}

/** Evento vindo do broker: `type` conhecido, resto opaco. */
export interface RealtimeEvent {
  type: string;
  [field: string]: unknown;
}

export type ServerMessage = ReadyMessage | PongMessage | ErrorMessage | RealtimeEvent;

/* -------------------------------------------------------------------------- */
/* Codigos de fechamento                                                       */
/* -------------------------------------------------------------------------- */

export const CLOSE_CODES = {
  /** Encerramento gracioso da instancia (§9): "going away", o cliente reconecta. */
  goingAway: 1001,
  /** Violacao de politica: rate limit, canal proibido de forma fatal, sem auth. */
  policyViolation: 1008,
  /** Quadro maior que o limite de §10. O `ws` ja fecha assim sozinho. */
  messageTooBig: 1009,
} as const;
