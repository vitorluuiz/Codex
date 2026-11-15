import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { StateMessage } from '@/components/feedback/StateMessage';
import { SetEditor } from '@/components/set-editor/SetEditor';
import { getMockPhaseSetDraft } from '@/components/set-library/mockLibrary';
import { getAiUsage } from '@/lib/api/ai';
import {
  DEFAULT_PHASE_LIMITS,
  getPhaseLimits,
  getPhaseSetDraft,
} from '@/lib/api/phaseSets';
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

  const [apiDraft, aiUsage, limits] = await Promise.all([
    session.user ? getPhaseSetDraft(setId).catch(() => null) : Promise.resolve(null),
    session.user ? getAiUsage().catch(() => null) : Promise.resolve(null),
    getPhaseLimits().catch(() => DEFAULT_PHASE_LIMITS),
  ]);

  const mockDraft = apiDraft === null ? getMockPhaseSetDraft(setId) : null;
  if (!session.user && !mockDraft) redirect('/entrar');

  const draft = apiDraft ?? mockDraft;

  if (!draft) {
    return (
      <StateMessage
        variant="centered"
        title="Conjunto indisponível"
        hint={`API_BASE_URL / GET /phase-sets/${setId}/draft`}
      >
        O editor está pronto, mas a API que guarda os conjuntos não respondeu ou este conjunto não
        está disponível para edição.
      </StateMessage>
    );
  }

  return (
    <SetEditor
      initialDraft={draft}
      initialAiUsage={aiUsage}
      limits={draft.limits ?? limits}
    />
  );
}
