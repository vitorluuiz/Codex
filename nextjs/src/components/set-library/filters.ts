import { KIND_ORDER } from '@/components/set-editor/phaseKinds';
import type { PhaseKind, PhaseSetLibraryEntry } from '@/lib/types';

/** Qual aba da biblioteca está aberta. Casa com `PhaseSetSummary['source']`. */
export type LibraryScope = 'owned' | 'community';

export type LibrarySort = 'recent' | 'alpha' | 'used';

export const SORT_LABEL: Record<LibrarySort, string> = {
  recent: 'Recentes',
  alpha: 'A–Z',
  used: 'Mais usados',
};

/** Valor de "sem filtro" nos seletores de disciplina e pasta. */
export const ALL_SUBJECTS = 'Todas as disciplinas';
export const ALL_FOLDERS = 'Todas';

export interface LibraryFilterState {
  scope: LibraryScope;
  query: string;
  /** Tipos marcados. Todos marcados significa "sem filtro de tipo". */
  kinds: PhaseKind[];
  subject: string;
  folder: string;
  sort: LibrarySort;
}

export const INITIAL_FILTERS: LibraryFilterState = {
  scope: 'owned',
  query: '',
  kinds: KIND_ORDER,
  subject: ALL_SUBJECTS,
  folder: ALL_FOLDERS,
  sort: 'recent',
};

function kindsOf(set: PhaseSetLibraryEntry): PhaseKind[] {
  return KIND_ORDER.filter((kind) => (set.phaseKindCounts[kind] ?? 0) > 0);
}

/**
 * Aplica busca, tipos, disciplina, pasta e ordenação sobre a lista já carregada.
 *
 * O filtro de tipo pede que **todas** as fases do conjunto sejam de tipos
 * marcados, não que uma seja: desmarcar "código" serve para tirar da frente os
 * conjuntos que vão exigir um editor de código, e um conjunto meio quiz meio
 * código continua exigindo.
 *
 * A ordenação por recência é a da resposta — `updatedLabel` vem pronto do
 * servidor, então o cliente não tem data para comparar.
 */
export function filterSets(
  sets: PhaseSetLibraryEntry[],
  filters: LibraryFilterState,
): PhaseSetLibraryEntry[] {
  const query = filters.query.trim().toLowerCase();

  const list = sets.filter((set) => {
    if (set.source !== filters.scope) return false;
    if (query && !set.title.toLowerCase().includes(query)) return false;
    if (filters.kinds.length < KIND_ORDER.length) {
      if (!kindsOf(set).every((kind) => filters.kinds.includes(kind))) return false;
    }
    if (filters.subject !== ALL_SUBJECTS && set.subject !== filters.subject) return false;
    if (filters.scope === 'owned' && filters.folder !== ALL_FOLDERS) {
      if (set.folder !== filters.folder) return false;
    }
    return true;
  });

  if (filters.sort === 'alpha') return [...list].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  if (filters.sort === 'used') return [...list].sort((a, b) => b.useCount - a.useCount);
  return list;
}
