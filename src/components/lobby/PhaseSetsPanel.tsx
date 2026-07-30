'use client';

import { useEffect, useState, useTransition } from 'react';

import { Button, Dialog, Input, Popover, Tabs, anchorFrom, type AnchorRect } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import {
  addSetToQueueAction,
  removeSetFromQueueAction,
  searchPhaseSetsAction,
  updateSetDefaultsAction,
} from '@/lib/actions/room';
import type { RoomQueue } from '@/lib/api/rooms';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type { PhaseSetSummary } from '@/lib/types';
import lobbyStyles from './Lobby.module.css';
import styles from './PhaseSetsPanel.module.css';

/** Limite de conjuntos por partida — espelha a regra do servidor. */
const MAX_SETS = 8;

type Scope = 'owned' | 'community';

interface PhaseSetsPanelProps {
  roomCode: string;
  sets: { setId: string; title: string; color: string; phaseCount: number }[];
  onQueueChange: (queue: RoomQueue) => void;
}

export function PhaseSetsPanel({ roomCode, sets, onQueueChange }: PhaseSetsPanelProps) {
  const [, startTransition] = useTransition();
  const [pickerAnchor, setPickerAnchor] = useState<AnchorRect | null>(null);
  const [editingSet, setEditingSet] = useState<{ setId: string; title: string } | null>(null);

  const atCapacity = sets.length >= MAX_SETS;

  function removeSet(setId: string) {
    startTransition(async () => onQueueChange(await removeSetFromQueueAction(roomCode, setId)));
  }

  return (
    <section className={lobbyStyles.panel}>
      <div className={lobbyStyles.panelHead}>
        <h2 className={lobbyStyles.panelTitle}>Conjuntos de fases</h2>
        <Button
          size="sm"
          variant="secondary"
          disabled={atCapacity}
          onClick={(event) => setPickerAnchor(anchorFrom(event.currentTarget))}
        >
          Adicionar conjunto
        </Button>
      </div>

      {sets.length === 0 ? (
        <p className={lobbyStyles.emptyNote}>Nenhum conjunto adicionado ainda.</p>
      ) : (
        <div className={styles.list}>
          {sets.map((set) => (
            <div
              key={set.setId}
              className={styles.setRow}
              style={cssVars({ '--set-color': set.color })}
              role="button"
              tabIndex={0}
              onClick={() => setEditingSet({ setId: set.setId, title: set.title })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setEditingSet({ setId: set.setId, title: set.title });
              }}
            >
              <span className={styles.setTitle}>{set.title}</span>
              <span className={styles.setCount}>{set.phaseCount} fases</span>
              <button
                type="button"
                className={styles.removeButton}
                title="Remover conjunto"
                aria-label={`Remover ${set.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  removeSet(set.setId);
                }}
              >
                <Icon.Close size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {pickerAnchor && (
        <SetPicker
          anchor={pickerAnchor}
          roomCode={roomCode}
          selectedIds={sets.map((set) => set.setId)}
          atCapacity={atCapacity}
          onQueueChange={onQueueChange}
          onClose={() => setPickerAnchor(null)}
        />
      )}

      {editingSet && (
        <SetDefaultsDialog
          roomCode={roomCode}
          setId={editingSet.setId}
          title={editingSet.title}
          onQueueChange={onQueueChange}
          onClose={() => setEditingSet(null)}
        />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function SetPicker({
  anchor,
  roomCode,
  selectedIds,
  atCapacity,
  onQueueChange,
  onClose,
}: {
  anchor: AnchorRect;
  roomCode: string;
  selectedIds: string[];
  atCapacity: boolean;
  onQueueChange: (queue: RoomQueue) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>('owned');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PhaseSetSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Busca no servidor com debounce — a lista de conjuntos pode ser grande demais
  // para filtrar no cliente.
  useEffect(() => {
    let cancelled = false;
    setResults(null);
    setError(null);

    const timer = setTimeout(() => {
      searchPhaseSetsAction(scope, query)
        .then((sets) => {
          if (!cancelled) setResults(sets);
        })
        .catch(() => {
          if (!cancelled) setError('Não foi possível carregar os conjuntos.');
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scope, query]);

  function toggle(set: PhaseSetSummary) {
    const isAdded = selectedIds.includes(set.id);
    if (!isAdded && atCapacity) return;

    startTransition(async () => {
      const queue = isAdded
        ? await removeSetFromQueueAction(roomCode, set.id)
        : await addSetToQueueAction(roomCode, set.id);
      onQueueChange(queue);
    });
  }

  return (
    <Popover
      anchor={anchor}
      width={360}
      align="end"
      estimatedHeight={420}
      onClose={onClose}
      label="Escolher conjunto de fases"
    >
      <div className={styles.picker}>
        <div className={styles.pickerHead}>
          <h3 className={styles.pickerTitle}>Escolher conjunto de fases</h3>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Fechar">
            <Icon.Close size={18} />
          </button>
        </div>

        <Tabs
          label="Origem dos conjuntos"
          active={scope}
          onChange={setScope}
          tabs={[
            { id: 'owned', label: 'Meus conjuntos' },
            { id: 'community', label: 'Comunidade' },
          ]}
        />

        <Input
          placeholder="Buscar conjunto..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <div className={styles.results}>
          {error && <p className={styles.empty}>{error}</p>}
          {!error && results === null && <p className={styles.loading}>Carregando…</p>}
          {!error && results?.length === 0 && (
            <p className={styles.empty}>Nenhum conjunto encontrado.</p>
          )}
          {results?.map((set) => {
            const isAdded = selectedIds.includes(set.id);
            const disabled = !isAdded && atCapacity;
            return (
              <button
                key={set.id}
                type="button"
                disabled={disabled}
                onClick={() => toggle(set)}
                className={cx(
                  styles.result,
                  isAdded && styles.resultAdded,
                  disabled && styles.resultDisabled,
                )}
              >
                <span>
                  <span className={styles.resultTitle}>{set.title}</span>
                  <span className={styles.resultMeta}>
                    {set.phaseCount} fases ·{' '}
                    {set.source === 'owned' ? set.updatedLabel : `por ${set.authorName}`}
                  </span>
                </span>
                {isAdded && <Icon.Check size={20} className={styles.check} />}
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */

function SetDefaultsDialog({
  roomCode,
  setId,
  title,
  onQueueChange,
  onClose,
}: {
  roomCode: string;
  setId: string;
  title: string;
  onQueueChange: (queue: RoomQueue) => void;
  onClose: () => void;
}) {
  const [basePoints, setBasePoints] = useState('100');
  const [multiplier, setMultiplier] = useState('1');
  const [timeSeconds, setTimeSeconds] = useState('45');
  const [, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const queue = await updateSetDefaultsAction(roomCode, setId, {
        basePoints: Number(basePoints) || 0,
        pointsMultiplier: Number(multiplier) || 1,
        timeSeconds: Number(timeSeconds) || 0,
      });
      onQueueChange(queue);
      onClose();
    });
  }

  return (
    <Dialog open title={`Editar fases · ${title}`} onClose={onClose}>
      <div className={styles.dialogFields}>
        <p className={styles.dialogNote}>
          Estes valores serão aplicados a todas as fases deste conjunto.
        </p>
        <Input
          type="number"
          label="Pontuação disponível"
          value={basePoints}
          onChange={(event) => setBasePoints(event.target.value)}
        />
        <Input
          type="number"
          label="Multiplicador de pontos"
          step="0.1"
          value={multiplier}
          onChange={(event) => setMultiplier(event.target.value)}
        />
        <Input
          type="number"
          label="Tempo (segundos)"
          value={timeSeconds}
          onChange={(event) => setTimeSeconds(event.target.value)}
        />
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save}>Salvar</Button>
        </div>
      </div>
    </Dialog>
  );
}
