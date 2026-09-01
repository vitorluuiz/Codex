import type { Metadata } from 'next';
import Link from 'next/link';

import { JoinRoomFlow } from '@/components/join/JoinRoomFlow';
import { LeftRoomNotice } from '@/components/room/LeftRoomNotice';
import { ResumeRoomPanel } from '@/components/room/ResumeRoomPanel';
import { getActiveRooms } from '@/lib/api/rooms';
import { getSession } from '@/lib/api/session';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Entrar na sala',
};

/** As salas de que a pessoa faz parte mudam a cada partida — nada aqui é cacheável. */
export const dynamic = 'force-dynamic';

interface PageProps {
  /** `saida` explica um pouso involuntário aqui — hoje só `removido`. */
  searchParams: Promise<{ codigo?: string; saida?: string }>;
}

/**
 * Server Component: resolve a sessão (para pré-preencher o nome de quem já está
 * autenticado e para oferecer volta às salas em que a pessoa já está) e delega
 * os dois passos ao Client Component.
 *
 * O painel de retomada só aparece quando ninguém chegou com `?codigo=`: um link
 * com código é um convite para *aquela* sala, e empurrar a sala antiga para o
 * topo dele seria oferecer o destino errado.
 */
export default async function JoinRoomPage({ searchParams }: PageProps) {
  const [{ codigo, saida }, session] = await Promise.all([searchParams, getSession()]);
  const initialCode = codigo?.replace(/\D/g, '').slice(0, 6) ?? '';
  const activeRooms = initialCode ? [] : await getActiveRooms();

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Link href="/" className={styles.brand}>
          Codex
        </Link>
        <LeftRoomNotice reason={saida} />
        <ResumeRoomPanel rooms={activeRooms} />
        <JoinRoomFlow
          initialCode={initialCode}
          suggestedName={session.user?.name ?? ''}
          isAuthenticated={Boolean(session.user)}
        />
      </div>
    </main>
  );
}
