'use client';

import { useState } from 'react';

import { Button, Checkbox } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { decideGenerationAction } from '@/lib/actions/ai';
import { cx } from '@/lib/cx';
import type { AiVariationsResult, DraftPhase } from '@/lib/types';
import { AiPhasePreview } from './AiPhasePreview';
import styles from './VariationsReviewModal.module.css';

interface VariationsReviewModalProps {
  result: AiVariationsResult;
  sourcePhaseName: string;
  onAccept: (selectedPhases: DraftPhase[]) => void;
  onClose: () => void;
}

export function VariationsReviewModal({
  result,
  sourcePhaseName,
  onAccept,
  onClose,
}: VariationsReviewModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(result.phases.map((p) => p.id)),
  );

  const allSelected = selectedIds.size === result.phases.length;

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(result.phases.map((p) => p.id)));
    }
  }

  function handleDiscardAll() {
    void decideGenerationAction(result.generationId, 'discarded', 0);
    onClose();
  }

  function handleConfirmSelected() {
    const chosen = result.phases.filter((p) => selectedIds.has(p.id));
    if (chosen.length === 0) return;

    const decision = chosen.length === result.phases.length ? 'accepted' : 'partial';
    void decideGenerationAction(result.generationId, decision, chosen.length);
    onAccept(chosen);
  }

  return (
    <div className={styles.backdrop} onClick={handleDiscardAll} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Revisar variações geradas"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.title}>Revisar variações geradas</h2>
            <p className={styles.subtitle}>
              Baseadas em “{sourcePhaseName || 'Fase atual'}” · escolha quais adicionar ao conjunto
            </p>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={handleDiscardAll}
            aria-label="Fechar"
          >
            <Icon.Close size={18} />
          </button>
        </header>

        <div className={styles.toolbar}>
          <Checkbox
            label={allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
            checked={allSelected}
            onChange={toggleAll}
          />
          {result.discarded > 0 && (
            <span className={styles.discardedWarning}>
              <Icon.Alert size={14} />
              {result.discarded} variação(ões) inválida(s) descartada(s) automaticamente
            </span>
          )}
        </div>

        <div className={styles.body}>
          {result.phases.map((phase, idx) => {
            const isSelected = selectedIds.has(phase.id);
            return (
              <div
                key={phase.id}
                className={cx(styles.variationItem, isSelected && styles.variationItemSelected)}
              >
                <div className={styles.variationTop}>
                  <Checkbox
                    label={`Variação ${idx + 1}`}
                    checked={isSelected}
                    onChange={() => toggleOne(phase.id)}
                  />
                </div>
                <AiPhasePreview phase={phase} compact />
              </div>
            );
          })}
        </div>

        <footer className={styles.foot}>
          <Button variant="secondary" onClick={handleDiscardAll}>
            Descartar tudo
          </Button>
          <Button onClick={handleConfirmSelected} disabled={selectedIds.size === 0}>
            Adicionar selecionadas ({selectedIds.size})
          </Button>
        </footer>
      </div>
    </div>
  );
}
