import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { StateMessage } from '@/components/feedback/StateMessage';
import { ProfileView } from '@/components/profile/ProfileView';
import { getLeaderProfile } from '@/lib/api/profile';
import { getActiveRooms } from '@/lib/api/rooms';
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

  const isOwnProfile = session.user?.id === profile.user.id;

  // Só no próprio perfil, e aqui o motivo é diferente do de `/perfil`: esta rota
  // também é alcançada com o próprio id, e `GET /rooms/active` responde pela
  // sessão. Sem esta guarda, abrir o perfil de outra pessoa mostraria as
  // *minhas* salas debaixo do nome dela.
  const activeRooms = isOwnProfile ? await getActiveRooms() : [];

  return <ProfileView profile={profile} isOwnProfile={isOwnProfile} activeRooms={activeRooms} />;
}
