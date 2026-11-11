import { notFound, redirect } from 'next/navigation';

import { resolveRoomReport } from '@/lib/api/reports';

export const dynamic = 'force-dynamic';

interface SalaRelatorioPageProps {
  params: Promise<{ code: string }>;
}

export default async function SalaRelatorioPage({ params }: SalaRelatorioPageProps) {
  const { code } = await params;
  const resolution = await resolveRoomReport(code);

  if (!resolution) {
    notFound();
  }

  if (resolution.role === 'leader') {
    if (resolution.shareToken) {
      redirect(`/relatorios/${resolution.shareToken}`);
    }
    redirect(`/relatorios/${resolution.matchId}`);
  }

  if (resolution.accessToken) {
    redirect(`/relatorios/individual/${resolution.accessToken}`);
  }

  notFound();
}
