'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Button, Toast, ToastViewport, Tooltip } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { decideGenerationAction, generatePhaseAction } from '@/lib/actions/ai';
import { savePhaseSetAction } from '@/lib/actions/phaseSets';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type {
  AiPhaseRequest,
  AiUsage,
  DraftPhase,
  PendingAiPhaseGeneration,
  PendingAiQuizSuggestions,
  PendingAiVariationsGeneration,
  PhaseSetDraft,
} from '@/lib/types';
import { AddPhaseModal } from './AddPhaseModal';
import { VariationsReviewModal } from './ai/VariationsReviewModal';
import { KIND_META, draftPhaseId } from './phaseKinds';
import { PhaseForm } from './PhaseForm';
import { PhaseRail } from './PhaseRail';
import { PhaseSettings } from './PhaseSettings';
import styles from './SetEditor.module.css';

const CONTENT_KEYS = new Set([
  'question',
  'options',
  'correctIndexes',
  'words',
  'blanks',
  'starterCode',
  'testCases',
  'expectedAnswer',
]);

interface StoredPhaseSetDraft {
  title: string;
  phases: DraftPhase[];
  activeId: string | null;
  pendingPhaseGen?: PendingAiPhaseGeneration | null;
  pendingVariationsGen?: PendingAiVariationsGeneration | null;
  pendingQuizSuggestions?: Record<string, PendingAiQuizSuggestions>;
  updatedAt: number;
}

function getDraftStorageKey(setId: string | null): string {
  return setId ? `codex:set-editor-draft:${setId}` : 'codex:set-editor-draft:new';
}

interface SetEditorProps {
  initialDraft: PhaseSetDraft;
  initialAiUsage?: AiUsage | null;
}

