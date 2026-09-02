import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthPanel } from '@/components/auth/AuthPanel';
import { ImageSlot } from '@/components/media/ImageSlot';
import { getSession } from '@/lib/api/session';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Entrar ou criar conta',
};

interface PageProps {
  searchParams: Promise<{ modo?: string }>;
}

/**
 * Server Component: monta a moldura e decide a aba inicial pela query string.
 * Toda a interação (troca de aba, validação, submit) vive em `<AuthPanel>`.
 */
export default async function AuthPage({ searchParams }: PageProps) {
  const [{ modo }, session] = await Promise.all([searchParams, getSession()]);
  if (session.user) redirect('/perfil');

  const initialMode = modo === 'criar' ? 'signup' : 'login';

  return (
    <main className={styles.page}>
      <aside className={styles.aside}>
        <Link href="/" className={styles.brand}>
          Codex
        </Link>
        <div>
          <ImageSlot
            placeholder="Ilustração: foguete, estrelas, confete"
            onDark
            width={520}
            height={260}
            className={styles.asideArt}
          />
          <h1 className={styles.asideTitle}>Pratique como um jogo. Aprenda como um profissional.</h1>
          <p className={styles.asideLead}>
            Junte-se a milhares de estudantes construindo sua sequência diária de estudos.
          </p>
        </div>
        <div />
      </aside>

      <div className={styles.formColumn}>
        <div className={styles.formShell}>
          <AuthPanel initialMode={initialMode} />
        </div>
      </div>
    </main>
  );
}
