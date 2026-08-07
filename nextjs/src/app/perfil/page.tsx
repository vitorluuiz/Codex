import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { StateMessage } from '@/components/feedback/StateMessage';
import { ProfileView } from '@/components/profile/ProfileView';
import { getLeaderProfile } from '@/lib/api/profile';
import { getActiveRooms } from '@/lib/api/rooms';
import { getSession } from '@/lib/api/session';

export const metadata: Metadata = { title: 'Meu perfil' };

/** Conjuntos e histórico mudam a cada partida conduzida. */
export const dynamic = 'force-dynamic';

export default async function MyProfilePage() {
  const session = await getSession();
  if (!session.user) redirect('/entrar');

  // Duas rotas porque são duas perguntas diferentes: o perfil é público (aceita
  // um userId no caminho), a lista de salas de pé é da sessão. Ver
  // `lib/api/rooms.ts` — falha nela vira lista vazia, não derruba o perfil.
  const [profile, activeRooms] = await Promise.all([getLeaderProfile(), getActiveRooms()]);

  if (!profile) {
    return (
      <StateMessage
        variant="centered"
        title="Perfil indisponível"
        hint="API_BASE_URL / GET /users/me/profile"
      >
        A tela está pronta, mas a API que guarda conjuntos e histórico de partidas ainda não
        respondeu. Veja `docs/api-first-contract.md` para o contrato esperado.
      </StateMessage>
    );
  }

  return <ProfileView profile={profile} isOwnProfile activeRooms={activeRooms} />;
}
