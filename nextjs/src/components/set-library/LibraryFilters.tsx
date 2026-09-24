'use client';

import { useRef, useState, type ReactNode } from 'react';

import { Popover, anchorFrom, type AnchorRect } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { KIND_META, KIND_ORDER } from '@/components/set-editor/phaseKinds';
import { cx } from '@/lib/cx';
import type { PhaseKind } from '@/lib/types';
import {
  ALL_SUBJECTS,
  SORT_LABEL,
  type LibraryFilterState,
  type LibrarySort,
} from './filters';
import styles from './LibraryFilters.module.css';

interface LibraryFiltersProps {
  filters: LibraryFilterState;
  onChange: (patch: Partial<LibraryFilterState>) => void;
  subjects: string[];
  /** A seleção em massa só existe na aba dos conjuntos próprios. */
  showSelect: boolean;
  selectMode: boolean;
  onToggleSelectMode: () => void;
}

export function LibraryFilters({
  filters,
  onChange,
  subjects,
  showSelect,
  selectMode,
  onToggleSelectMode,
}: LibraryFiltersProps) {
  const allKinds = filters.kinds.length === KIND_ORDER.length;

  function toggleKind(kind: PhaseKind) {
    onChange({
      kinds: filters.kinds.includes(kind)
        ? filters.kinds.filter((item) => item !== kind)
        : KIND_ORDER.filter((item) => item === kind || filters.kinds.includes(item)),
    });
  }

  return (
    <div className={styles.bar}>
      <div className={styles.search}>
        <Icon.Search size={16} />
        <input
          type="search"
          value={filters.query}
          onChange={(event) => onChange({ query: event.target.value })}
          placeholder="Buscar conjunto"
          aria-label="Buscar conjunto"
        />
      </div>

      <FilterMenu
        label={allKinds ? 'Todos os tipos' : `Tipos: ${filters.kinds.length} de ${KIND_ORDER.length}`}
        dirty={!allKinds}
        width={230}
      >
        {(close) => (
          <>
            {KIND_ORDER.map((kind) => (
              <button
                key={kind}
                type="button"
                className={cx(styles.option, filters.kinds.includes(kind) && styles.optionOn)}
                aria-pressed={filters.kinds.includes(kind)}
                onClick={() => toggleKind(kind)}
              >
                {KIND_META[kind].label}
                {filters.kinds.includes(kind) && <Icon.Check size={15} />}
              </button>
            ))}
            <button
              type="button"
              className={styles.optionAll}
              onClick={() => {
                onChange({ kinds: KIND_ORDER });
                close();
              }}
            >
              Selecionar todos
            </button>
          </>
        )}
      </FilterMenu>

      <FilterMenu label={filters.subject} dirty={filters.subject !== ALL_SUBJECTS} width={220}>
        {(close) =>
          [ALL_SUBJECTS, ...subjects].map((subject) => (
            <button
              key={subject}
              type="button"
              className={cx(styles.option, subject === filters.subject && styles.optionOn)}
              onClick={() => {
                onChange({ subject });
                close();
              }}
            >
              {subject}
              {subject === filters.subject && <Icon.Check size={15} />}
            </button>
          ))
        }
      </FilterMenu>

      <FilterMenu label={`Ordenar: ${SORT_LABEL[filters.sort]}`} width={200}>
        {(close) =>
          (Object.keys(SORT_LABEL) as LibrarySort[]).map((sort) => (
            <button
              key={sort}
              type="button"
              className={cx(styles.option, sort === filters.sort && styles.optionOn)}
              onClick={() => {
                onChange({ sort });
                close();
              }}
            >
              {SORT_LABEL[sort]}
              {sort === filters.sort && <Icon.Check size={15} />}
            </button>
          ))
        }
      </FilterMenu>

      {showSelect && (
        <button
          type="button"
          className={cx(styles.chip, styles.selectChip, selectMode && styles.chipDirty)}
          aria-pressed={selectMode}
          onClick={onToggleSelectMode}
        >
          <Icon.Check size={15} />
          {selectMode ? 'Cancelar seleção' : 'Selecionar'}
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface FilterMenuProps {
  label: string;
  /** Pinta o gatilho quando o filtro deixou de ser o padrão. */
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
          estimatedHeight={240}
          label={label}
          onClose={() => setAnchor(null)}
        >
          <div className={styles.menu}>{children(() => setAnchor(null))}</div>
        </Popover>
      )}
    </div>
  );
}
