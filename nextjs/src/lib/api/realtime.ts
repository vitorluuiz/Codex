import 'server-only';

import { apiRequest } from './client';

export interface RealtimeTicket {
  ticket: string;
  /** Segundos. O contrato fixa 30 — curto de propósito: é uma credencial. */
  expiresIn: number;
}

/**
 * `POST /realtime-ticket` — token de uso único para o handshake do WebSocket.
 *
 * Existe para o caso em que o cookie `codex_session` **não** viaja no upgrade:
 * a página num iframe de outro site, ou o ITP do Safari. O caminho normal não
 * precisa disto — o cookie vai sozinho e o servidor de tempo real o valida antes
 * de aceitar a conexão (`websocket-contract.md` §2).
 */
export async function createRealtimeTicket(): Promise<RealtimeTicket> {
  return apiRequest<RealtimeTicket>('/realtime-ticket', { method: 'POST' });
}
