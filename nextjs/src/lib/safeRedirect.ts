/**
 * Utilitários para redirecionamento interno seguro pós-autenticação.
 *
 * Espelha a regra de `OAuthService.NormalizeRedirectTo` no backend `.NET`:
 * só aceita caminhos relativos que comecem com `/` (sem `//`, `\` ou quebras
 * de linha), impedindo open redirects para domínios externos.
 */

export function sanitizeRedirectPath(
  raw: string | null | undefined,
  fallback = '/perfil',
): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (
    trimmed.length > 1 &&
    trimmed.startsWith('/') &&
    !trimmed.startsWith('//') &&
    !trimmed.includes('\\') &&
    !/[\r\n]/.test(trimmed)
  ) {
    return trimmed;
  }
  return fallback;
}

/** Constrói a URL de `/entrar` preservando o retorno automático para a sala. */
export function buildAuthReturnUrl(roomCode: string, mode?: 'criar'): string {
  const params = new URLSearchParams();
  if (mode === 'criar') params.set('modo', 'criar');
  params.set('proximo', `/sala?codigo=${roomCode}`);
  return `/entrar?${params.toString()}`;
}

/** Extrai o código de 6 dígitos quando o destino aponta para `/sala?codigo=XXXXXX`. */
export function extractRoomCodeFromRedirect(path: string): string | null {
  const match = path.match(/^\/sala\?(?:.*&)?codigo=(\d{6})(?:&|$)/);
  return match ? match[1] : null;
}
