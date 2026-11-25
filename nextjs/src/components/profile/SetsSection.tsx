'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Dialog } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cssVars } from '@/lib/cssVars';
import { setColor } from '@/lib/setColor';
import type { PhaseSetSummary } from '@/lib/types';
import styles from './SetsSection.module.css';
import { redirect } from 'next/navigation';

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
        {sets.length > 0 && (
          <div className={styles.headActions}>
            <button type="button" className={styles.link} onClick={() => redirect('/conjuntos')}>
              Ver todos ({sets.length})
            </button>
            <Button size="sm" onClick={onCreate}>
              Criar novo conjunto
            </Button>
          </div>
        )}
      </div>

      {sets.length === 0 ? (
        <div className={styles.emptyState}>
          <Image
            className={styles.emptyImage}
            src="/Ilustrations/EmptyState.svg"
            alt="Ilustração de lista de conjuntos vazia"
            width={200}
            height={200}
          />
          <p className={styles.empty}>Você ainda não criou nenhum conjunto de desafios.</p>
          <Button size="sm" onClick={onCreate}>
            Criar novo conjunto
          </Button>
        </div>
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
                    <h3 className={styles.cardTitle}>
                      <Link href={`/conjunto/${set.id}`} className={styles.cardLink}>
                        {set.title}
                      </Link>
                    </h3>
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
    </section>
  );
}
