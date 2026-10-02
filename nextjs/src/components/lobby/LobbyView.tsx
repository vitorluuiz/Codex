'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useMemo, useState, useTransition } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Button, Popover, Switch, Tooltip, anchorFrom, type AnchorRect } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { RealtimeProvider, useRealtimeEvent } from '@/realtime/RealtimeProvider';
import { channels } from '@/realtime/protocol';
import {
  approveParticipantAction,
  closeRoomAction,
  rejectParticipantAction,
  removeParticipantAction,
  startMatchAction,
  updateRoomSettingsAction,
} from '@/lib/actions/room';
import type { RoomQueue } from '@/lib/api/rooms';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type { ActiveRoom, Participant, Room } from '@/lib/types';
import { PhaseQueuePanel } from './PhaseQueuePanel';
import { PhaseSetsPanel } from './PhaseSetsPanel';
import styles from './Lobby.module.css';

interface LobbyViewProps {
  room: Room;
  isLeader: boolean;
  /** `null` para o líder, que participa da sala sem ser um participante dela. */
  viewerParticipantId: string | null;
  /** Entrou mas o líder ainda não decidiu: vê a tela de espera por aprovação. */
  awaitingApproval: boolean;
  initialApproved: Participant[];
  initialPending: Participant[];
  initialQueue: RoomQueue;
}

/**
 * Insere ou substitui por `id`. Todo handler de tempo real precisa ser
 * idempotente: um evento pode chegar repetido (reentrega, reconexão) e um
 * `[...list, participant]` cru transformaria isso em dois cards da mesma pessoa.
 */
function upsert(list: Participant[], participant: Participant): Participant[] {
  const index = list.findIndex((p) => p.id === participant.id);
  if (index === -1) return [...list, participant];

  const next = [...list];
  next[index] = participant;
  return next;
}

export function LobbyView(props: LobbyViewProps) {
  return (
    <RealtimeProvider roomCode={props.room.code} channels={channelsFor(props)}>
      {/*
        A `key` remonta o conteúdo quando a aprovação sai. Enquanto esperava, o
        socket não recebia nada da sala (o canal é só de aprovado), então as
        listas em `useState` envelheceram; remontar as ressemeia com o que o
        `router.refresh()` acabou de trazer, em vez de reconciliar sobre estado
        que ficou parado no tempo.
      */}
      <LobbyContent key={props.awaitingApproval ? 'awaiting' : 'member'} {...props} />
    </RealtimeProvider>
  );
}

/**
 * §3 do contrato de WS reserva `room:{code}` a participante aprovado — pedir esse
 * canal enquanto se está pendente só renderia `FORBIDDEN_CHANNEL`. Quem espera
 * aprovação assina o próprio canal privado, por onde a decisão do líder chega.
 *
 * **O aprovado também assina o próprio canal**, e não só o da sala. `participant.
 * removed` é privado por construção (§5) e é o evento que o serviço de WS usa
 * para fechar o socket de quem foi expulso (§10: "só mandar o evento deixa a
 * conexão viva recebendo eventos da sala"). Sem esta assinatura não havia
 * ninguém escutando aquele canal: o expulso continuava recebendo o lobby inteiro
 * e a tela nunca ficava sabendo. É a mesma lista que a tela de partida já monta.
 */
function channelsFor({ room, isLeader, viewerParticipantId, awaitingApproval }: LobbyViewProps) {
  if (isLeader) return [channels.room(room.code), channels.leader(room.code)];
  if (viewerParticipantId === null) return [channels.room(room.code)];
  if (awaitingApproval) return [channels.participant(viewerParticipantId)];
  return [channels.room(room.code), channels.participant(viewerParticipantId)];
}

