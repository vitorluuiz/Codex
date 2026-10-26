import { notFound } from 'next/navigation';

import { IndividualReportView } from '@/components/reports/IndividualReportView';
import { getIndividualReportByToken } from '@/lib/api/reports';

export const dynamic = 'force-dynamic';

interface RelatorioIndividualPageProps {
  params: Promise<{ token: string }>;
}

export default async function RelatorioIndividualPage({ params }: RelatorioIndividualPageProps) {
  const { token } = await params;
  const decoded = decodeURIComponent(token).trim();

  const report = await getIndividualReportByToken(decoded);
  if (!report) notFound();

  return <IndividualReportView report={report} />;
}
