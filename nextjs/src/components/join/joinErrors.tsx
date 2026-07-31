import type { ReactNode } from 'react';

import type { JoinRejectionReason } from '@/lib/types';

export interface JoinErrorPresentation {
  title: string;
  message: (context: { code: string; name: string }) => string;
  /** Classe do círculo colorido do ícone (definida em JoinRoomFlow.module.css). */
  toneClass:
    | 'toneDanger'
    | 'toneWarning'
    | 'toneViolet'
    | 'tonePink'
    | 'toneBlue'
    | 'toneNeutral';
  icon: ReactNode;
  /** Rótulo do botão primário, quando faz sentido oferecer uma ação. */
  primaryAction: 'retry-code' | 'change-name' | 'login' | 'retry-network' | null;
}

const strokeProps = {
  width: 26,
  height: 26,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: '#fff',
  strokeWidth: 2,
  'aria-hidden': true,
} as const;

export const JOIN_ERRORS: Record<JoinRejectionReason, JoinErrorPresentation> = {
  not_found: {
    title: 'Sala não encontrada',
    message: ({ code }) =>
      `Não existe nenhuma sala com o código "${code}". Confira o código e tente de novo.`,
    toneClass: 'toneDanger',
    primaryAction: 'retry-code',
    icon: (
      <svg {...strokeProps}>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3M9 9l4 4M13 9l-4 4" />
      </svg>
    ),
  },
  locked: {
    title: 'Sala fechada',
    message: () => 'O apresentador travou a entrada de novos jogadores nesta sala.',
    toneClass: 'toneWarning',
    primaryAction: null,
    icon: (
      <svg {...strokeProps}>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    ),
  },
  account_required: {
    title: 'Conta necessária',
    message: () =>
      'Esta sala exige login para participar. Entre com sua conta para continuar.',
    toneClass: 'toneViolet',
    primaryAction: 'login',
    icon: (
      <svg {...strokeProps}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
  username_taken: {
    title: 'Nome já em uso',
    message: ({ name }) =>
      `Já tem alguém na sala usando o nome "${name}". Escolha outro para continuar.`,
    toneClass: 'tonePink',
    primaryAction: 'change-name',
    icon: (
      <svg {...strokeProps}>
        <circle cx="9" cy="9" r="4" />
        <circle cx="16" cy="11" r="3.2" opacity="0.6" />
        <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      </svg>
    ),
  },
  full: {
    title: 'Sala cheia',
    message: () => 'Esta sala já atingiu o número máximo de jogadores.',
    toneClass: 'toneBlue',
    primaryAction: null,
    icon: (
      <svg {...strokeProps}>
        <circle cx="8" cy="9" r="3.2" />
        <circle cx="16" cy="9" r="3.2" />
        <path d="M2 20c0-3 2.6-5 6-5s6 2 6 5M10 20c0-3 2.6-5 6-5s6 2 6 5" />
      </svg>
    ),
  },
  network: {
    title: 'Falha de conexão',
    message: () =>
      'Não conseguimos conectar à sala. Verifique sua internet e tente novamente.',
    toneClass: 'toneNeutral',
    primaryAction: 'retry-network',
    icon: (
      <svg {...strokeProps}>
        <path d="M2 8.5a15.5 15.5 0 0 1 20 0M5.5 12.5a10.5 10.5 0 0 1 13 0M9.3 16.3a5.7 5.7 0 0 1 5.4 0" />
        <path d="M12 19.2v.1M2 2l20 20" />
      </svg>
    ),
  },
};
