'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';

import { Button, Checkbox, Popover, Tag, anchorFrom, type AnchorRect } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import {
  getCommunityPhaseDraftAction,
  searchCommunityPhasesAction,
} from '@/lib/actions/phaseSets';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import type {
  AiDifficulty,
  CommunityPhaseSummary,
  DraftPhase,
  PhaseKind,
} from '@/lib/types';
import { AiPhasePreview } from './ai/AiPhasePreview';
import { KIND_META, KIND_ORDER, draftPhaseId } from './phaseKinds';
import styles from './BrowseCommunityPhasesModal.module.css';

const ALL_THEMES = 'Todos os temas';

const DEFAULT_THEMES = [
  'Matemática',
  'Programação',
  'Estatística',
  'Português',
  'História',
  'Ciências',
  'Geral',
];

type CommunitySort = 'popular' | 'recent';

const SORT_LABELS: Record<CommunitySort, string> = {
  popular: 'Mais populares',
  recent: 'Mais recentes',
};

const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  easy: 'Fácil',
  medium: 'Médio',
  hard: 'Difícil',
};

interface BrowseCommunityPhasesModalProps {
  existingOriginIds?: Set<string>;
  onAddPhases: (phases: DraftPhase[]) => void;
  onClose: () => void;
}

export function BrowseCommunityPhasesModal({
  existingOriginIds,
  onAddPhases,
  onClose,
}: BrowseCommunityPhasesModalProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedKind, setSelectedKind] = useState<PhaseKind | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<string>(ALL_THEMES);
  const [sort, setSort] = useState<CommunitySort>('popular');

  const [items, setItems] = useState<CommunityPhaseSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [catalogThemes, setCatalogThemes] = useState<string[]>(DEFAULT_THEMES);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set(existingOriginIds));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftCache, setDraftCache] = useState<Record<string, DraftPhase>>({});
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);
  const [previewErrorId, setPreviewErrorId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [isImportingBatch, startImportTransition] = useTransition();

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    searchCommunityPhasesAction({
      q: debouncedQuery || undefined,
      kind: selectedKind ?? undefined,
      subject: selectedTheme !== ALL_THEMES ? selectedTheme : undefined,
      sort,
      limit: 20,
      cursor: 0,
    })
      .then((catalog) => {
        if (cancelled) return;
        setItems(catalog.items);
        setNextOffset(catalog.nextOffset);
        const discovered = [
          ...(catalog.subjects ?? []),
          ...catalog.items.map((item) => item.subject),
        ];
        if (discovered.length > 0) {
          setCatalogThemes((prev) =>
            Array.from(
              new Set(
                [...prev, ...discovered]
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0),
              ),
            ).sort((a, b) => a.localeCompare(b, 'pt-BR')),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Não foi possível carregar as fases da comunidade. Tente novamente.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, selectedKind, selectedTheme, sort]);

  const availableThemes = useMemo(() => {
    if (selectedTheme !== ALL_THEMES && !catalogThemes.includes(selectedTheme)) {
      return [selectedTheme, ...catalogThemes];
    }
    return catalogThemes;
  }, [catalogThemes, selectedTheme]);

  const hasActiveFilters =
    query.trim().length > 0 || selectedKind !== null || selectedTheme !== ALL_THEMES;

  function resetFilters() {
    setQuery('');
    setDebouncedQuery('');
    setSelectedKind(null);
    setSelectedTheme(ALL_THEMES);
  }

  function handleLoadMore() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);

    searchCommunityPhasesAction({
      q: debouncedQuery || undefined,
      kind: selectedKind ?? undefined,
      subject: selectedTheme !== ALL_THEMES ? selectedTheme : undefined,
      sort,
      limit: 20,
      cursor: nextOffset,
    })
      .then((catalog) => {
        setItems((prev) => {
          const existing = new Set(prev.map((i) => i.id));
          return [...prev, ...catalog.items.filter((i) => !existing.has(i.id))];
        });
        setNextOffset(catalog.nextOffset);
      })
      .catch(() => {
        setError('Não foi possível carregar mais fases.');
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }

  async function resolveDraftPhase(phaseId: string): Promise<DraftPhase> {
    const cached = draftCache[phaseId];
    if (cached) return cached;

    const fetched = await getCommunityPhaseDraftAction(phaseId);
    setDraftCache((prev) => ({ ...prev, [phaseId]: fetched }));
    return fetched;
  }

  function toEditorPhase(source: DraftPhase, originId: string): DraftPhase {
    return {
      ...source,
      id: draftPhaseId(),
      originCommunityPhaseId: source.originCommunityPhaseId ?? originId,
      fromAI: false,
    };
  }

  async function handleTogglePreview(phaseId: string) {
    if (expandedId === phaseId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(phaseId);
    setPreviewErrorId(null);

    if (draftCache[phaseId]) return;

    setLoadingPreviewId(phaseId);
    try {
      await resolveDraftPhase(phaseId);
    } catch {
      setPreviewErrorId(phaseId);
    } finally {
      setLoadingPreviewId((curr) => (curr === phaseId ? null : curr));
    }
  }

  function toggleSelection(phaseId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  }

  async function handleAddSingle(phaseId: string) {
    if (importingId || isImportingBatch) return;
    setImportingId(phaseId);
    setError(null);

    try {
      const draft = await resolveDraftPhase(phaseId);
      onAddPhases([toEditorPhase(draft, phaseId)]);
      setAddedIds((prev) => new Set(prev).add(phaseId));
      setSelectedIds((prev) => {
        if (!prev.has(phaseId)) return prev;
        const next = new Set(prev);
        next.delete(phaseId);
        return next;
      });
    } catch {
      setError('Não foi possível importar esta fase da comunidade.');
    } finally {
      setImportingId(null);
    }
  }

  function handleImportSelected() {
    if (selectedIds.size === 0 || isImportingBatch || importingId) return;
    const ids = Array.from(selectedIds);
    setError(null);

    startImportTransition(async () => {
      try {
        const drafts = await Promise.all(ids.map((id) => resolveDraftPhase(id)));
        const prepared = drafts.map((draft, idx) => toEditorPhase(draft, ids[idx]));
        onAddPhases(prepared);
        onClose();
      } catch {
        setError('Não foi possível importar todas as fases selecionadas. Tente novamente.');
      }
    });
  }

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Procurar fases da comunidade"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.title}>Procurar fases da comunidade</h2>
            <p className={styles.subtitle}>
              Pesquise desafios por tipo de fase e tema para importar uma cópia editável ao seu
              conjunto.
            </p>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Fechar"
          >
            <Icon.Close size={18} />
          </button>
        </header>

        <div className={styles.filtersSection}>
          <div className={styles.searchBarRow}>
            <div className={styles.searchBox}>
              <Icon.Search size={16} />
              <input
                ref={searchInputRef}
                type="search"
                className={styles.searchInput}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pesquisar fases por título ou enunciado..."
                aria-label="Pesquisar fases da comunidade"
              />
              {query && (
                <button
                  type="button"
                  className={styles.clearSearch}
                  onClick={() => setQuery('')}
                  aria-label="Limpar pesquisa"
                >
                  <Icon.Close size={10} />
                </button>
              )}
            </div>

            <div className={styles.filterMenus}>
              <FilterMenu
                label={
                  selectedKind === null
                    ? 'Todos os tipos'
                    : `Tipo: ${KIND_META[selectedKind].label}`
                }
                dirty={selectedKind !== null}
                width={220}
              >
                {(close) => (
                  <>
                    <button
                      type="button"
                      className={cx(styles.option, selectedKind === null && styles.optionOn)}
                      onClick={() => {
                        setSelectedKind(null);
                        close();
                      }}
                    >
                      Todos os tipos
                      {selectedKind === null && <Icon.Check size={15} />}
                    </button>
                    {KIND_ORDER.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className={cx(styles.option, selectedKind === kind && styles.optionOn)}
                        onClick={() => {
                          setSelectedKind(kind);
                          close();
                        }}
                      >
                        {KIND_META[kind].label}
                        {selectedKind === kind && <Icon.Check size={15} />}
                      </button>
                    ))}
                  </>
                )}
              </FilterMenu>

              <FilterMenu
                label={selectedTheme === ALL_THEMES ? ALL_THEMES : `Tema: ${selectedTheme}`}
                dirty={selectedTheme !== ALL_THEMES}
                width={230}
              >
                {(close) =>
                  [ALL_THEMES, ...availableThemes].map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      className={cx(styles.option, theme === selectedTheme && styles.optionOn)}
                      onClick={() => {
                        setSelectedTheme(theme);
                        close();
                      }}
                    >
                      {theme}
                      {theme === selectedTheme && <Icon.Check size={15} />}
                    </button>
                  ))
                }
              </FilterMenu>

              <FilterMenu label={`Ordenar: ${SORT_LABELS[sort]}`} width={210}>
                {(close) =>
                  (Object.keys(SORT_LABELS) as CommunitySort[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={cx(styles.option, option === sort && styles.optionOn)}
                      onClick={() => {
                        setSort(option);
                        close();
                      }}
                    >
                      {SORT_LABELS[option]}
                      {option === sort && <Icon.Check size={15} />}
                    </button>
                  ))
                }
              </FilterMenu>
            </div>
          </div>

          <div className={styles.kindPillsRow}>
            <div className={styles.kindPills} role="group" aria-label="Filtro rápido por tipo de fase">
              <button
                type="button"
                className={cx(styles.kindPill, selectedKind === null && styles.kindPillActive)}
                aria-pressed={selectedKind === null}
                onClick={() => setSelectedKind(null)}
              >
                Todos
              </button>
              {KIND_ORDER.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={cx(styles.kindPill, selectedKind === kind && styles.kindPillActive)}
                  style={cssVars({ '--kind-color': KIND_META[kind].color })}
                  aria-pressed={selectedKind === kind}
                  onClick={() => setSelectedKind((curr) => (curr === kind ? null : kind))}
                >
                  <span className={styles.kindDot} />
                  {KIND_META[kind].label}
                </button>
              ))}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                className={styles.resetFiltersButton}
                onClick={resetFilters}
              >
                Limpar filtros
              </button>
            )}
          </div>
        </div>

        <div className={styles.body}>
          {error && <p className={styles.previewError}>{error}</p>}

          {loading ? (
            <div className={styles.stateBox}>
              <span className={styles.spinner} aria-hidden />
              <p className={styles.stateTitle}>Buscando fases na comunidade...</p>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.stateBox}>
              <Icon.Globe size={28} />
              <p className={styles.stateTitle}>Nenhuma fase encontrada</p>
              <p className={styles.stateHint}>
                Tente buscar por outro termo ou alterar os filtros de tipo de fase e tema.
              </p>
              {hasActiveFilters && (
                <Button size="sm" variant="secondary" onClick={resetFilters}>
                  Limpar filtros
                </Button>
              )}
            </div>
          ) : (
            <>
              {items.map((item) => {
                const kindMeta = KIND_META[item.kind];
                const isSelected = selectedIds.has(item.id);
                const isAdded = addedIds.has(item.id);
                const isExpanded = expandedId === item.id;
                const detailedDraft = draftCache[item.id] ?? null;
                const isLoadingPreview = loadingPreviewId === item.id;
                const hasPreviewError = previewErrorId === item.id;
                const isImportingThis = importingId === item.id;

                return (
                  <div
                    key={item.id}
                    className={cx(styles.phaseCard, isSelected && styles.phaseCardSelected)}
                  >
                    <div className={styles.cardTop}>
                      <div className={styles.cardTopLeft}>
                        <Checkbox
                          label=""
                          checked={isSelected}
                          onChange={() => toggleSelection(item.id)}
                        />
                        <span
                          className={styles.kindBadge}
                          style={cssVars({ '--kind-color': kindMeta.color })}
                        >
                          {kindMeta.label}
                        </span>
                        <span className={styles.subjectBadge}>{item.subject}</span>
                        {item.difficulty && (
                          <Tag tone="neutral">{DIFFICULTY_LABELS[item.difficulty]}</Tag>
                        )}
                        {isAdded && (
                          <Tag tone="green" icon={<Icon.Check size={12} />}>
                            No conjunto
                          </Tag>
                        )}
                      </div>

                      <div className={styles.cardMetaRight}>
                        <span className={styles.metaPill}>{item.basePoints} pts</span>
                        <span className={styles.metaPill}>{item.timeSeconds}s</span>
                        {item.pointsMultiplier !== 1 && (
                          <span className={styles.metaPill}>x{item.pointsMultiplier}</span>
                        )}
                      </div>
                    </div>

                    <div className={styles.cardMain}>
                      <h3 className={styles.phaseName}>{item.name}</h3>
                      {!isExpanded && (
                        <p className={styles.questionPreview}>
                          {item.questionPreview || 'Sem prévia de enunciado.'}
                        </p>
                      )}
                    </div>

                    {isExpanded && (
                      <div className={styles.previewWrap}>
                        {isLoadingPreview && (
                          <p className={styles.stateHint}>Carregando detalhes da fase...</p>
                        )}
                        {hasPreviewError && (
                          <p className={styles.previewError}>
                            Não foi possível carregar o gabarito completo desta fase.
                          </p>
                        )}
                        {detailedDraft && <AiPhasePreview phase={detailedDraft} compact />}
                      </div>
                    )}

                    <div className={styles.cardBottom}>
                      <div className={styles.authorMeta}>
                        <span>Por {item.authorName}</span>
                        <span className={styles.dotSep}>·</span>
                        <span>{item.useCount} usos</span>
                        {item.accuracyRate !== null && (
                          <>
                            <span className={styles.dotSep}>·</span>
                            <span>{item.accuracyRate}% de acerto</span>
                          </>
                        )}
                      </div>

                      <div className={styles.cardActions}>
                        <button
                          type="button"
                          className={styles.previewToggle}
                          onClick={() => void handleTogglePreview(item.id)}
                        >
                          <Icon.Eye size={14} />
                          {isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                        </button>

                        <Button
                          size="sm"
                          variant={isAdded ? 'secondary' : 'primary'}
                          disabled={isImportingThis || isImportingBatch}
                          onClick={() => void handleAddSingle(item.id)}
                        >
                          {isImportingThis
                            ? 'Adicionando...'
                            : isAdded
                              ? 'Adicionar novamente'
                              : 'Adicionar'}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {nextOffset !== null && (
                <div className={styles.loadMoreRow}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Carregando...' : 'Carregar mais fases'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <footer className={styles.foot}>
          <span className={styles.footHint}>
            {selectedIds.size > 0
              ? `${selectedIds.size} ${selectedIds.size === 1 ? 'fase selecionada' : 'fases selecionadas'}`
              : 'Selecione várias fases ou clique em "Adicionar" em qualquer desafio.'}
          </span>

          <div className={styles.footActions}>
            <Button variant="secondary" onClick={onClose} disabled={isImportingBatch}>
              Fechar
            </Button>
            {selectedIds.size > 0 && (
              <Button
                onClick={handleImportSelected}
                disabled={isImportingBatch || importingId !== null}
              >
                {isImportingBatch
                  ? 'Importando...'
                  : `Adicionar selecionadas (${selectedIds.size})`}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface FilterMenuProps {
  label: string;
  dirty?: boolean;
  width: number;
  children: (close: () => void) => ReactNode;
}

function FilterMenu({ label, dirty, width, children }: FilterMenuProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  return (
    <div className={styles.menuWrap}>
      <button
        type="button"
        ref={trigger}
        className={cx(styles.chip, dirty && styles.chipDirty)}
        aria-expanded={anchor !== null}
        onClick={() => setAnchor(anchor ? null : trigger.current && anchorFrom(trigger.current))}
      >
        {label}
        <Icon.ChevronDown size={14} className={styles.caret} />
      </button>

      {anchor && (
        <Popover
          anchor={anchor}
          width={width}
          estimatedHeight={260}
          label={label}
          onClose={() => setAnchor(null)}
        >
          <div className={styles.menu}>{children(() => setAnchor(null))}</div>
        </Popover>
      )}
    </div>
  );
}
