import 'server-only';

import { apiRequestOrNull } from './client';
import type { PhaseSetLibrary } from '@/lib/types';

/**
 * `GET /phase-sets/library` — tudo que a tela "Conjuntos de desafios" mostra.
 *
 * Traz os conjuntos do autor e os da comunidade na mesma resposta porque as duas
 * abas trocam a cada clique: buscar de novo a cada troca faria a tela piscar
 * sem nenhuma informação nova ter chegado.
 *
 * É rota separada de `GET /phase-sets` (o seletor do lobby) pelo motivo oposto:
 * aquela abre no meio de uma aula e não pode esperar as agregações de acerto
 * médio e duração que só o card da biblioteca lê.
 */
export function getPhaseSetLibrary() {
  return apiRequestOrNull<PhaseSetLibrary>('/phase-sets/library');
}
