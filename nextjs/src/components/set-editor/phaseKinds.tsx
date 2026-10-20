import type { ReactNode } from 'react';

import { Icon } from '@/components/icons/Icons';
import type { DraftPhase, PhaseKind } from '@/lib/types';

interface KindMeta {
  label: string;
  description: string;
  /** Cor de identificação da fase, também usada na bolinha do rail. */
  color: string;
  icon: ReactNode;
}

export const KIND_META: Record<PhaseKind, KindMeta> = {
  quiz: {
    label: 'Quiz',
    description: 'Pergunta com alternativas e uma resposta correta.',
    color: 'var(--blue-500)',
    icon: <Icon.Quiz size={19} />,
  },
  code: {
    label: 'Código',
    description: 'Problema de programação com editor e casos de teste.',
    color: 'var(--violet-500)',
    icon: <Icon.Code size={19} />,
  },
  text: {
    label: 'Dissertativa',
    description: 'Resposta escrita, avaliada com apoio da IA.',
    color: 'var(--amber-500)',
    icon: <Icon.Text size={19} />,
  },
  fill: {
    label: 'Completar frase',
    description: 'Frase com lacunas para preencher com as palavras certas.',
    color: 'var(--green-500)',
    icon: <Icon.Fill size={19} />,
  },
};

/**
 * Rótulo curto, para quando o tipo aparece junto de um número ("9 quiz").
 * "Completar frase" por extenso quebraria a linha do chip no card.
 */
export const KIND_SHORT_LABEL: Record<PhaseKind, string> = {
  quiz: 'quiz',
  code: 'código',
  text: 'dissertativa',
  fill: 'completar',
};

export const KIND_ORDER: PhaseKind[] = ['quiz', 'code', 'text', 'fill'];

export const QUESTION_LABEL: Record<PhaseKind, string> = {
  quiz: 'Pergunta',
  code: 'Enunciado do problema',
  text: 'Pergunta dissertativa',
  fill: 'Frase com lacunas',
};

export const QUESTION_PLACEHOLDER: Record<PhaseKind, string> = {
  quiz: 'Ex: Qual fração abaixo é equivalente a 2/3?',
  code: 'Descreva o problema, as entradas e as saídas esperadas.',
  text: 'Ex: Explique, com suas palavras, por que 2/3 e 4/6 são equivalentes.',
  fill: 'Ex: Uma fração é equivalente quando, ao ___ os termos, a ___ se mantém.',
};

/** Marcadores aceitos para abrir uma lacuna numa fase `fill`. */
export const BLANK_TOKENS = ['___', 'PALAVRA'];

const BLANK_PATTERN = /___|PALAVRA/;

/** Quantas lacunas o enunciado declara hoje. */
export function countBlanks(question: string): number {
  return question.split(BLANK_PATTERN).length - 1;
}

/**
 * Quebra o enunciado em texto e lacunas, na ordem.
 *
 * O gabarito é posicional, então a lista de lacunas precisa acompanhar o texto
 * a cada tecla: apagar um `___` do meio da frase tem que descartar a palavra
 * daquela posição, não a última.
 */
export function splitQuestion(question: string): { text: string; blankIndex: number | null }[] {
  const parts = question.split(BLANK_PATTERN);
  return parts.flatMap((text, index) =>
    index < parts.length - 1
      ? [
          { text, blankIndex: null },
          { text: '', blankIndex: index },
        ]
      : [{ text, blankIndex: null }],
  );
}

/** Ajusta o gabarito ao número de lacunas do enunciado, preservando o que já foi preenchido. */
export function syncBlanks(question: string, blanks: (string | null)[]): (string | null)[] {
  const count = countBlanks(question);
  const next = blanks.slice(0, count);
  while (next.length < count) next.push(null);
  return next;
}

/** Fase nova, com os valores padrão que o autor vai ajustar. */
export interface ChallengeDefaults {
  basePoints: number;
  pointsMultiplier: number;
  timeSeconds: number;
}

export function defaultDraftPhase(
  kind: PhaseKind,
  id: string,
  defaults?: Partial<ChallengeDefaults>,
): DraftPhase {
  const base = {
    id,
    name: `Nova fase · ${KIND_META[kind].label}`,
    basePoints: defaults?.basePoints ?? 100,
    pointsMultiplier: defaults?.pointsMultiplier ?? 1,
    timeSeconds: defaults?.timeSeconds ?? 45,
    question: '',
    fromAI: false,
    theme: 'default',
    showFeedbackAnimation: true,
    introSeconds: 5,
    introTip: '',
    introSound: true,
    introShapes: true,
  };

  switch (kind) {
    case 'quiz':
      return { ...base, kind, options: ['', ''], correctIndexes: [0] };
    case 'code':
      return { ...base, kind, starterCode: 'function solucao(entrada) {\n  \n}\n', testCases: '' };
    case 'text':
      return { ...base, kind, expectedAnswer: '' };
    case 'fill':
      return { ...base, kind, words: [], blanks: [] };
  }
}

/** Id local de uma fase ainda não persistida. O servidor troca por um id real ao salvar. */
export function draftPhaseId(): string {
  return `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
