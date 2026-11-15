import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SetLibraryView } from '@/components/set-library/SetLibraryView';
import { MOCK_LIBRARY } from '@/components/set-library/mockLibrary';
import { getOwnedPhaseSets, searchCommunityPhaseSets } from '@/lib/api/setLibrary';
import { getSession } from '@/lib/api/session';
import type { PhaseSetLibrary } from '@/lib/types';

export const metadata: Metadata = { title: 'Conjuntos de desafios' };

/** A biblioteca muda a cada conjunto salvo, renomeado, publicado ou excluído. */
export const dynamic = 'force-dynamic';

export default async function SetLibraryPage() {
  const session = await getSession();
  if (!session.user) redirect('/entrar');

  // As duas abas trocam a cada clique; buscar as duas de uma vez evita a tela
  // piscar na troca. São rotas separadas, mas as requisições saem em paralelo.
  const [owned, community] = await Promise.all([
    getOwnedPhaseSets(),
    searchCommunityPhaseSets(),
  ]);

  return <SetLibraryView user={session.user} library={buildLibrary(owned, community)} />;
}

function buildLibrary(
  owned: Awaited<ReturnType<typeof getOwnedPhaseSets>>,
  community: Awaited<ReturnType<typeof searchCommunityPhaseSets>>,
): PhaseSetLibrary {
  if (!owned && !community) return MOCK_LIBRARY;

  const communitySets = community?.sets ?? [];
  const subjects = [...(owned?.subjects ?? []), ...communitySets.map((set) => set.subject)]
    .map((subject) => subject.trim())
    .filter((subject, index, all) => subject.length > 0 && all.indexOf(subject) === index)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return {
    sets: [...(owned?.sets ?? []), ...communitySets],
    subjects,
    folders: owned?.folders ?? [],
    coverUrl: owned?.coverUrl ?? null,
  };
}
