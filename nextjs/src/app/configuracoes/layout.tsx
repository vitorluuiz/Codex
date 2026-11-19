import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Container } from '@/components/ds';
import { AppSidebar } from '@/components/nav/AppSidebar';
import { AUDIENCE_LABEL } from '@/components/nav/audienceLabels';
import { SettingsSidebar } from '@/components/settings/SettingsSidebar';
import styles from '@/components/settings/SettingsLayout.module.css';
import { getActiveRooms } from '@/lib/api/rooms';
import { getSession } from '@/lib/api/session';

export const dynamic = 'force-dynamic';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const [session, activeRooms] = await Promise.all([getSession(), getActiveRooms()]);
  if (!session.user) redirect('/entrar');

  return (
    <div className={styles.layout}>
      <AppSidebar
        user={session.user}
        audienceLabel={AUDIENCE_LABEL[session.user.audience]}
        active="configuracoes"
        activeRooms={activeRooms}
      />

      <main className={styles.main}>
        <Container size="narrow" padded={false} className={styles.container}>
          <SettingsSidebar />
          <div className={styles.content}>{children}</div>
        </Container>
      </main>
    </div>
  );
}
