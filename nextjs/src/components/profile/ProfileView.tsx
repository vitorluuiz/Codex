'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Button, Dialog, Input, Tag, Toast, ToastViewport } from '@/components/ds';
import { AppSidebar, type ProfileMode } from '@/components/nav/AppSidebar';
import { AUDIENCE_LABEL } from '@/components/nav/audienceLabels';
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
}

export function ProfileView({ profile, isOwnProfile, activeRooms = [] }: ProfileViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [user, setUser] = useState(profile.user);
  const [profileMode, setProfileMode] = useState<ProfileMode>('leader');
  const [editOpen, setEditOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  function downloadReport(match: LeaderMatchSummary) {
    startTransition(async () => {
      await exportMatchReportAction(match.id);
      setToast(`${match.setTitle} · ${match.playedAtLabel}`);
    });
  }

  function closeRoom(room: ActiveRoom) {
    startTransition(async () => {
      await closeRoomAction(room.code);
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
          onSignOut={() => startTransition(() => void logoutAction())}
          profileMode={profileMode}
          onProfileModeChange={setProfileMode}
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
              onEdit={(setId) => router.push(`/conjunto/${setId}`)}
              onStart={(setId) => openRoom(setId)}
            />
            <MatchHistorySection
              matches={profile.matches}
              activeRooms={ledRooms}
              participantsLabel={participantsLabel}
              onDownload={downloadReport}
              onCloseRoom={closeRoom}
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
