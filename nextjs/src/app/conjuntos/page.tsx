import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SetLibraryView } from '@/components/set-library/SetLibraryView';
import { MOCK_LIBRARY, MOCK_USER } from '@/components/set-library/mockLibrary';
import { getPhaseSetLibrary } from '@/lib/api/setLibrary';
import { getSession } from '@/lib/api/session';

export const metadata: Metadata = { title: 'Conjuntos de desafios' };

/** A biblioteca muda a cada conjunto salvo, renomeado ou excluído. */
export const dynamic = 'force-dynamic';

export default async function SetLibraryPage() {
  const session = await getSession();
  // O `.catch` faz parte do andaime temporário: `API_BASE_URL` está preenchida no
  // ambiente local, então com a API fora do ar o erro é de rede, não o
  // `ApiNotConfiguredError` que `apiRequestOrNull` já converte em `null`.
  const library = await getPhaseSetLibrary().catch(() => null);

  // Temporário, para validar o layout antes de `GET /phase-sets/library` existir:
  // sem API configurada a tela roda com os dados de `mockLibrary.ts` e avisa na
  // própria página que o conteúdo é fictício. Com a rota de pé, some tudo isto e
  // o `redirect` volta a valer sozinho. Ver o cabeçalho de `mockLibrary.ts`.
  const sampleData = library === null;

  if (!sampleData && !session.user) redirect('/entrar');

  return (
    <SetLibraryView
      user={session.user ?? MOCK_USER}
      library={library ?? MOCK_LIBRARY}
      sampleData={sampleData}
    />
  );
}
