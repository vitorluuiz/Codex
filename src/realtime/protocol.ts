/**
 * Contrato do WebSocket, compartilhado entre browser e servidor de tempo real.
 * `docs/websocket.md` descreve o mesmo protocolo em prosa.
 *
 * Regra que vale para tudo aqui: o servidor de WebSocket **transporta** estado,
 * não é dono dele. Toda mutação passa pela API REST (que grava no Firestore); a
 * API publica o evento e o servidor de WS faz o fan-out. Assim o cliente nunca
 * precisa confiar em outro cliente.
 */

import type {
  AvatarIndex,
  MatchMode,
  Participant,
  PhaseState,
  PhaseStats,
  PodiumEntry,
  Submission,
} from '@/lib/types';

export const PROTOCOL_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Cliente → servidor                                                          */
/* -------------------------------------------------------------------------- */

export type ClientMessage =
  /** Primeiro quadro depois do open. O token é o mesmo cookie de sessão. */
  | { type: 'hello'; v: number; token: string; roomCode: string }
  /**
   * Assina um canal. Um socket pode assinar vários; o servidor valida o papel
   * antes de aceitar (`room:*:leader` só para o líder).
   */
  | { type: 'subscribe'; channels: Channel[] }
  | { type: 'unsubscribe'; channels: Channel[] }
  /** Mantém a conexão viva e mede latência para sincronizar o cronômetro. */
  | { type: 'ping'; sentAt: number }
  /**
   * Sinal efêmero de presença: "estou digitando/escrevendo código". Não é
   * persistido — é o único caso em que o cliente origina estado.
   */
  | { type: 'activity'; phaseId: string; state: 'typing' | 'idle' };

/* -------------------------------------------------------------------------- */
/* Canais                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * - `room:{code}`          — lobby: participantes, configurações, fila.
 * - `room:{code}:match`    — partida: fase corrente, cronômetro, contadores.
 * - `room:{code}:leader`   — métricas por aluno. Só o líder pode assinar.
 * - `participant:{id}`     — eventos privados (correção da própria resposta).
 */
export type Channel =
  | `room:${string}`
  | `room:${string}:match`
  | `room:${string}:leader`
  | `participant:${string}`;

/* -------------------------------------------------------------------------- */
/* Servidor → cliente                                                          */
/* -------------------------------------------------------------------------- */

export type ServerMessage =
  | { type: 'ready'; v: number; participantId: string | null; isLeader: boolean; serverTime: number }
  | { type: 'pong'; sentAt: number; serverTime: number }
  | { type: 'error'; code: RealtimeErrorCode; message: string }

  /* --- lobby ------------------------------------------------------------- */
  | { type: 'participant.joined'; participant: Participant }
  | { type: 'participant.updated'; participant: Participant }
  | { type: 'participant.left'; participantId: string }
  | {
      type: 'room.settings';
      locked: boolean;
      requireAccount: boolean;
      capacity: number;
    }
  | { type: 'queue.updated'; revision: number }
  | { type: 'match.started'; matchId: string; mode: MatchMode }

  /* --- partida ----------------------------------------------------------- */
  /**
   * Fase entrou no ar (ou foi reiniciada / trocada pelo líder).
   * `endsAt` é epoch em ms do servidor — o cliente calcula o restante a partir
   * do offset medido no `pong`, então pausa e reconexão não desalinham nada.
   */
  | {
      type: 'phase.started';
      phaseNumber: number;
      totalPhases: number;
      endsAt: number | null;
      state: PhaseState;
    }
  | { type: 'phase.paused'; paused: boolean; endsAt: number | null }
  | { type: 'phase.ended'; phaseId: string }
  /** Contadores agregados — enviados com throttle (ver docs). */
  | { type: 'phase.progress'; phaseId: string; submittedCount: number; totalPlayers: number; readyCount: number }
  | { type: 'match.finished'; podium: PodiumEntry[] }
  | { type: 'match.returned-to-lobby' }

  /* --- privado ao participante ------------------------------------------ */
  /** Chega quando a IA termina de corrigir texto/código. */
  | { type: 'submission.graded'; submission: Submission }
  | { type: 'participant.removed'; reason: 'removed_by_leader' }

  /* --- painel do líder --------------------------------------------------- */
  | { type: 'stats.updated'; stats: PhaseStats }
  | {
      type: 'player.activity';
      participantId: string;
      name: string;
      avatarIndex: AvatarIndex;
      state: 'typing' | 'idle';
    };

export type RealtimeErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_CHANNEL'
  | 'ROOM_NOT_FOUND'
  | 'PROTOCOL_VERSION'
  | 'RATE_LIMITED';

/* -------------------------------------------------------------------------- */
/* Helpers de canal                                                            */
/* -------------------------------------------------------------------------- */

export const channels = {
  room: (code: string) => `room:${code}` as Channel,
  match: (code: string) => `room:${code}:match` as Channel,
  leader: (code: string) => `room:${code}:leader` as Channel,
  participant: (id: string) => `participant:${id}` as Channel,
};
