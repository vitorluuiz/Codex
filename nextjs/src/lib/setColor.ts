/**
 * Cor de identificação de um conjunto nas telas que o listam.
 *
 * Diferente da fila da sala — lá a cor vem do servidor, porque precisa bater com
 * a das fases na fila. Aqui ela é só decoração do card, então é derivada do id:
 * a mesma lista sempre pinta os mesmos conjuntos das mesmas cores, sem custar um
 * campo no banco, e o perfil e a biblioteca concordam sobre a cor de cada um.
 */
const PALETTE = [
  'var(--blue-500)',
  'var(--pink-500)',
  'var(--amber-500)',
  'var(--green-500)',
  'var(--violet-500)',
  'var(--blue-700)',
];

export function setColor(setId: string): string {
  let hash = 0;
  for (const char of setId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
