import type { CSSProperties } from 'react';

/**
 * Entrega valores calculados em runtime (largura de barra, altura de coluna,
 * cor de um conjunto escolhido pelo usuário) para o CSS via custom properties.
 *
 * Isto **não** é estilização inline: nenhuma declaração visual mora aqui. As
 * regras continuam todas nos `.module.css`, que leem `var(--…)`. É o único jeito
 * de passar um número do servidor para o CSS sem gerar uma classe por valor.
 */
export function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

/** `0.734` → `"73%"`, com clamp em 0..100. */
export function toPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}
