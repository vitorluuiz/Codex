'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Button, Dialog, Input, Tag, Toast, ToastViewport } from '@/components/ds';
import { AppSidebar, type ProfileMode } from '@/components/nav/AppSidebar';
import { AUDIENCE_LABEL } from '@/components/nav/audienceLabels';
import { readStoredProfileMode, writeStoredProfileMode } from '@/components/nav/profileMode';
import { clearLastActiveRoomIfMatches } from '@/components/nav/sidebarSubmenus';
import { logoutAction } from '@/lib/actions/auth';
import { createRoomAction, exportMatchReportAction, updateProfileAction } from '@/lib/actions/profile';
import { closeRoomAction } from '@/lib/actions/room';
import { cx } from '@/lib/cx';
import { roomPath } from '@/lib/roomPath';
import type { ActiveRoom, Audience, LeaderMatchSummary, LeaderProfile } from '@/lib/types';
import { MatchHistorySection } from './MatchHistorySection';
import { ParticipantProfileSection } from './ParticipantProfileSection';
import { MOCK_PARTICIPANT_PROFILE } from './participantMock';
import { SetsSection } from './SetsSection';
import styles from './Profile.module.css';

/** Quem recruta chama a turma de outra coisa. Só o vocabulário muda. */
const PARTICIPANTS_LABEL: Record<Audience, string> = {
  teacher: 'Participantes',
  recruiter: 'Candidatos',
};

interface ProfileViewProps {
  profile: LeaderProfile;
  /** `false` quando se está olhando o perfil de outra pessoa. */
  isOwnProfile: boolean;
  /**
   * Salas ainda de pé de quem está **olhando** (`GET /rooms/active` é resolvida
   * pela sessão, não pelo `userId` da URL). Num perfil alheio a página não a
   * busca: mostrar aqui as minhas salas seria confundir de quem é o perfil, e
   * mostrar as do dono entregaria o código de sala dele a qualquer visitante.
   */
  activeRooms?: ActiveRoom[];
  /** Modo inicial resolvido no servidor a partir da URL ou do cookie. */
  initialProfileMode?: ProfileMode;
  /** Preenchido quando a URL especificou `?modo=lider` ou `?modo=participante`. */
  explicitProfileMode?: ProfileMode;
}

export function ProfileView({
  profile,
  isOwnProfile,
  activeRooms = [],
  initialProfileMode = 'leader',
  explicitProfileMode,
}: ProfileViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [user, setUser] = useState(profile.user);
  const [profileMode, setProfileMode] = useState<ProfileMode>(
    isOwnProfile ? initialProfileMode : 'leader',
  );
  const [editOpen, setEditOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!isOwnProfile) return;
    if (explicitProfileMode) {
      setProfileMode(explicitProfileMode);
      writeStoredProfileMode(explicitProfileMode);
    } else {
      setProfileMode(readStoredProfileMode());
    }
  }, [isOwnProfile, explicitProfileMode]);

  function handleProfileModeChange(nextMode: ProfileMode) {
    setProfileMode(nextMode);
    writeStoredProfileMode(nextMode);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('modo', nextMode === 'participant' ? 'participante' : 'lider');
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    } catch {
      // Ignora erro caso history.replaceState não esteja disponível
    }
  }

  const audienceLabel = AUDIENCE_LABEL[user.audience];
  const participantsLabel = PARTICIPANTS_LABEL[user.audience];

  const ledRooms = activeRooms.filter((room) => room.role === 'leader');
  const joinedRoom = activeRooms.find((room) => room.role === 'participant');

  function openRoom(setId?: string) {
    startTransition(async () => {
      const code = await createRoomAction(setId);
      router.push(`/sala/${code}/lobby`);
    });
  }

  function closeRoom(room: ActiveRoom) {
    startTransition(async () => {
      await closeRoomAction(room.code);
      clearLastActiveRoomIfMatches(room.code);
      router.refresh();
    });
  }

  return (
    <div className={cx(styles.layout, !isOwnProfile && styles.layoutSolo)}>
          {isOwnProfile && (
            <AppSidebar
              user={user}
              audienceLabel={audienceLabel}
              active="perfil"
              activeRooms={activeRooms}
              onSignOut={() => startTransition(() => void logoutAction())}
              profileMode={profileMode}
              onProfileModeChange={handleProfileModeChange}
            />
          )}

          <main className={styles.content}>
            <header className={styles.header}>
              <div className={styles.identity}>
                <Avatar index={user.avatarIndex} size="xl" name={user.name} />
                <div>
                  <div className={styles.nameRow}>
                    <h1 className={styles.name}>{user.name}</h1>
                    <Tag tone="blue">{audienceLabel}</Tag>
                  </div>
                  <p className={styles.email}>{user.email}</p>
                </div>
              </div>

              {isOwnProfile && (
                <div className={styles.headerActions}>
                  <Button variant="secondary" onClick={() => setEditOpen(true)}>
                    Editar perfil
                  </Button>
                  {profileMode === 'leader' ? (
                    <Button onClick={() => openRoom()}>Criar sala</Button>
                  ) : (
                    <>
                      {joinedRoom && (
                        <Button variant="secondary" onClick={() => router.push(roomPath(joinedRoom))}>
                          Retornar à sala
                        </Button>
                      )}
                      <Button onClick={() => router.push('/sala')}>Entrar em uma sala</Button>
                    </>
                  )}
                </div>
              )}
            </header>

            {profileMode === 'leader' ? (
              <>
                <SetsSection
                  sets={profile.sets}
                  onCreate={() => router.push('/conjunto/novo')}
                  onEdit={(setId) => router.push(`/conjunto/${setId}/editar`)}
                  onStart={(setId) => openRoom(setId)}
                />
                <MatchHistorySection
                  matches={profile.matches}
                  activeRooms={ledRooms}
                  participantsLabel={participantsLabel}
                  onCloseRoom={closeRoom}
                  onCreateRoom={isOwnProfile ? () => openRoom() : undefined}
                />
              </>
            ) : (
              <ParticipantProfileSection data={MOCK_PARTICIPANT_PROFILE} />
            )}
          </main>

          {editOpen && (
            <EditProfileDialog
              name={user.name}
              email={user.email}
              onClose={() => setEditOpen(false)}
              onSaved={(saved) => {
                setUser(saved);
                setEditOpen(false);
              }}
            />
          )}

          {toast && (
            <ToastViewport>
              <Toast
                tone="success"
                title="Relatório solicitado"
                message={toast}
                onClose={() => setToast(null)}
              />
            </ToastViewport>
          )}
        </div>
  );
}

      /* -------------------------------------------------------------------------- */

      function EditProfileDialog({
        name: initialName,
      email: initialEmail,
      onClose,
      onSaved,
}: {
        name: string;
      email: string;
  onClose: () => void;
  onSaved: (user: LeaderProfile['user']) => void;
}) {
  const [name, setName] = useState(initialName);
      const [email, setEmail] = useState(initialEmail);
      const [pending, startTransition] = useTransition();

      const invalid = !name.trim() || !email.trim();

      function save() {
    if (invalid) return;
    startTransition(async () => {
        onSaved(await updateProfileAction({ name: name.trim(), email: email.trim() }));
    });
  }

      return (
      <Dialog open title="Editar perfil" onClose={onClose}>
        <div className={styles.dialogFields}>
          <Input label="Nome" value={name} onChange={(event) => setName(event.target.value)} />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={invalid || pending}>
              Salvar
            </Button>
          </div>
        </div>
      </Dialog>
      );
}
