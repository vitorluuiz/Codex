import { ReportsHistoryView } from '@/components/reports/ReportsHistoryView';
import { getUserReportsHistory } from '@/lib/api/reports';
import { getSession } from '@/lib/api/session';

export const dynamic = 'force-dynamic';

export default async function RelatoriosPage() {
  const session = await getSession();
  const user = session?.user ?? null;

  const history = user ? await getUserReportsHistory(user.id) : null;

  return <ReportsHistoryView user={user} serverHistory={history} />;
}
