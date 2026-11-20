import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PlanIntentView } from '@/components/settings/PlanIntentView';
import { getPlanIntent } from '@/lib/api/billing';
import { getSession } from '@/lib/api/session';

export const metadata: Metadata = {
  title: 'Pagamentos e plano',
};

/** A intenção registrada pelo usuário pode ser atualizada a qualquer momento. */
export const dynamic = 'force-dynamic';

export default async function BillingSettingsPage() {
  const [session, intent] = await Promise.all([getSession(), getPlanIntent()]);
  if (!session.user) redirect('/entrar');

  return <PlanIntentView user={session.user} initialIntent={intent} />;
}
