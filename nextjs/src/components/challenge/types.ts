import type { ComponentType } from 'react';

import type { AnswerPayload, Phase, PhaseKind, Submission } from '@/lib/types';

/**
 * Contrato entre a casca da tela de Desafios e cada tipo de desafio.
 *
 * A casca (`ChallengeShell`) cuida do que é comum a todas as fases: barra
 * superior, cronômetro, contadores, telas de espera/feedback/pódio, painel do
 * líder e o ciclo de envio. Cada tipo de desafio implementa só a sua própria
 * lógica e interface, através deste módulo.
 *
 * Para adicionar um tipo novo: crie a pasta em `kinds/`, exporte um
 * `ChallengeTypeModule` e registre em `registry.ts`. Nada mais na tela precisa
 * mudar.
 */

/** Interface de resposta do aluno. */
export interface ChallengePlayerProps<P extends Phase = Phase> {
  phase: P;
  /** `true` enquanto o envio está em voo ou a sala está pausada. */
  disabled: boolean;
  /** Envia a resposta. A casca cuida do POST, da tela de espera e da correção. */
  onSubmit: (answer: AnswerPayload) => void;
  /** Necessário para ações auxiliares que não são envio (ex.: rodar código). */
  matchId: string;
}

/** Feedback individual, depois que o servidor corrigiu. */
export interface ChallengeFeedbackProps<P extends Phase = Phase> {
  phase: P;
  submission: Submission;
  /** Pontuação acumulada na partida, para o par "fase / total". */
  totalScore: number;
}

/** Prévia da fase no painel do líder (sem interação). */
export interface ChallengeLeaderPreviewProps<P extends Phase = Phase> {
  phase: P;
}

export interface ChallengeTypeModule<P extends Phase = Phase> {
  kind: PhaseKind;
  /** Rótulo curto usado em títulos ("Resposta dissertativa", "Complete a frase"). */
  label: string;
  Player: ComponentType<ChallengePlayerProps<P>>;
  Feedback: ComponentType<ChallengeFeedbackProps<P>>;
  LeaderPreview: ComponentType<ChallengeLeaderPreviewProps<P>>;
}

/** Telas pelas quais um aluno passa dentro de uma fase. */
export type ChallengeScreen =
  | 'challenge'
  /** O tempo acabou sem resposta. Separada de `individual`, que precisa de uma submissão. */
  | 'timeup'
  | 'waiting'
  | 'individual'
  | 'collective'
  | 'podium';
