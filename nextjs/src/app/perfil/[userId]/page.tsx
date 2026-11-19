import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { StateMessage } from '@/components/feedback/StateMessage';
import {
  PROFILE_MODE_COOKIE,
  parseProfileMode,
  type ProfileMode,
} from '@/components/nav/profileMode';
import { ProfileView } from '@/components/profile/ProfileView';
import { getLeaderProfile } from '@/lib/api/profile';
import { getActiveRooms } from '@/lib/api/rooms';
import { getSession } from '@/lib/api/session';

export const metadata: Metadata = { title: 'Perfil' };

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ modo?: string }>;
}

/**
 * Perfil de outra pessoa — é para cá que o lobby manda ao clicar em "Ver perfil"
 * de um jogador. Mesma tela, sem a barra lateral da conta e sem os botões de
 * edição, que a API também não autorizaria.
 */
export default async function UserProfilePage({ params, searchParams }: PageProps) {
  const [{ userId }, { modo }, cookieStore] = await Promise.all([
    params,
    searchParams,
    cookies(),
  ]);
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

  const explicitProfileMode = isOwnProfile ? parseProfileMode(modo) : null;
  const initialProfileMode: ProfileMode = isOwnProfile
    ? (explicitProfileMode ??
        parseProfileMode(cookieStore.get(PROFILE_MODE_COOKIE)?.value) ??
        'leader')
    : 'leader';

  return (
    <ProfileView
      profile={profile}
      isOwnProfile={isOwnProfile}
      activeRooms={activeRooms}
      initialProfileMode={initialProfileMode}
      explicitProfileMode={explicitProfileMode ?? undefined}
    />
  );
}
