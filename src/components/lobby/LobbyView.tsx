'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Button, Popover, Switch, Tooltip, anchorFrom, type AnchorRect } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { RealtimeProvider, useRealtimeEvent } from '@/realtime/RealtimeProvider';
import { channels } from '@/realtime/protocol';
import {
  approveParticipantAction,
  rejectParticipantAction,
  removeParticipantAction,
  startMatchAction,
  updateRoomSettingsAction,
} from '@/lib/actions/room';
import type { RoomQueue } from '@/lib/api/rooms';
import { cssVars } from '@/lib/cssVars';
import type { Participant, Room } from '@/lib/types';
import { PhaseQueuePanel } from './PhaseQueuePanel';
import { PhaseSetsPanel } from './PhaseSetsPanel';
import styles from './Lobby.module.css';

interface LobbyViewProps {
  room: Room;
  isLeader: boolean;
  initialApproved: Participant[];
  initialPending: Participant[];
  initialQueue: RoomQueue;
}

export function LobbyView(props: LobbyViewProps) {
  return (
    <RealtimeProvider
      roomCode={props.room.code}
      channels={
        props.isLeader
          ? [channels.room(props.room.code), channels.leader(props.room.code)]
          : [channels.room(props.room.code)]
      }
    >
      <LobbyContent {...props} />
    </RealtimeProvider>
  );
}

