import type { Metadata } from 'next';
import Link from 'next/link';

import { JoinRoomFlow, type JoinErrorState } from '@/components/join/JoinRoomFlow';
import { AnimatedBackground } from '@/components/media/AnimatedBackground';
import { LeftRoomNotice } from '@/components/room/LeftRoomNotice';
import { ResumeRoomPanel } from '@/components/room/ResumeRoomPanel';
import { SalaBackButton } from '@/components/room/SalaBackButton';
import { checkRoomCodeAction } from '@/lib/actions/room';
import { getActiveRooms } from '@/lib/api/rooms';
import { getSession } from '@/lib/api/session';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Entrar na sala',
};

/** As salas de que a pessoa faz parte mudam a cada partida — nada aqui é cacheável. */
export const dynamic = 'force-dynamic';

interface PageProps {
  /** `saida` explica um pouso involuntário aqui — ex.: `removido` ou `encerrada`. */
  searchParams: Promise<{ codigo?: string; saida?: string }>;
}

/**
 * Server Component: resolve a sessão, busca salas ativas e, quando a pessoa
 * chega por um link de convite com 6 dígitos (`?codigo=XXXXXX`), já valida a
 * disponibilidade no servidor para abrir direto no passo 2 (ou mostrar o motivo
 * de bloqueio sem clique redundante).
 */
export default async function JoinRoomPage({ searchParams }: PageProps) {
  const [{ codigo, saida }, session, activeRooms] = await Promise.all([
    searchParams,
    getSession(),
    getActiveRooms(),
  ]);

  const initialCode = codigo?.replace(/\D/g, '').slice(0, 6) ?? '';
  const matchedActiveRoom =
    initialCode.length === 6
      ? activeRooms.find((room) => room.code === initialCode) ?? null
      : null;

  let initialStep: 'code' | 'name' = 'code';
  let initialError: JoinErrorState | null = null;

  if (initialCode.length === 6 && !matchedActiveRoom) {
    const availability = await checkRoomCodeAction(initialCode);
    if (availability.ok) {
      initialStep = 'name';
    } else {
      initialError = { reason: availability.reason, message: availability.message };
    }
  }

  const bgVideo = process.env.NEXT_PUBLIC_SALA_BG_VIDEO?.trim() || null;

  return (
    <main className={styles.page}>
      <AnimatedBackground mode={bgVideo ? 'video' : 'canvas'} videoSrc={bgVideo} />
      <div className={styles.container}>
        <SalaBackButton />
        <div className={styles.card}>
          <Link href="/" className={styles.brand}>
            Codex
          </Link>
          <LeftRoomNotice reason={saida} />
          {!initialCode && <ResumeRoomPanel rooms={activeRooms} />}
          <JoinRoomFlow
            initialCode={initialCode}
            initialStep={initialStep}
            initialError={initialError}
            activeRooms={activeRooms}
            suggestedName={session.user?.name ?? ''}
            isAuthenticated={Boolean(session.user)}
          />
        </div>
      </div>
    </main>
  );
}
