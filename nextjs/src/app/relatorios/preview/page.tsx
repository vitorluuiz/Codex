import { notFound } from 'next/navigation';

import { ReportDevPreview } from '@/components/reports/ReportDevPreview';
import { getIndividualReportByToken, getMatchReportById, getReportByShareToken } from '@/lib/api/reports';
import type { IndividualReport, MatchReport } from '@/lib/types';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PreviewPageProps {
  searchParams: Promise<{
    token?: string;
    individualToken?: string;
  }>;
}

export default async function ReportPreviewDevPage({ searchParams }: PreviewPageProps) {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  const { token, individualToken } = await searchParams;

  let report: MatchReport | null = null;
  let individualReport: IndividualReport | null = null;

  if (token) {
    const trimmed = token.trim();
    if (UUID_REGEX.test(trimmed)) {
      report = await getMatchReportById(trimmed);
    } else {
      report = await getReportByShareToken(trimmed);
    }
  }

  if (individualToken) {
    individualReport = await getIndividualReportByToken(individualToken.trim());
  }

  return (
    <ReportDevPreview
      initialReport={report}
      initialIndividualReport={individualReport}
    />
  );
}