function LobbyContent({ room, isLeader, initialApproved, initialPending, initialQueue }: LobbyViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [approved, setApproved] = useState(initialApproved);
  const [pending, setPending] = useState(initialPending);
  const [locked, setLocked] = useState(room.locked);
  const [requireAccount, setRequireAccount] = useState(room.requireAccount);
  const [queue, setQueue] = useState(initialQueue);
  const [selected, setSelected] = useState<{ participant: Participant; anchor: AnchorRect } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  /* --- eventos de tempo real --------------------------------------------- */

  useRealtimeEvent('participant.joined', ({ participant }) => {
    if (participant.status === 'pending') {
      setPending((list) => [...list, participant]);
    } else if (participant.status === 'approved') {
      setApproved((list) => [...list, participant]);
    }
  });

  useRealtimeEvent('participant.updated', ({ participant }) => {
    setPending((list) => list.filter((p) => p.id !== participant.id));
    setApproved((list) => {
      const without = list.filter((p) => p.id !== participant.id);
      return participant.status === 'approved' ? [...without, participant] : without;
    });
  });

  useRealtimeEvent('participant.left', ({ participantId }) => {
    setApproved((list) => list.filter((p) => p.id !== participantId));
    setPending((list) => list.filter((p) => p.id !== participantId));
  });

  useRealtimeEvent('room.settings', (message) => {
    setLocked(message.locked);
    setRequireAccount(message.requireAccount);
  });

  useRealtimeEvent('match.started', () => {
    router.push(`/sala/${room.code}/partida`);
  });

  /* --- ações -------------------------------------------------------------- */

  const copyCode = useCallback(() => {
    void navigator.clipboard.writeText(room.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [room.code]);

  function toggleLocked(next: boolean) {
    setLocked(next);
    startTransition(() => void updateRoomSettingsAction(room.code, { locked: next }));
  }

  function toggleRequireAccount(next: boolean) {
    setRequireAccount(next);
    startTransition(() => void updateRoomSettingsAction(room.code, { requireAccount: next }));
  }

  function approve(participant: Participant) {
    setPending((list) => list.filter((p) => p.id !== participant.id));
    setApproved((list) => [...list, { ...participant, status: 'approved' }]);
    startTransition(() => void approveParticipantAction(room.code, participant.id));
  }

  function reject(participant: Participant) {
    setPending((list) => list.filter((p) => p.id !== participant.id));
    startTransition(() => void rejectParticipantAction(room.code, participant.id));
  }

  function remove(participant: Participant) {
    setApproved((list) => list.filter((p) => p.id !== participant.id));
    setSelected(null);
    startTransition(() => void removeParticipantAction(room.code, participant.id));
  }

  function start(mode: 'live' | 'self-paced') {
    startTransition(async () => {
      await startMatchAction(room.code, mode);
      router.push(`/sala/${room.code}/partida`);
    });
  }

  const totalPhases = queue.phases.length;
  const startDisabled = totalPhases === 0 || approved.length === 0;

  const setsWithCounts = useMemo(
    () =>
      queue.sets.map((set) => ({
        ...set,
        phaseCount: queue.phases.filter((phase) => phase.setId === set.setId).length,
      })),
    [queue],
  );

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.brand}>Codex</span>
            {!isLeader && (
              <span className={styles.leaderNote}>
                <Icon.Crown size={16} />
                Líder: {room.leader.name}
              </span>
            )}
          </div>

          <div className={styles.headerRight}>
            <div className={styles.codeChip}>
              <span className={styles.codeLabel}>Código</span>
              <span className={styles.codeValue}>{room.code}</span>
              <button
                type="button"
                className={styles.iconButton}
                onClick={copyCode}
                title={copied ? 'Código copiado' : 'Copiar código'}
                aria-label={copied ? 'Código copiado' : 'Copiar código'}
              >
                {copied ? <Icon.Check size={18} /> : <Icon.Copy size={18} />}
              </button>
            </div>

            <span className={styles.count}>
              <Icon.Users size={18} />
              {approved.length}/{room.capacity}
            </span>

            {isLeader ? (
              <>
                <div className={styles.toggleGroup}>
                  <span>Trancar sala</span>
                  <Switch label="Trancar sala" checked={locked} onChange={toggleLocked} />
                </div>
                <div className={styles.toggleGroup}>
                  <span>Exigir conta</span>
                  <Switch
                    label="Exigir conta"
                    checked={requireAccount}
                    onChange={toggleRequireAccount}
                  />
                </div>
                <div className={styles.startActions}>
                  <Tooltip label="Cada aluno avança pelas fases no próprio ritmo, quando quiser.">
                    <Button
                      variant="secondary"
                      disabled={startDisabled}
                      onClick={() => start('self-paced')}
                    >
                      Permitir início
                    </Button>
                  </Tooltip>
                  <Tooltip label="Todos jogam juntos, fase por fase, em tempo real — como em sala de aula.">
                    <Button disabled={startDisabled} onClick={() => start('live')}>
                      Iniciar ao vivo
                    </Button>
                  </Tooltip>
                </div>
              </>
            ) : (
              locked && (
                <span className={styles.lockedBadge}>
                  <Icon.Lock size={14} />
                  Sala trancada
                </span>
              )
            )}
          </div>
        </header>

        {isLeader ? (
          <div className={styles.leaderGrid}>
            <div className={styles.leaderColumn}>
              <section className={styles.panel}>
                <h2 className={styles.panelTitle}>Jogadores na sala ({approved.length})</h2>
                {approved.length === 0 ? (
                  <p className={styles.emptyNote}>Ninguém entrou ainda.</p>
                ) : (
                  <div className={styles.compactGrid}>
                    {approved.map((participant) => (
                      <button
                        key={participant.id}
                        type="button"
                        className={styles.compactTile}
                        onClick={(event) =>
                          setSelected({ participant, anchor: anchorFrom(event.currentTarget) })
                        }
                      >
                        <Avatar index={participant.avatarIndex} size="md" name={participant.displayName} />
                        <span className={styles.compactName}>{participant.displayName}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className={styles.panel}>
                <h2 className={styles.panelTitle}>Solicitações pendentes ({pending.length})</h2>
                {pending.length === 0 ? (
                  <p className={styles.emptyNote}>Nenhuma solicitação no momento.</p>
                ) : (
                  <div className={styles.pendingList}>
                    {pending.map((participant) => (
                      <div key={participant.id} className={styles.pendingRow}>
                        <Avatar index={participant.avatarIndex} size="sm" name={participant.displayName} />
                        <div className={styles.pendingInfo}>
                          <div className={styles.pendingName}>{participant.displayName}</div>
                          {!participant.loggedIn && (
                            <div className={styles.pendingMeta}>Sem conta</div>
                          )}
                        </div>
                        <div className={styles.pendingActions}>
                          <Button
                            size="sm"
                            disabled={requireAccount && !participant.loggedIn}
                            onClick={() => approve(participant)}
                          >
                            Aceitar
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => reject(participant)}>
                            Recusar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <PhaseSetsPanel roomCode={room.code} sets={setsWithCounts} onQueueChange={setQueue} />

            <PhaseQueuePanel roomCode={room.code} queue={queue} onQueueChange={setQueue} />
          </div>
        ) : (
          <section className={styles.waitingCard}>
            <h1 className={styles.waitingTitle}>Compartilhe o código com a turma</h1>
            <p className={styles.waitingLead}>
              Quem tiver o código pode pedir para entrar. O líder aprova antes da partida começar.
            </p>

            <div className={styles.playerGrid}>
              {approved.map((participant) => (
                <div key={participant.id} className={styles.playerTile}>
                  <Avatar index={participant.avatarIndex} size="lg" name={participant.displayName} />
                  <span className={styles.playerName}>{participant.displayName}</span>
                </div>
              ))}
            </div>

            {setsWithCounts.length > 0 && (
              <div className={styles.groupChips}>
                {setsWithCounts.map((set) => (
                  <span
                    key={set.setId}
                    className={styles.groupChip}
                    style={cssVars({ '--set-color': set.color })}
                  >
                    {set.title} · {set.phaseCount} fases
                  </span>
                ))}
              </div>
            )}

            <p className={styles.waitingStatus}>
              Aguardando {room.leader.name} iniciar a partida
              <span className={styles.dots}>
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
              </span>
            </p>
          </section>
        )}
      </div>

      {selected && (
        <Popover
          anchor={selected.anchor}
          onClose={() => setSelected(null)}
          label={`Ações para ${selected.participant.displayName}`}
        >
          <div className={styles.popoverCard}>
            <div className={styles.popoverHead}>
              <Avatar index={selected.participant.avatarIndex} size="sm" />
              <div>
                <div className={styles.popoverName}>{selected.participant.displayName}</div>
                <div className={styles.popoverMeta}>
                  {selected.participant.loggedIn
                    ? 'Com conta na plataforma'
                    : 'Não entrou com uma conta'}
                </div>
              </div>
            </div>
            <div className={styles.popoverActions}>
              {selected.participant.loggedIn && selected.participant.userId && (
                <Button
                  size="sm"
                  variant="secondary"
                  block
                  onClick={() => router.push(`/perfil/${selected.participant.userId}`)}
                >
                  Ver perfil
                </Button>
              )}
              {isLeader && (
                <Button size="sm" variant="danger" block onClick={() => remove(selected.participant)}>
                  Remover jogador
                </Button>
              )}
            </div>
          </div>
        </Popover>
      )}
    </main>
  );
}
