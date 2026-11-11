import { notFound, redirect } from 'next/navigation';

import { MatchReportView } from '@/components/reports/MatchReportView';
import { getMatchReportById, getReportByShareToken } from '@/lib/api/reports';
import { getSession } from '@/lib/api/session';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RelatorioPageProps {
  params: Promise<{ token: string }>;
}

export default async function RelatorioPage({ params }: RelatorioPageProps) {
  const { token } = await params;
  const decoded = decodeURIComponent(token).trim();

  // Se chamar pelo UUID da partida (ex: lider vindo do perfil), valida autorizacao de lider
  // e redireciona para o link criptografico intransferivel/protegido contra forca bruta.
  if (UUID_REGEX.test(decoded)) {
    const byId = await getMatchReportById(decoded);
    if (!byId) notFound();
    if (byId.shareToken && byId.shareToken !== decoded) {
      redirect(`/relatorios/${byId.shareToken}`);
    }
    const session = await getSession();
    const isLeader = Boolean(
      session?.user && byId.leaderUserId && session.user.id === byId.leaderUserId,
    );
    return <MatchReportView report={byId} isLeader={isLeader} user={session?.user ?? null} />;
  }

  const [report, session] = await Promise.all([
    getReportByShareToken(decoded),
    getSession(),
  ]);
  if (!report) notFound();

  const isLeader = Boolean(
    session?.user && report.leaderUserId && session.user.id === report.leaderUserId,
  );

  return <MatchReportView report={report} isLeader={isLeader} user={session?.user ?? null} />;
}
