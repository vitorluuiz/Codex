import type { ReactNode } from 'react';

import type { JoinRejectionReason } from '@/lib/types';
import { formatRoomCode } from './RoomCodeInput';

export interface JoinErrorContext {
  code: string;
  name: string;
  serverMessage?: string;
}

export interface JoinErrorPresentation {
  /**
   * - `'inline'`: erro ligado ao campo digitado (código/nome); exibido junto ao
   *   input mantendo o texto intacto para correção rápida.
   * - `'banner'`: bloqueio da sala ou de sistema; exibido em alerta contextual
   *   dentro do card com ação direta (login ou tentar novamente).
   */
  display: 'inline' | 'banner';
  title: string;
  message: (context: JoinErrorContext) => string;
  /** Classe do círculo colorido do ícone (definida em JoinRoomFlow.module.css). */
  toneClass:
    | 'toneDanger'
    | 'toneWarning'
    | 'toneViolet'
    | 'tonePink'
    | 'toneBlue'
    | 'toneNeutral';
  icon: ReactNode;
  /** Ação primária exibida nos banners contextuais. */
  primaryAction: 'login' | 'retry' | null;
}

const strokeProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: '#fff',
  strokeWidth: 2,
  'aria-hidden': true,
} as const;

export const JOIN_ERRORS: Record<JoinRejectionReason, JoinErrorPresentation> = {
  not_found: {
    display: 'inline',
    title: 'Sala não encontrada',
    message: ({ code }) =>
      `Nenhuma sala encontrada com o código ${formatRoomCode(code)}. Confira os dígitos e tente de novo.`,
    toneClass: 'toneDanger',
    primaryAction: null,
    icon: (
      <svg {...strokeProps}>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3M9 9l4 4M13 9l-4 4" />
      </svg>
    ),
  },
  locked: {
    display: 'banner',
    title: 'Sala fechada',
    message: () =>
      'O apresentador travou a entrada de novos jogadores nesta sala. Peça para destrancar e tente novamente.',
    toneClass: 'toneWarning',
    primaryAction: 'retry',
    icon: (
      <svg {...strokeProps}>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    ),
  },
  account_required: {
    display: 'banner',
    title: 'Conta necessária',
    message: () =>
      'Esta sala exige login para participar. Entre com sua conta — você voltará para esta sala automaticamente.',
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
    display: 'inline',
    title: 'Nome já em uso',
    message: ({ name }) =>
      `Já existe alguém na sala usando "${name.trim()}". Escolha outro nome para continuar.`,
    toneClass: 'tonePink',
    primaryAction: null,
    icon: (
      <svg {...strokeProps}>
        <circle cx="9" cy="9" r="4" />
        <circle cx="16" cy="11" r="3.2" opacity="0.6" />
        <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      </svg>
    ),
  },
  full: {
    display: 'banner',
    title: 'Sala cheia',
    message: () =>
      'Esta sala atingiu o número máximo de jogadores. Se uma vaga abrir, você pode tentar novamente.',
    toneClass: 'toneBlue',
    primaryAction: 'retry',
    icon: (
      <svg {...strokeProps}>
        <circle cx="8" cy="9" r="3.2" />
        <circle cx="16" cy="9" r="3.2" />
        <path d="M2 20c0-3 2.6-5 6-5s6 2 6 5M10 20c0-3 2.6-5 6-5s6 2 6 5" />
      </svg>
    ),
  },
  rate_limited: {
    display: 'banner',
    title: 'Muitas tentativas',
    message: () =>
      'Você fez várias tentativas em sequência. Aguarde alguns segundos e tente novamente.',
    toneClass: 'toneWarning',
    primaryAction: 'retry',
    icon: (
      <svg {...strokeProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  validation: {
    display: 'inline',
    title: 'Dados inválidos',
    message: ({ serverMessage }) =>
      serverMessage?.trim() || 'Confira os dados informados e tente novamente.',
    toneClass: 'toneDanger',
    primaryAction: null,
    icon: (
      <svg {...strokeProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    ),
  },
  network: {
    display: 'banner',
    title: 'Falha de conexão',
    message: () =>
      'Não conseguimos conectar à sala. Verifique sua internet e tente novamente.',
    toneClass: 'toneNeutral',
    primaryAction: 'retry',
    icon: (
      <svg {...strokeProps}>
        <path d="M2 8.5a15.5 15.5 0 0 1 20 0M5.5 12.5a10.5 10.5 0 0 1 13 0M9.3 16.3a5.7 5.7 0 0 1 5.4 0" />
        <path d="M12 19.2v.1M2 2l20 20" />
      </svg>
    ),
  },
};
