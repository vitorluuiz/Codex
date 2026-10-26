import { notFound, redirect } from 'next/navigation';

import { MatchReportView } from '@/components/reports/MatchReportView';
import { getMatchReportById, getReportByShareToken } from '@/lib/api/reports';

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
    return <MatchReportView report={byId} />;
  }

  const report = await getReportByShareToken(decoded);
  if (!report) notFound();

  return <MatchReportView report={report} />;
}
