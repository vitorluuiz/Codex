'use client';

import { useState, useTransition } from 'react';

import { Button, Dialog, Input, TextArea } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import {
  getQueuedPhaseDetailAction,
  removeQueuedPhaseAction,
  reorderQueueAction,
  updateQueuedPhaseAction,
} from '@/lib/actions/room';
import type { RoomQueue } from '@/lib/api/rooms';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type { Phase } from '@/lib/types';
import lobbyStyles from './Lobby.module.css';
import styles from './PhaseQueuePanel.module.css';

type QueuedPhase = RoomQueue['phases'][number];

interface PhaseQueuePanelProps {
  roomCode: string;
  queue: RoomQueue;
  onQueueChange: (queue: RoomQueue) => void;
}

export function PhaseQueuePanel({ roomCode, queue, onQueueChange }: PhaseQueuePanelProps) {
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [editing, setEditing] = useState<QueuedPhase | null>(null);

  const colorBySet = new Map(queue.sets.map((set) => [set.setId, set.color]));

  function drop(targetId: string) {
    const fromId = dragId;
    setDragId(null);
    setOverId(null);
    if (!fromId || fromId === targetId) return;

    const ids = queue.phases.map((phase) => phase.id);
    const fromIndex = ids.indexOf(fromId);
    const toIndex = ids.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    ids.splice(toIndex, 0, ...ids.splice(fromIndex, 1));
    startTransition(async () => onQueueChange(await reorderQueueAction(roomCode, ids)));
  }

  function removePhase(phaseId: string) {
    startTransition(async () => onQueueChange(await removeQueuedPhaseAction(roomCode, phaseId)));
  }

  return (
    <section className={lobbyStyles.panel}>
      <h2 className={lobbyStyles.panelTitle}>Fila de fases ({queue.phases.length})</h2>

      {queue.phases.length === 0 ? (
        <p className={lobbyStyles.emptyNote}>Nenhuma fase na fila ainda.</p>
      ) : (
        <ol className={styles.list}>
          {queue.phases.map((phase, index) => (
            <li
              key={phase.id}
              draggable
              onDragStart={() => setDragId(phase.id)}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setOverId(phase.id);
              }}
              onDrop={() => drop(phase.id)}
              className={cx(
                styles.row,
                dragId === phase.id && styles.dragging,
                overId === phase.id && dragId !== phase.id && styles.dropTarget,
              )}
              style={cssVars({ '--set-color': colorBySet.get(phase.setId) ?? 'var(--ink-300)' })}
            >
              <span className={styles.grip} aria-hidden>
                <Icon.Grip size={16} />
              </span>
              <PhaseThumb kind={phase.kind} />
              <button
                type="button"
                className={styles.info}
                title="Clique para editar"
                onClick={() => setEditing(phase)}
              >
                <span className={styles.nameRow}>
                  <span className={styles.index}>{index + 1}</span>
                  <span className={styles.name}>{phase.name}</span>
                </span>
                <span className={styles.meta}>{phaseMetaLabel(phase)}</span>
              </button>
              <button
                type="button"
                className={styles.removeButton}
                title="Remover fase"
                aria-label={`Remover ${phase.name}`}
                onClick={() => removePhase(phase.id)}
              >
                <Icon.Close size={11} />
              </button>
            </li>
          ))}
        </ol>
      )}

      {editing && (
        <EditPhaseDialog
          roomCode={roomCode}
          phase={editing}
          onQueueChange={onQueueChange}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

/**
 * Miniatura abstrata do tipo de fase, sem texto: numa fila longa o líder
 * reconhece quiz, código, dissertativa e “completar frase” pela forma, sem
 * precisar ler o enunciado.
 */
function PhaseThumb({ kind }: { kind: string }) {
  if (kind === 'code') {
    return (
      <div className={styles.thumb} aria-hidden>
        <span className={cx(styles.thumbBar, styles.codeBar)} />
        <div className={styles.codeBlock}>
          <span className={styles.codeLine} />
          <span className={cx(styles.codeLine, styles.codeLineAccent)} />
        </div>
      </div>
    );
  }

  if (kind === 'text') {
    return (
      <div className={styles.thumb} aria-hidden>
        <span className={cx(styles.thumbBar, styles.textBar)} />
        <span className={styles.textArea} />
      </div>
    );
  }

  if (kind === 'fill') {
    return (
      <div className={styles.thumb} aria-hidden>
        <span className={cx(styles.thumbBar, styles.fillBar)} />
        <div className={styles.fillChips}>
          <span className={styles.fillChip} />
          <span className={cx(styles.fillChip, styles.fillChipShort)} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.thumb} aria-hidden>
      <span className={cx(styles.thumbBar, styles.quizBar)} />
      <div className={styles.quizGrid}>
        <span className={cx(styles.quizCell, styles.quizCellCorrect)} />
        <span className={styles.quizCell} />
        <span className={styles.quizCell} />
        <span className={styles.quizCell} />
      </div>
    </div>
  );
}

function phaseMetaLabel(phase: QueuedPhase): string {
  const points = Math.round(phase.basePoints * phase.pointsMultiplier);
  const multiplier = phase.pointsMultiplier !== 1 ? ` (x${phase.pointsMultiplier})` : '';
  return `${points} pts${multiplier} · ${phase.timeSeconds}s`;
}

/* -------------------------------------------------------------------------- */

function EditPhaseDialog({
  roomCode,
  phase,
  onQueueChange,
  onClose,
}: {
  roomCode: string;
  phase: QueuedPhase;
  onQueueChange: (queue: RoomQueue) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(phase.name);
  const [basePoints, setBasePoints] = useState(String(phase.basePoints));
  const [multiplier, setMultiplier] = useState(String(phase.pointsMultiplier));
  const [timeSeconds, setTimeSeconds] = useState(String(phase.timeSeconds));
  const [detail, setDetail] = useState<Phase | null>(null);
  const [, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const queue = await updateQueuedPhaseAction(roomCode, phase.id, {
        name,
        basePoints: Number(basePoints) || 0,
        pointsMultiplier: Number(multiplier) || 1,
        timeSeconds: Number(timeSeconds) || 0,
      });
      onQueueChange(queue);
      onClose();
    });
  }

  function openDetail() {
    startTransition(async () => setDetail(await getQueuedPhaseDetailAction(roomCode, phase.id)));
  }

  if (detail) {
    return (
      <PhaseDetailDialog
        roomCode={roomCode}
        phase={detail}
        onQueueChange={onQueueChange}
        onClose={() => setDetail(null)}
      />
    );
  }

  return (
    <Dialog open title="Editar fase" onClose={onClose}>
      <div className={styles.fields}>
        <Input label="Nome da fase" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          type="number"
          label="Pontuação disponível"
          value={basePoints}
          onChange={(e) => setBasePoints(e.target.value)}
        />
        <Input
          type="number"
          step="0.1"
          label="Multiplicador de pontos"
          value={multiplier}
          onChange={(e) => setMultiplier(e.target.value)}
        />
        <Input
          type="number"
          label="Tempo (segundos)"
          value={timeSeconds}
          onChange={(e) => setTimeSeconds(e.target.value)}
        />
        <Button variant="secondary" block onClick={openDetail}>
          Ver desafio
        </Button>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save}>Salvar</Button>
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Prévia do desafio para o líder. Quiz e “completar frase” já trazem gabarito;
 * texto e código pedem a resposta esperada, que alimenta a correção por IA.
 */
function PhaseDetailDialog({
  roomCode,
  phase,
  onQueueChange,
  onClose,
}: {
  roomCode: string;
  phase: Phase;
  onQueueChange: (queue: RoomQueue) => void;
  onClose: () => void;
}) {
  const needsExpectedAnswer = phase.kind === 'text' || phase.kind === 'code';
  const [expected, setExpected] = useState(
    phase.kind === 'text' ? (phase.expectedAnswer ?? '') : '',
  );
  const [, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const queue = await updateQueuedPhaseAction(roomCode, phase.id, { expectedAnswer: expected });
      onQueueChange(queue);
      onClose();
    });
  }

  return (
    <Dialog open title="Pergunta e respostas" onClose={onClose}>
      <div className={styles.fields}>
        <div>
          <p className={styles.sectionLabel}>Pergunta</p>
          <p className={styles.questionText}>
            {phase.kind === 'quiz' || phase.kind === 'text'
              ? phase.question
              : phase.kind === 'code'
                ? phase.title
                : phase.segments
                    .map((segment) => (segment.type === 'text' ? segment.value : '______'))
                    .join(' ')}
          </p>
        </div>

        {phase.kind === 'quiz' && (
          <div className={styles.options}>
            {phase.options.map((option) => (
              <div key={option.id} className={styles.option}>
                {option.id === phase.correctOptionId && (
                  <Icon.Check size={16} className={styles.optionCorrect} />
                )}
                {option.label}
              </div>
            ))}
          </div>
        )}

        {phase.kind === 'fill' && (
          <div className={styles.words}>
            {phase.words.map((word) => (
              <span
                key={word}
                className={cx(
                  styles.word,
                  phase.correctWords?.includes(word) && styles.wordCorrect,
                )}
              >
                {word}
              </span>
            ))}
          </div>
        )}

        {needsExpectedAnswer && (
          <div>
            <p className={styles.sectionLabel}>Resposta esperada</p>
            <TextArea
              compact
              placeholder="Digite a resposta correta esperada..."
              value={expected}
              onChange={(event) => setExpected(event.target.value)}
            />
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          {needsExpectedAnswer && <Button onClick={save}>Salvar</Button>}
        </div>
      </div>
    </Dialog>
  );
}
