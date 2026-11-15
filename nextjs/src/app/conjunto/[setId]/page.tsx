import type { Metadata } from 'next';

import { StateMessage } from '@/components/feedback/StateMessage';
import { MOCK_USER, getMockPhaseSetDetail } from '@/components/set-library/mockLibrary';
import { PhaseSetView } from '@/components/set-view/PhaseSetView';
import { getPhaseSetDetail } from '@/lib/api/phaseSets';
import { getSession } from '@/lib/api/session';

export const metadata: Metadata = { title: 'Visualizar conjunto' };

/** Conjuntos podem ser editados, publicados ou copiados a qualquer momento. */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ setId: string }>;
}

export default async function PhaseSetPage({ params }: PageProps) {
  const { setId } = await params;
  const [session, apiDetail] = await Promise.all([
    getSession(),
    getPhaseSetDetail(setId).catch(() => null),
  ]);

  const mockDetail = apiDetail === null ? getMockPhaseSetDetail(setId) : null;
  const sampleData = apiDetail === null && mockDetail !== null;
  const detail = apiDetail ?? mockDetail;

  if (!detail) {
    return (
      <StateMessage
        variant="centered"
        title="Conjunto indisponível"
        hint={`API_BASE_URL / GET /phase-sets/${setId}`}
      >
        Este conjunto não foi encontrado, é privado de outro usuário ou a API ainda não respondeu.
      </StateMessage>
    );
  }

  return (
    <PhaseSetView
      set={detail}
      user={session.user ?? (sampleData ? MOCK_USER : null)}
      sampleData={sampleData}
    />
  );
}
