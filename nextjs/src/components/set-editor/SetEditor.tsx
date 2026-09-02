'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button, Toast, ToastViewport, Tooltip } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { savePhaseSetAction } from '@/lib/actions/phaseSets';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type { DraftPhase, PhaseSetDraft } from '@/lib/types';
import { AddPhaseModal } from './AddPhaseModal';
import { KIND_META, draftPhaseId } from './phaseKinds';
import { PhaseForm } from './PhaseForm';
import { PhaseRail } from './PhaseRail';
import { PhaseSettings } from './PhaseSettings';
import styles from './SetEditor.module.css';

interface SetEditorProps {
  initialDraft: PhaseSetDraft;
}

export function SetEditor({ initialDraft }: SetEditorProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(initialDraft.title);
  const [phases, setPhases] = useState(initialDraft.phases);
  const [activeId, setActiveId] = useState(initialDraft.phases[0]?.id ?? null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nameHighlight, setNameHighlight] = useState(false);

  const isNew = initialDraft.id === null;
  const active = phases.find((phase) => phase.id === activeId) ?? null;
  const activeIndex = active ? phases.findIndex((phase) => phase.id === active.id) + 1 : 0;

  /* --- Mutações do rascunho ---------------------------------------------- */

  function patchActive(patch: Partial<DraftPhase>) {
    setPhases((list) =>
      list.map((phase) =>
        // O cast é seguro porque o patch sempre vem do formulário da própria
        // fase ativa, que só produz campos do `kind` dela.
        phase.id === activeId ? ({ ...phase, ...patch } as DraftPhase) : phase,
      ),
    );
  }

  function addPhase(phase: DraftPhase) {
    setPhases((list) => [...list, phase]);
    setActiveId(phase.id);
    setAddOpen(false);
  }

  function duplicatePhase(id: string) {
    setPhases((list) => {
      const index = list.findIndex((phase) => phase.id === id);
      if (index === -1) return list;
      const clone = { ...list[index], id: draftPhaseId(), name: `${list[index].name} (cópia)` };
      const next = list.slice();
      next.splice(index + 1, 0, clone);
      setActiveId(clone.id);
      return next;
    });
  }

  function removePhase(id: string) {
    setPhases((list) => {
      const next = list.filter((phase) => phase.id !== id);
      if (id === activeId) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }

  function reorder(from: number, to: number) {
    setPhases((list) => {
      const next = list.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  /* --- Persistência ------------------------------------------------------- */

  function save() {
    setSaveError(null);
    startTransition(async () => {
      try {
        await savePhaseSetAction({ id: initialDraft.id, title: title.trim(), phases });
        router.push('/perfil');
      } catch {
        setSaveError('Não foi possível salvar o conjunto. Tente novamente.');
      }
    });
  }

  const nameMissing = !title.trim();
  const saveDisabled = nameMissing || phases.length === 0;

  return (
    <div className={styles.layout}>
      <PhaseRail
        phases={phases}
        activeId={activeId}
        onSelect={setActiveId}
        onReorder={reorder}
        onDuplicate={duplicatePhase}
        onRemove={removePhase}
        onAdd={() => setAddOpen(true)}
      />

      <div className={styles.main}>
        <header className={styles.topBar}>
          <div className={styles.topLeft}>
            <button
              type="button"
              className={styles.backButton}
              onClick={() => router.push('/perfil')}
              title="Voltar"
              aria-label="Voltar para o perfil"
            >
              <Icon.ArrowLeft size={17} />
            </button>
            <div className={styles.titleField}>
              <span className={styles.mode}>{isNew ? 'Novo conjunto' : 'Editando conjunto'}</span>
              <input
                className={cx(styles.titleInput, nameHighlight && styles.titleInputShake)}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Nome do conjunto"
                aria-label="Nome do conjunto"
              />
            </div>
          </div>

          <div className={styles.topActions}>
            <Button variant="secondary" onClick={() => router.push('/perfil')}>
              Cancelar
            </Button>
            {saveDisabled ? <span
              onMouseEnter={() => nameMissing && setNameHighlight(true)}
              onMouseLeave={() => setNameHighlight(false)}
            >
              <Tooltip label={nameMissing ? 'O conjunto precisa ter um nome para ser salvo.' : 'Adicione ao menos um desafio para salvar o conjunto.'}>
                <Button onClick={save} disabled={saveDisabled}>
                  Salvar conjunto
                </Button>
              </Tooltip>
            </span> : <Button onClick={save}>
              Salvar conjunto
            </Button>}
          </div>
        </header>

        {active ? (
          <div className={styles.workspace}>
            <div className={styles.editorColumn}>
              <div className={styles.phaseMeta}>
                <span
                  className={styles.kindChip}
                  style={cssVars({ '--kind-color': KIND_META[active.kind].color })}
                >
                  {KIND_META[active.kind].label}
                </span>
                <span className={styles.position}>
                  Fase {activeIndex} de {phases.length}
                </span>
                {active.fromAI && (
                  <span className={styles.aiChip}>
                    <Icon.Sparkle size={13} />
                    Gerada com IA
                  </span>
                )}
              </div>

              <PhaseForm phase={active} onChange={patchActive} />
            </div>

            <button
              type="button"
              className={styles.settingsToggle}
              onClick={() => setSettingsOpen((open) => !open)}
              title={settingsOpen ? 'Fechar configurações' : 'Abrir configurações'}
              aria-expanded={settingsOpen}
            >
              <Icon.ChevronRight
                size={14}
                className={cx(styles.toggleArrow, settingsOpen && styles.toggleArrowOpen)}
              />
            </button>

            {settingsOpen && <PhaseSettings phase={active} onChange={patchActive} />}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>
              <Icon.Grid size={28} />
            </span>
            <h2 className={styles.emptyTitle}>Comece adicionando a primeira fase</h2>
            <p className={styles.emptyText}>
              Escolha o tipo de desafio e crie manualmente ou com aceleração de IA.
            </p>
            <Button size="lg" onClick={() => setAddOpen(true)}>
              Adicionar fase
            </Button>
          </div>
        )}
      </div>

      {addOpen && <AddPhaseModal onAdd={addPhase} onClose={() => setAddOpen(false)} />}

      {saveError && (
        <ToastViewport>
          <Toast
            tone="danger"
            title="Erro ao salvar"
            message={saveError}
            onClose={() => setSaveError(null)}
          />
        </ToastViewport>
      )}
    </div>
  );
}
