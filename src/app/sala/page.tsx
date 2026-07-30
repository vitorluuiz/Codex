import type { Metadata } from 'next';

import { JoinRoomFlow } from '@/components/join/JoinRoomFlow';
import { getSession } from '@/lib/api/session';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Entrar na sala',
};

interface PageProps {
  searchParams: Promise<{ codigo?: string }>;
}

/**
 * Server Component: resolve a sessão (para pré-preencher o nome de quem já está
 * autenticado) e delega os dois passos ao Client Component.
 */
export default async function JoinRoomPage({ searchParams }: PageProps) {
  const [{ codigo }, session] = await Promise.all([searchParams, getSession()]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>Codex</div>
        <JoinRoomFlow
          initialCode={codigo?.replace(/\D/g, '').slice(0, 6) ?? ''}
          suggestedName={session.user?.name ?? ''}
          isAuthenticated={Boolean(session.user)}
        />
      </div>
    </main>
  );
}
