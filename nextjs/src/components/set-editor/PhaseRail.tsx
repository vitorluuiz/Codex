'use client';

import { useRef, useState } from 'react';

import { Button } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type { DraftPhase } from '@/lib/types';
import { KIND_META } from './phaseKinds';
import styles from './PhaseRail.module.css';

interface PhaseRailProps {
  phases: DraftPhase[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

export function PhaseRail({
  phases,
  activeId,
  onSelect,
  onReorder,
  onDuplicate,
  onRemove,
  onAdd,
}: PhaseRailProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  function drop(target: number) {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || from === target) return;
    onReorder(from, target);
  }

  return (
    <aside className={styles.rail} ref={railRef} aria-label="Fases do conjunto">
      <div className={styles.railHead}>
        <span className={styles.railTitle}>Fases</span>
        <span className={styles.railCount}>{phases.length}</span>
      </div>

      <div className={styles.tiles}>
        {phases.map((phase, index) => (
          <div
            key={phase.id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setOverIndex(index);
            }}
            onDrop={() => drop(index)}
            className={cx(
              styles.tile,
              phase.id === activeId && styles.tileActive,
              dragIndex === index && styles.tileDragging,
              overIndex === index && dragIndex !== index && styles.tileDropTarget,
            )}
            style={cssVars({ '--kind-color': KIND_META[phase.kind].color })}
          >
            <button
              type="button"
              className={styles.thumbButton}
              onClick={() => {
                onSelect(phase.id);
                setConfirmId(null);
              }}
              aria-label={`Abrir fase ${index + 1}: ${phase.name}`}
            >
              <PhaseThumb kind={phase.kind} />
            </button>

            <div className={styles.tileTools}>
              <button
                type="button"
                className={styles.tileTool}
                onClick={() => onDuplicate(phase.id)}
                title="Duplicar fase"
                aria-label={`Duplicar ${phase.name}`}
              >
                <Icon.Copy size={10} />
              </button>
              <button
                type="button"
                className={styles.tileTool}
                onClick={() => setConfirmId(phase.id)}
                title="Remover fase"
                aria-label={`Remover ${phase.name}`}
              >
                <Icon.Close size={10} />
              </button>
            </div>

            {confirmId === phase.id && (
              <div className={styles.confirm} role="alertdialog" aria-label="Confirmar exclusão">
                <span className={styles.confirmText}>
                  Excluir esta fase? Essa ação não pode ser desfeita.
                </span>
                <div className={styles.confirmActions}>
                  <Button size="sm" variant="secondary" onClick={() => setConfirmId(null)}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setConfirmId(null);
                      onRemove(phase.id);
                    }}
                  >
                    Excluir
                  </Button>
                </div>
              </div>
            )}

            <div className={styles.tileFoot}>
              <span className={styles.tileIndex}>{index + 1}</span>
              <span className={styles.tileName}>{phase.name}</span>
              <span className={styles.tileDot} aria-hidden />
            </div>
          </div>
        ))}

        <button type="button" className={styles.addTile} onClick={onAdd}>
          <Icon.Plus size={22} />
          Adicionar fase
        </button>

        <button type="button" className={styles.browseTile} disabled title="Em breve">
          <Icon.Globe size={22} />
          Procurar fases
        </button>
      </div>
    </aside>
  );
}

/**
 * Miniatura abstrata do tipo de fase. É esqueleto de propósito: o autor
 * reconhece o tipo pela forma sem precisar ler o enunciado num tile de 100px.
 */
function PhaseThumb({ kind }: { kind: DraftPhase['kind'] }) {
  if (kind === 'quiz') {
    return (
      <div className={styles.thumb}>
        <span className={styles.thumbLine} />
        <div className={styles.thumbGrid}>
          <span className={styles.thumbCellCorrect} />
          <span className={styles.thumbCell} />
          <span className={styles.thumbCell} />
          <span className={styles.thumbCell} />
        </div>
      </div>
    );
  }

  if (kind === 'code') {
    return (
      <div className={styles.thumb}>
        <span className={cx(styles.thumbLine, styles.thumbLineShort)} />
        <div className={styles.thumbCode}>
          <span className={styles.thumbCodeLine} />
          <span className={cx(styles.thumbCodeLine, styles.thumbCodeLineAccent)} />
          <span className={styles.thumbCodeLine} />
        </div>
      </div>
    );
  }

  if (kind === 'text') {
    return (
      <div className={styles.thumb}>
        <span className={styles.thumbLine} />
        <span className={styles.thumbTextArea} />
      </div>
    );
  }

  return (
    <div className={styles.thumb}>
      <div className={styles.thumbSentence}>
        <span className={styles.thumbWord} />
        <span className={styles.thumbBlank} />
        <span className={styles.thumbWord} />
      </div>
      <div className={styles.thumbChips}>
        <span className={styles.thumbChip} />
        <span className={styles.thumbChip} />
        <span className={styles.thumbChip} />
      </div>
    </div>
  );
}
