import type { ReactNode } from 'react';

import type { AvatarIndex } from '@/lib/types';

/**
 * Paleta de avatares de convidado. O índice é o que trafega na API
 * (`Participant.avatarIndex`) — as cores e formas vivem só no front.
 */
export const AVATAR_COUNT = 6;

export const AVATAR_CLASS_NAMES = [
  'avatarBlue',
  'avatarPink',
  'avatarAmber',
  'avatarGreen',
  'avatarViolet',
  'avatarInk',
] as const;

export function avatarGlyph(index: AvatarIndex): ReactNode {
  switch (index) {
    case 0:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
          <path d="M12 2v20M2 12h20" />
        </svg>
      );
    case 1:
      return (
        <svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
    case 2:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
          <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
        </svg>
      );
    case 3:
      return (
        <svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
          <polygon points="12,3 21,9 21,15 12,21 3,15 3,9" />
        </svg>
      );
    case 4:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 9 9c0-1-.8-1-1.2-.3A6 6 0 1 1 12.3 4.2c.7-.4.7-1.2-.3-1.2z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="3" />
        </svg>
      );
  }
}

/** Normaliza qualquer número vindo da API para um índice válido. */
export function toAvatarIndex(value: number): AvatarIndex {
  const normalized = ((value % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
  return normalized as AvatarIndex;
}
