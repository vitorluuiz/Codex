import { createHmac } from 'node:crypto';

/**
 * Gera tokens criptograficos de 256 bits em base64url (43 caracteres).
 *
 * - Impossivel adivinhar por forca bruta (2^256 combinacoes).
 * - Deterministico e idempotente para o par (segredo, matchId[, participantId]):
 *   reprocessar um relatorio nunca invalida links ja enviados aos participantes.
 */
export function generateShareToken(secret: string, matchId: string): string {
  return createHmac('sha256', secret)
    .update(`codex:report:share:v1:${matchId.toLowerCase()}`)
    .digest('base64url');
}

export function generateAccessToken(
  secret: string,
  matchId: string,
  participantId: string,
): string {
  return createHmac('sha256', secret)
    .update(`codex:report:individual:v1:${matchId.toLowerCase()}:${participantId.toLowerCase()}`)
    .digest('base64url');
}
