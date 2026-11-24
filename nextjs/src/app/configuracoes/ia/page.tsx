import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AiQuotaView } from '@/components/settings/AiQuotaView';
import { getAiUsage } from '@/lib/api/ai';
import { getSession } from '@/lib/api/session';

export const metadata: Metadata = {
  title: 'Uso de cotas de IA',
};

/** O consumo de créditos e sugestões muda a cada geração de IA. */
export const dynamic = 'force-dynamic';

export default async function AiQuotaSettingsPage() {
  const [session, usage] = await Promise.all([getSession(), getAiUsage()]);
  if (!session.user) redirect('/entrar');

  return (
    <AiQuotaView
      user={session.user}
      initialUsage={usage}
      fetchedAtIso={new Date().toISOString()}
    />
  );
}