export function SetEditor({ initialDraft, initialAiUsage = null }: SetEditorProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const storageKey = getDraftStorageKey(initialDraft.id);
  const skipStorageWriteRef = useRef(false);

  const [title, setTitle] = useState(initialDraft.title);
  const [phases, setPhases] = useState(initialDraft.phases);
  const [activeId, setActiveId] = useState(initialDraft.phases[0]?.id ?? null);
  const [pendingPhaseGen, setPendingPhaseGen] = useState<PendingAiPhaseGeneration | null>(null);
  const [pendingVariationsGen, setPendingVariationsGen] =
    useState<PendingAiVariationsGeneration | null>(null);
  const [pendingQuizSuggestions, setPendingQuizSuggestions] = useState<
    Record<string, PendingAiQuizSuggestions>
  >({});
  const [isStorageHydrated, setIsStorageHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const addOpenRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nameHighlight, setNameHighlight] = useState(false);
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(initialAiUsage);

  useEffect(() => {
    addOpenRef.current = addOpen;
  }, [addOpen]);

  useEffect(() => {
    skipStorageWriteRef.current = false;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredPhaseSetDraft>;
        const pendingGeneratedPhase = parsed.pendingPhaseGen?.result?.phase ?? null;
        if (typeof parsed.title === 'string' && Array.isArray(parsed.phases)) {
          const restoredPhases =
            pendingGeneratedPhase &&
            !parsed.phases.some((phase) => phase.id === pendingGeneratedPhase.id)
              ? [...parsed.phases, pendingGeneratedPhase]
              : parsed.phases;
          const restoredActiveId =
            typeof parsed.activeId === 'string' &&
            restoredPhases.some((phase) => phase.id === parsed.activeId)
              ? parsed.activeId
              : (restoredPhases[0]?.id ?? null);
          setTitle(parsed.title);
          setPhases(restoredPhases);
          setActiveId(restoredActiveId);
        }
        if (parsed.pendingPhaseGen && pendingGeneratedPhase) {
          setPendingPhaseGen(parsed.pendingPhaseGen);
          setAddOpen(true);
          addOpenRef.current = true;
        }
        if (parsed.pendingVariationsGen && Array.isArray(parsed.pendingVariationsGen.result?.phases)) {
          setPendingVariationsGen(parsed.pendingVariationsGen);
        }
        if (parsed.pendingQuizSuggestions && typeof parsed.pendingQuizSuggestions === 'object') {
          setPendingQuizSuggestions(parsed.pendingQuizSuggestions);
        }
      }
    } catch {
      // Ignora rascunho malformado ou localStorage indisponível
    } finally {
      setIsStorageHydrated(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!isStorageHydrated || skipStorageWriteRef.current) return;
    try {
      const payload: StoredPhaseSetDraft = {
        title,
        phases,
        activeId,
        pendingPhaseGen,
        pendingVariationsGen,
        pendingQuizSuggestions,
        updatedAt: Date.now(),
      };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Ignora erro de quota ou modo privado sem escrita em localStorage
    }
  }, [
    storageKey,
    isStorageHydrated,
    title,
    phases,
    activeId,
    pendingPhaseGen,
    pendingVariationsGen,
    pendingQuizSuggestions,
  ]);

  const isNew = initialDraft.id === null;
  const active = phases.find((phase) => phase.id === activeId) ?? null;
  const activeIndex = active ? phases.findIndex((phase) => phase.id === active.id) + 1 : 0;

  /* --- Mutações do rascunho ---------------------------------------------- */

  function patchActive(patch: Partial<DraftPhase>) {
    const editedContent = Object.keys(patch).some((key) => CONTENT_KEYS.has(key));
    setPhases((list) =>
      list.map((phase) => {
        if (phase.id !== activeId) return phase;
        // O cast é seguro porque o patch sempre vem do formulário da própria
        // fase ativa, que só produz campos do `kind` dela.
        const nextFromAI =
          patch.fromAI !== undefined
            ? patch.fromAI
            : editedContent
              ? false
              : phase.fromAI;
        return { ...phase, ...patch, fromAI: nextFromAI } as DraftPhase;
      }),
    );
  }

  function addPhase(phase: DraftPhase) {
    setPhases((list) => (list.some((item) => item.id === phase.id) ? list : [...list, phase]));
    setActiveId(phase.id);
    setAddOpen(false);
  }

  async function handleGeneratePhase(request: AiPhaseRequest) {
    const result = await generatePhaseAction(request);
    if (!result.ok) {
      if (result.usage) {
        setAiUsage(result.usage);
      }
      return result;
    }

    setAiUsage(result.data.usage);
    setPhases((list) =>
      list.some((item) => item.id === result.data.phase.id)
        ? list
        : [...list, result.data.phase],
    );
    setActiveId(result.data.phase.id);

    if (addOpenRef.current) {
      setPendingPhaseGen({
        kind: request.kind,
        topic: request.topic,
        difficulty: request.difficulty,
        notes: request.notes ?? '',
        result: result.data,
      });
    } else {
      void decideGenerationAction(result.data.generationId, 'accepted', 1);
      setPendingPhaseGen(null);
    }

    return result;
  }

  function insertPhasesAfter(afterId: string, newPhases: DraftPhase[]) {
    if (newPhases.length === 0) return;
    setPhases((list) => {
      const index = list.findIndex((phase) => phase.id === afterId);
      if (index === -1) return [...list, ...newPhases];
      const next = list.slice();
      next.splice(index + 1, 0, ...newPhases);
      return next;
    });
    setActiveId(newPhases[0].id);
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

  function setPhaseQuizSuggestions(phaseId: string, pending: PendingAiQuizSuggestions | null) {
    setPendingQuizSuggestions((prev) => {
      if (!pending) {
        if (!(phaseId in prev)) return prev;
        const next = { ...prev };
        delete next[phaseId];
        return next;
      }
      return { ...prev, [phaseId]: pending };
    });
  }

  function removePhase(id: string) {
    const pendingQuiz = pendingQuizSuggestions[id];
    if (pendingQuiz) {
      void decideGenerationAction(
        pendingQuiz.generationId,
        pendingQuiz.acceptedCount > 0 ? 'partial' : 'discarded',
        pendingQuiz.acceptedCount,
      );
      setPhaseQuizSuggestions(id, null);
    }

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

  function cleanPhasesForSave(draftPhases: DraftPhase[]): DraftPhase[] {
    return draftPhases.map((phase) => {
      if (phase.kind !== 'quiz') return phase;
      const newOptions: string[] = [];
      const indexMap = new Map<number, number>();
      phase.options.forEach((opt, oldIndex) => {
        if (opt.trim() !== '' || phase.options.length <= 2) {
          indexMap.set(oldIndex, newOptions.length);
          newOptions.push(opt);
        }
      });
      while (newOptions.length < 2) {
        newOptions.push('');
      }
      let correctIndexes = phase.correctIndexes
        .map((i) => indexMap.get(i))
        .filter((i): i is number => i !== undefined && i < newOptions.length);
      if (correctIndexes.length >= newOptions.length) correctIndexes = correctIndexes.slice(0, -1);
      if (correctIndexes.length === 0) correctIndexes = [0];
      return { ...phase, options: newOptions, correctIndexes };
    });
  }

  function clearStoredDraft() {
    skipStorageWriteRef.current = true;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignora indisponibilidade de localStorage
    }
  }

  function cancel() {
    clearStoredDraft();
    router.push('/perfil');
  }

  function save() {
    setSaveError(null);
    const cleanedPhases = cleanPhasesForSave(phases);
    startTransition(async () => {
      try {
        await savePhaseSetAction({ id: initialDraft.id, title: title.trim(), phases: cleanedPhases });
        clearStoredDraft();
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
            <Button variant="secondary" onClick={cancel}>
              Cancelar
            </Button>
            {saveDisabled ? (
              <span
                onMouseEnter={() => nameMissing && setNameHighlight(true)}
                onMouseLeave={() => setNameHighlight(false)}
              >
                <Tooltip
                  label={
                    nameMissing
                      ? 'O conjunto precisa ter um nome para ser salvo.'
                      : 'Adicione ao menos um desafio para salvar o conjunto.'
                  }
                >
                  <Button onClick={save} disabled={saveDisabled}>
                    Salvar conjunto
                  </Button>
                </Tooltip>
              </span>
            ) : (
              <Button onClick={save}>Salvar conjunto</Button>
            )}
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

              <PhaseForm
                phase={active}
                onChange={patchActive}
                aiUsage={aiUsage}
                onUsageChange={setAiUsage}
                pendingQuizSuggestions={pendingQuizSuggestions[active.id] ?? null}
                onPendingQuizSuggestionsChange={(pending) =>
                  setPhaseQuizSuggestions(active.id, pending)
                }
              />
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

            {settingsOpen && (
              <PhaseSettings
                phase={active}
                onChange={patchActive}
                aiUsage={aiUsage}
                onUsageChange={setAiUsage}
                onPendingVariationsChange={setPendingVariationsGen}
              />
            )}
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

      {addOpen && (
        <AddPhaseModal
          onAdd={addPhase}
          onDiscardPhase={removePhase}
          onGeneratePhase={handleGeneratePhase}
          onClose={() => setAddOpen(false)}
          aiUsage={aiUsage}
          onUsageChange={setAiUsage}
          initialPendingGeneration={pendingPhaseGen}
          onPendingGenerationChange={setPendingPhaseGen}
        />
      )}

      {pendingVariationsGen && (
        <VariationsReviewModal
          result={pendingVariationsGen.result}
          sourcePhaseName={pendingVariationsGen.sourcePhaseName}
          initialSelectedIds={pendingVariationsGen.selectedIds}
          onSelectedIdsChange={(selectedIds) =>
            setPendingVariationsGen((prev) => (prev ? { ...prev, selectedIds } : null))
          }
          onAccept={(selected) => {
            insertPhasesAfter(pendingVariationsGen.sourcePhaseId, selected);
            setPendingVariationsGen(null);
          }}
          onClose={() => setPendingVariationsGen(null)}
        />
      )}

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
