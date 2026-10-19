import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { StateMessage } from '@/components/feedback/StateMessage';
import { SetEditor } from '@/components/set-editor/SetEditor';
import { getAiUsage } from '@/lib/api/ai';
import { getPhaseSetDraft } from '@/lib/api/phaseSets';
import { getSession } from '@/lib/api/session';

export const metadata: Metadata = { title: 'Editor de conjunto' };

/** O rascunho é editável a qualquer momento — cachear devolveria texto velho. */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ setId: string }>;
}

export default async function EditPhaseSetPage({ params }: PageProps) {
  const { setId } = await params;
  const session = await getSession();
  if (!session.user) redirect('/entrar');

  const [draft, aiUsage] = await Promise.all([getPhaseSetDraft(setId), getAiUsage()]);

  if (!draft) {
    return (
      <StateMessage
        variant="centered"
        title="Conjunto indisponível"
        hint={`API_BASE_URL / GET /phase-sets/${setId}/draft`}
      >
        O editor está pronto, mas a API que guarda os conjuntos ainda não respondeu. Veja
        `contracts/api/api-rest-contract.md` para o contrato esperado.
      </StateMessage>
    );
  }

  return <SetEditor initialDraft={draft} initialAiUsage={aiUsage} />;
}
