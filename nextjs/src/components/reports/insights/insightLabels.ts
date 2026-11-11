import type {
  AiVerdict,
  DifficultyLevel,
  InsightSeverity,
  QuestionFlag,
} from '@/lib/types';

export interface BadgeMeta {
  label: string;
  shortLabel: string;
  description: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral' | 'primary';
  colorHex: string;
  bgHex: string;
}

export const DIFFICULTY_META: Record<DifficultyLevel, BadgeMeta> = {
  very_easy: {
    label: 'Muito fácil',
    shortLabel: 'Muito fácil',
    description: 'Taxa de acerto igual ou superior a 90%.',
    tone: 'success',
    colorHex: '#15803d',
    bgHex: '#dcfce7',
  },
  easy: {
    label: 'Fácil',
    shortLabel: 'Fácil',
    description: 'Taxa de acerto entre 75% e 89%.',
    tone: 'success',
    colorHex: '#16a34a',
    bgHex: '#f0fdf4',
  },
  medium: {
    label: 'Equilibrada',
    shortLabel: 'Equilibrada',
    description: 'Taxa de acerto equilibrada (entre 41% e 74%).',
    tone: 'primary',
    colorHex: '#1d4ed8',
    bgHex: '#eff6ff',
  },
  hard: {
    label: 'Difícil',
    shortLabel: 'Difícil',
    description: 'Taxa de acerto baixa (entre 21% e 40%).',
    tone: 'warning',
    colorHex: '#b45309',
    bgHex: '#fef3c7',
  },
  very_hard: {
    label: 'Muito difícil',
    shortLabel: 'Muito difícil',
    description: 'Taxa de acerto crítica (igual ou inferior a 20%).',
    tone: 'danger',
    colorHex: '#b91c1c',
    bgHex: '#fee2e2',
  },
  insufficient: {
    label: 'Amostra insuficiente',
    shortLabel: 'Poucos dados',
    description: 'Menos de 3 respostas corrigidas para classificar a dificuldade.',
    tone: 'neutral',
    colorHex: '#475569',
    bgHex: '#f1f5f9',
  },
};

export const QUESTION_FLAG_META: Record<QuestionFlag, BadgeMeta> = {
  time_too_short: {
    label: 'Tempo curto demais',
    shortLabel: 'Tempo curto',
    description:
      'Muitos alunos não conseguiram responder a tempo ou responderam nos últimos segundos errando.',
    tone: 'danger',
    colorHex: '#b91c1c',
    bgHex: '#fee2e2',
  },
  time_too_long: {
    label: 'Tempo ocioso / folgado',
    shortLabel: 'Tempo folgado',
    description: 'A turma concluiu rapidamente (≤25% do tempo limite) com alto índice de acerto.',
    tone: 'neutral',
    colorHex: '#475569',
    bgHex: '#f1f5f9',
  },
  long_question: {
    label: 'Enunciado muito extenso',
    shortLabel: 'Enunciado longo',
    description: 'O enunciado possui mais de 60 palavras ou 400 caracteres.',
    tone: 'warning',
    colorHex: '#b45309',
    bgHex: '#fef3c7',
  },
  long_options: {
    label: 'Alternativas muito extensas',
    shortLabel: 'Alternativas longas',
    description: 'O texto das alternativas é longo (média >80 ou máxima >140 caracteres).',
    tone: 'warning',
    colorHex: '#b45309',
    bgHex: '#fef3c7',
  },
  reading_exceeds_time: {
    label: 'Leitura consome >50% do tempo',
    shortLabel: 'Leitura pesada',
    description:
      'O tempo estimado apenas para ler o enunciado e as opções consome mais da metade do cronômetro.',
    tone: 'danger',
    colorHex: '#b91c1c',
    bgHex: '#fee2e2',
  },
  low_discrimination: {
    label: 'Baixa discriminação (D < 0,15)',
    shortLabel: 'Baixa discriminação',
    description:
      'A questão diferencia pouco os participantes de maior pontuação dos de menor pontuação.',
    tone: 'warning',
    colorHex: '#b45309',
    bgHex: '#fef3c7',
  },
  negative_discrimination: {
    label: 'Discriminação negativa (D < 0)',
    shortLabel: 'Inverte desempenho',
    description:
      'Participantes com maior pontuação geral erraram mais esta questão do que os de menor pontuação — verifique ambiguidade ou gabarito.',
    tone: 'danger',
    colorHex: '#b91c1c',
    bgHex: '#fee2e2',
  },
  suspect_answer_key: {
    label: 'Gabarito suspeito (distrator dominante)',
    shortLabel: 'Gabarito suspeito',
    description:
      'Uma alternativa incorreta foi mais escolhida que o gabarito oficial ou preferida pelos melhores alunos.',
    tone: 'danger',
    colorHex: '#b91c1c',
    bgHex: '#fee2e2',
  },
};

export const SEVERITY_META: Record<InsightSeverity, BadgeMeta> = {
  low: {
    label: 'Severidade Baixa',
    shortLabel: 'Baixa',
    description: 'Indício leve ou pontual.',
    tone: 'neutral',
    colorHex: '#475569',
    bgHex: '#f1f5f9',
  },
  medium: {
    label: 'Severidade Média',
    shortLabel: 'Média',
    description: 'Padrão recorrente que merece atenção.',
    tone: 'warning',
    colorHex: '#b45309',
    bgHex: '#fef3c7',
  },
  high: {
    label: 'Severidade Alta',
    shortLabel: 'Alta',
    description: 'Forte coincidência estatística em múltiplas fases.',
    tone: 'danger',
    colorHex: '#b91c1c',
    bgHex: '#fee2e2',
  },
};

export const AI_VERDICT_META: Record<AiVerdict, BadgeMeta> = {
  ok: {
    label: 'Sem ressalvas pela IA',
    shortLabel: 'IA: Adequada',
    description: 'Enunciado claro, ortografia correta e gabarito consistente.',
    tone: 'success',
    colorHex: '#15803d',
    bgHex: '#dcfce7',
  },
  attention: {
    label: 'Sugestão de melhoria (IA)',
    shortLabel: 'IA: Atenção',
    description: 'Foram encontrados pontos de melhoria na redação, ortografia ou clareza.',
    tone: 'warning',
    colorHex: '#b45309',
    bgHex: '#fef3c7',
  },
  problem: {
    label: 'Problema conceitual ou de gabarito (IA)',
    shortLabel: 'IA: Problema',
    description: 'Possível erro conceitual, ambiguidade severa ou gabarito incorreto.',
    tone: 'danger',
    colorHex: '#b91c1c',
    bgHex: '#fee2e2',
  },
};
