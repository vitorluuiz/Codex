'use client';

import Link from 'next/link';

import { Button } from '@/components/ds';
import { ImageSlot } from '@/components/media/ImageSlot';
import { KIND_META, KIND_ORDER, KIND_SHORT_LABEL } from '@/components/set-editor/phaseKinds';
import { cssVars } from '@/lib/cssVars';
import type { PhaseSetLibraryEntry } from '@/lib/types';
import styles from './FeaturedSetBanner.module.css';

interface FeaturedSetBannerProps {
  set: PhaseSetLibraryEntry;
  onStartRoom: () => void;
}

/**
 * O conjunto mais recente em destaque, no topo da biblioteca.
 *
 * É sempre o primeiro da resposta: a lista já chega ordenada por recência, e
 * "o que eu estava editando" é o que a pessoa procura ao abrir a tela.
 */
export function FeaturedSetBanner({ set, onStartRoom }: FeaturedSetBannerProps) {
  const stats = [
    { label: 'Fases', value: `${set.phaseCount}`, highlight: false },
    {
      label: 'Acerto médio',
      value: set.accuracyRate === null ? '—' : `${set.accuracyRate}%`,
      highlight: true,
    },
    { label: 'Duração', value: set.durationLabel, highlight: false },
  ];

  return (
    <section className={styles.banner} aria-labelledby="featured-set-title">
      {/* O banner já é escuro por conta própria; a capa entra por trás quando
          existe, com véu para o título não depender da foto. */}
      {set.coverUrl && (
        <>
          <ImageSlot
            className={styles.cover}
            placeholder={`Capa de ${set.title}`}
            src={set.coverUrl}
            shape="rect"
            onDark
            width={960}
            height={400}
          />
          <div className={styles.shade} />
        </>
      )}

      <div className={styles.main}>
        <p className={styles.eyebrow}>Continue de onde parou</p>
        <h2 className={styles.title} id="featured-set-title">
          {set.title}
        </h2>

        <ul className={styles.kinds}>
          {KIND_ORDER.filter((kind) => (set.phaseKindCounts[kind] ?? 0) > 0).map((kind) => (
            <li key={kind} className={styles.kind}>
              <span className={styles.dot} style={cssVars({ '--kind-color': KIND_META[kind].color })} />
              {set.phaseKindCounts[kind]} {KIND_SHORT_LABEL[kind]}
            </li>
          ))}
        </ul>

        <div className={styles.actions}>
          <Button onClick={onStartRoom}>Iniciar sala</Button>
          <Link href={`/conjunto/${set.id}`} className={styles.ghostAction}>
            Abrir conjunto
          </Link>
        </div>
      </div>

      <dl className={styles.stats}>
        {stats.map((stat) => (
          <div key={stat.label} className={styles.stat}>
            <dd className={stat.highlight ? styles.statValueHighlight : styles.statValue}>
              {stat.value}
            </dd>
            <dt className={styles.statLabel}>{stat.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
