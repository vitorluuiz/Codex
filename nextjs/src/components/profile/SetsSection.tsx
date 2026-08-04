'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Dialog } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cssVars } from '@/lib/cssVars';
import type { PhaseSetSummary } from '@/lib/types';
import { setColor } from './setColors';
import styles from './SetsSection.module.css';

/** Quanto o carrossel anda por clique — um card mais o gap. */
const SCROLL_STEP = 276;

interface SetsSectionProps {
  sets: PhaseSetSummary[];
  onCreate: () => void;
  onEdit: (setId: string) => void;
  onStart: (setId: string) => void;
}

export function SetsSection({ sets, onCreate, onEdit, onStart }: SetsSectionProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [allOpen, setAllOpen] = useState(false);

  // As setas só existem quando há o que rolar; sem isso elas ficariam cobrindo
  // os cards de um conjunto único que já cabe inteiro na tela.
  const syncArrows = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    setCanScrollLeft(rail.scrollLeft > 4);
    setCanScrollRight(rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 4);
  }, []);

  useEffect(() => {
    syncArrows();
    window.addEventListener('resize', syncArrows);
    return () => window.removeEventListener('resize', syncArrows);
  }, [syncArrows, sets]);

  function scrollBy(direction: -1 | 1) {
    railRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' });
  }

  return (
    <section className={styles.section}>
      <div className={styles.head}>
        <h2 className={styles.title}>Conjuntos de desafios criados</h2>
        <div className={styles.headActions}>
          {sets.length > 0 && (
            <button type="button" className={styles.link} onClick={() => setAllOpen(true)}>
              Ver todos ({sets.length})
            </button>
          )}
          <Button size="sm" onClick={onCreate}>
            Criar novo conjunto
          </Button>
        </div>
      </div>

      {sets.length === 0 ? (
        <p className={styles.empty}>Você ainda não criou nenhum conjunto de desafios.</p>
      ) : (
        <div className={styles.railWrapper}>
          <div className={styles.rail} ref={railRef} onScroll={syncArrows}>
            {sets.map((set) => (
              <article
                key={set.id}
                className={styles.card}
                style={cssVars({ '--set-color': setColor(set.id) })}
              >
                <div className={styles.cardHead}>
                  <span className={styles.cardIcon}>
                    <Icon.Grid size={20} />
                  </span>
                  <div className={styles.cardText}>
                    <h3 className={styles.cardTitle}>{set.title}</h3>
                    {set.updatedLabel && <p className={styles.cardMeta}>{set.updatedLabel}</p>}
                  </div>
                </div>
                <div className={styles.cardFoot}>
                  <span className={styles.phaseCount}>{set.phaseCount} fases</span>
                  <div className={styles.cardActions}>
                    <Button size="sm" variant="secondary" onClick={() => onEdit(set.id)}>
                      Editar
                    </Button>
                    <Button size="sm" onClick={() => onStart(set.id)}>
                      Iniciar
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {canScrollLeft && (
            <button
              type="button"
              className={`${styles.arrow} ${styles.arrowLeft}`}
              onClick={() => scrollBy(-1)}
              aria-label="Conjuntos anteriores"
            >
              <Icon.ChevronLeft size={16} />
            </button>
          )}
          {canScrollRight && (
            <button
              type="button"
              className={`${styles.arrow} ${styles.arrowRight}`}
              onClick={() => scrollBy(1)}
              aria-label="Próximos conjuntos"
            >
              <Icon.ChevronRight size={16} />
            </button>
          )}
        </div>
      )}

      <Dialog open={allOpen} title="Todos os conjuntos" onClose={() => setAllOpen(false)}>
        <div className={styles.allList}>
          {sets.map((set) => (
            <div
              key={set.id}
              className={styles.allRow}
              style={cssVars({ '--set-color': setColor(set.id) })}
            >
              <span className={styles.allIcon}>
                <Icon.Grid size={16} />
              </span>
              <div className={styles.allText}>
                <div className={styles.allTitle}>{set.title}</div>
                <div className={styles.allMeta}>
                  {set.phaseCount} fases
                  {set.updatedLabel && ` · ${set.updatedLabel}`}
                </div>
              </div>
              <button
                type="button"
                className={styles.allEdit}
                onClick={() => onEdit(set.id)}
                aria-label={`Editar ${set.title}`}
                title="Editar conjunto"
              >
                <Icon.Pencil size={14} />
              </button>
              <Button size="sm" variant="secondary" onClick={() => onStart(set.id)}>
                Abrir
              </Button>
            </div>
          ))}
        </div>
      </Dialog>
    </section>
  );
}
