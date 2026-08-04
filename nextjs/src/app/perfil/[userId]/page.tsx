import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { StateMessage } from '@/components/feedback/StateMessage';
import { ProfileView } from '@/components/profile/ProfileView';
import { getLeaderProfile } from '@/lib/api/profile';
import { getSession } from '@/lib/api/session';

export const metadata: Metadata = { title: 'Perfil' };

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ userId: string }>;
}

/**
 * Perfil de outra pessoa — é para cá que o lobby manda ao clicar em "Ver perfil"
 * de um jogador. Mesma tela, sem a barra lateral da conta e sem os botões de
 * edição, que a API também não autorizaria.
 */
export default async function UserProfilePage({ params }: PageProps) {
  const { userId } = await params;
  const [session, profile] = await Promise.all([getSession(), getLeaderProfile(userId)]);

  if (!profile) {
    return (
      <StateMessage
        variant="centered"
        title="Perfil indisponível"
        hint={`API_BASE_URL / GET /users/${userId}/profile`}
      >
        A tela está pronta, mas a API que guarda os perfis ainda não respondeu.
      </StateMessage>
    );
  }

  if (!profile.user) notFound();

  return <ProfileView profile={profile} isOwnProfile={session.user?.id === profile.user.id} />;
}
