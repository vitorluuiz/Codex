/**
 * Canais e autorizacao de canal (contract §3).
 *
 * "A separacao nao e organizacional, e de seguranca": `room:{code}:match` so
 * carrega agregado, tudo individual mora em `:leader` ou no canal privado. Este
 * arquivo e o unico lugar que decide quem assina o que — se a regra existisse em
 * dois lugares, uma das copias ficaria para tras.
 */

import type { Identity } from './identity.js';

export type ChannelKind = 'room' | 'match' | 'leader' | 'participant';

export interface ParsedChannel {
  readonly raw: string;
  readonly kind: ChannelKind;
  /** Sala a que o canal pertence. `participant:*` herda a sala da conexao. */
  readonly roomCode: string | null;
  readonly participantId: string | null;
}

const ROOM_CODE = /^[0-9]{6}$/;
// Guid do Postgres, no formato que o System.Text.Json emite.
const PARTICIPANT_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Formato invalido devolve `null` e o chamador responde `FORBIDDEN_CHANNEL` — o
 * mesmo code de "existe mas voce nao pode". Distinguir "malformado" de "proibido"
 * daria ao atacante um oraculo para descobrir formatos validos, exatamente como o
 * `RoomAccessService` da API evita distinguir "codigo malformado" de "sala nao
 * existe".
 */
export function parseChannel(raw: unknown): ParsedChannel | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 128) return null;

  const parts = raw.split(':');

  if (parts[0] === 'participant' && parts.length === 2) {
    const id = parts[1]!;
    if (!PARTICIPANT_ID.test(id)) return null;
    return { raw, kind: 'participant', roomCode: null, participantId: id };
  }

  if (parts[0] === 'room' && (parts.length === 2 || parts.length === 3)) {
    const code = parts[1]!;
    if (!ROOM_CODE.test(code)) return null;

    if (parts.length === 2) {
      return { raw, kind: 'room', roomCode: code, participantId: null };
    }

    const suffix = parts[2];
    if (suffix === 'match') return { raw, kind: 'match', roomCode: code, participantId: null };
    if (suffix === 'leader') return { raw, kind: 'leader', roomCode: code, participantId: null };
    return null;
  }

  return null;
}

/**
 * §10: "sempre relendo o papel do banco — nao confie no `isLeader` que voce
 * mandou no `ready` cinco minutos atras". Por isso esta funcao recebe a
 * `Identity` recem-resolvida, e nao o estado guardado na conexao.
 */
export function canSubscribe(channel: ParsedChannel, identity: Identity): boolean {
  switch (channel.kind) {
    // Lobby e partida: qualquer participante aprovado da sala, mais o lider.
    case 'room':
    case 'match':
      return channel.roomCode === identity.roomCode && (identity.isLeader || identity.isApprovedParticipant);

    case 'leader':
      return channel.roomCode === identity.roomCode && identity.isLeader;

    // Canal privado: so o proprio, e so enquanto ainda existir participacao.
    // O lider nao le o canal de ninguem — o que ele precisa ver esta agregado
    // em `:leader`.
    //
    // O `participantStatus` nao e detalhe: quem o lider expulsa tem a linha
    // apagada do banco, e a API entao devolve `participantStatus: null` mas
    // repete o `participantId` do token (ela cai de volta nele quando nao acha
    // o participante). Sem esta checagem, o expulso reconectaria e reassinaria
    // o proprio canal de um participante que nao existe mais — um socket vivo
    // por tempo indeterminado, que e exatamente o que o §10 manda fechar.
    // `pending` e `rejected` continuam passando: e por este canal que a decisao
    // do lider sobre eles chega.
    case 'participant':
      return (
        identity.participantId !== null &&
        identity.participantStatus !== null &&
        channel.participantId === identity.participantId
      );
  }
}

/**
 * Segunda barreira, no sentido oposto: um publicador que erre o canal nao
 * consegue vazar evento individual num canal coletivo. Se `submission.graded`
 * aparecesse em `room:{code}`, a nota de uma pessoa iria para a turma inteira.
 */
const EVENTS_BY_KIND: Record<ChannelKind, ReadonlySet<string>> = {
  room: new Set([
    'participant.joined',
    'participant.updated',
    'participant.left',
    'room.settings',
    'queue.updated',
    'match.started',
    'room.closed',
  ]),
  match: new Set([
    'phase.started',
    'phase.paused',
    'phase.progress',
    'phase.ended',
    'match.finished',
    'match.returned-to-lobby',
    'report.ready',
  ]),
  leader: new Set(['stats.updated', 'player.activity']),
  // `participant.updated` aqui e a decisao do lider sobre a propria pessoa. Ela
  // nao pode assinar `room:{code}` enquanto esta pendente, entao este e o unico
  // canal por onde "voce foi aceito" chega — e o dado e dela mesma, entao nao ha
  // vazamento em carregar o participante inteiro.
  participant: new Set(['submission.graded', 'participant.removed', 'participant.updated', 'room.closed']),
};

export function isEventAllowedOnChannel(kind: ChannelKind, eventType: string): boolean {
  return EVENTS_BY_KIND[kind].has(eventType);
}

export const channelNames = {
  room: (code: string) => `room:${code}`,
  match: (code: string) => `room:${code}:match`,
  leader: (code: string) => `room:${code}:leader`,
  participant: (id: string) => `participant:${id}`,
};
