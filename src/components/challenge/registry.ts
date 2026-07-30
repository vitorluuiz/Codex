import type { Phase, PhaseKind } from '@/lib/types';
import { codeModule } from './kinds/code';
import { fillModule } from './kinds/fill';
import { quizModule } from './kinds/quiz';
import { textModule } from './kinds/text';
import type { ChallengeTypeModule } from './types';

/**
 * Registro dos tipos de desafio.
 *
 * A casca da tela consulta este mapa para descobrir qual componente renderizar.
 * Adicionar um tipo novo = criar a pasta em `kinds/` e acrescentar uma linha
 * aqui — nenhuma outra tela precisa ser tocada.
 */
type Registry = {
  [K in PhaseKind]: ChallengeTypeModule<Extract<Phase, { kind: K }>>;
};

const REGISTRY: Registry = {
  quiz: quizModule,
  code: codeModule,
  text: textModule,
  fill: fillModule,
};

/**
 * Devolve o módulo do tipo da fase. O cast é seguro porque `Phase` é uma união
 * discriminada por `kind`, então o módulo devolvido sempre bate com a fase.
 */
export function challengeModuleFor(phase: Phase): ChallengeTypeModule<Phase> {
  return REGISTRY[phase.kind] as unknown as ChallengeTypeModule<Phase>;
}

export function challengeLabelFor(kind: PhaseKind): string {
  return REGISTRY[kind].label;
}