function LobbyContent({
  room,
  isLeader,
  viewerParticipantId,
  awaitingApproval,
  initialApproved,
  initialPending,
  initialQueue,
}: LobbyViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rejected, setRejected] = useState(false);

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
      setPending((list) => upsert(list, participant));
    } else if (participant.status === 'approved') {
      setApproved((list) => upsert(list, participant));
    }
  });

  useRealtimeEvent('participant.updated', ({ participant }) => {
    // O mesmo evento chega por dois canais com significados diferentes: no canal
    // da sala é "o card de fulano mudou"; no canal privado é a decisão do líder
    // sobre quem está olhando a tela. Este trecho trata o segundo caso.
    if (participant.id === viewerParticipantId && !isLeader) {
      if (participant.status === 'approved') {
        // Recarrega em vez de montar o lobby com o que estava em memória: durante
        // a espera nenhum evento da sala chegou, então a lista de jogadores aqui
        // está parada no instante em que a pessoa pediu para entrar.
        setApproved((list) => upsert(list, participant));
        router.refresh();
      } else if (participant.status === 'rejected') {
        setRejected(true);
      }
      return;
    }

    setPending((list) => list.filter((p) => p.id !== participant.id));
    setApproved((list) =>
      participant.status === 'approved'
        ? upsert(list, participant)
        : list.filter((p) => p.id !== participant.id),
    );
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

  useRealtimeEvent('match.returned-to-lobby', () => {
    router.refresh();
  });

  // Expulso pelo líder. Chega só pelo canal privado, e o serviço de WS fecha o
  // socket logo em seguida (§10) — daí a saída ser imediata em vez de um card
  // com botão como o de "recusado": a tela atrás já parou de receber
  // atualização, e deixá-la no ar mostraria um lobby congelado.
  //
  // `replace`, não `push`: o lobby de onde a pessoa acabou de sair responde 404
  // para ela agora, então voltar por ele não é um caminho que exista mais.
  useRealtimeEvent('participant.removed', () => {
    router.replace('/sala?saida=removido');
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
    setApproved((list) => upsert(list, { ...participant, status: 'approved' }));
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

  function closeRoom(room: Room) {
    startTransition(async () => {
      await closeRoomAction(room.code);
      router.back();
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
            <Link href="/" className={styles.brand}>
              Codex
            </Link>
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
                  <Switch
                    label="Trancar sala"
                    labelPosition="start"
                    checked={locked}
                    onChange={toggleLocked}
                  />
                </div>
                <div className={styles.toggleGroup}>
                  <Switch
                    label="Exigir conta"
                    labelPosition="start"
                    checked={requireAccount}
                    onChange={toggleRequireAccount}
                  />
                </div>
                <div className={styles.startActions}>
                  <Tooltip label="Encerra a sala definitivamente.">
                    <Button
                      variant="danger"
                      onClick={() => closeRoom(room)}
                    >
                      Fechar sala
                    </Button>
                  </Tooltip>
                  <Tooltip label="Cada participante avança pelas fases no próprio ritmo, quando quiser.">
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
                        className={cx(
                          styles.compactTile,
                          participant.inResults && styles.compactTileAway,
                        )}
                        title={
                          participant.inResults
                            ? `${participant.displayName} ainda está vendo os resultados da partida anterior`
                            : undefined
                        }
                        onClick={(event) =>
                          setSelected({ participant, anchor: anchorFrom(event.currentTarget) })
                        }
                      >
                        <Avatar index={participant.avatarIndex} size="md" name={participant.displayName} />
                        <span className={styles.compactName}>{participant.displayName}</span>
                        {/*
                          Quem não voltou do pódio não entra na contagem de jogadores da
                          próxima partida — a marca existe para o líder não iniciar
                          achando que a turma toda está aqui.
                        */}
                        {participant.inResults && (
                          <span className={styles.compactBadge}>nos resultados</span>
                        )}
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
                          <button
                            type="button"
                            className={cx(styles.decisionButton, styles.approveButton)}
                            disabled={requireAccount && !participant.loggedIn}
                            title="Aceitar"
                            aria-label={`Aceitar ${participant.displayName}`}
                            onClick={() => approve(participant)}
                          >
                            <Icon.Check size={16} />
                          </button>
                          <button
                            type="button"
                            className={cx(styles.decisionButton, styles.rejectButton)}
                            title="Recusar"
                            aria-label={`Recusar ${participant.displayName}`}
                            onClick={() => reject(participant)}
                          >
                            <Icon.Close size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className={styles.leaderColumn}>
              <PhaseSetsPanel roomCode={room.code} sets={setsWithCounts} onQueueChange={setQueue} />
              <PhaseQueuePanel roomCode={room.code} queue={queue} onQueueChange={setQueue} />
            </div>
          </div>
        ) : rejected ? (
          <section className={styles.waitingCard}>
            <h1 className={styles.waitingTitle}>Solicitação recusada</h1>
            <p className={styles.waitingLead}>
              {room.leader.name} não aprovou sua entrada na sala {room.code}.
            </p>
            <Button onClick={() => router.push('/sala')}>Entrar em outra sala</Button>
          </section>
        ) : awaitingApproval ? (
          <section className={styles.waitingCard}>
            <h1 className={styles.waitingTitle}>Solicitação enviada</h1>
            <p className={styles.waitingLead}>
              Seu pedido para entrar na sala {room.code} chegou para {room.leader.name}. Assim que
              ele aceitar, você entra direto no lobby — pode deixar esta tela aberta.
            </p>

            <p className={styles.waitingStatus}>
              Esperando o líder aceitar sua solicitação para entrar
              <span className={styles.dots}>
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
              </span>
            </p>
          </section>
        ) : (
          <section className={styles.waitingCard}>
            <h1 className={styles.waitingTitle}>Compartilhe o código com a turma</h1>
            <p className={styles.waitingLead}>
              Quem tiver o código pode pedir para entrar. O líder aprova antes da partida começar.
            </p>

            <div className={styles.playerGrid}>
              {approved.map((participant) => (
                <div
                  key={participant.id}
                  className={cx(styles.playerTile, participant.inResults && styles.playerTileAway)}
                >
                  <Avatar index={participant.avatarIndex} size="lg" name={participant.displayName} />
                  <span className={styles.playerName}>{participant.displayName}</span>
                  {participant.inResults && (
                    <span className={styles.playerNote}>nos resultados</span>
                  )}
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
