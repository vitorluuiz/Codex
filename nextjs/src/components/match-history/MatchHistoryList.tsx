'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';
import type { MatchMode } from '@/lib/types';
import styles from './MatchHistoryList.module.css';

export const MODE_LABEL: Record<MatchMode, string> = {
  live: 'Ao vivo',
  'self-paced': 'Próprio ritmo',
};

/** Cor da barra do mini-gráfico, na mesma escala usada no restante do app. */
function accuracyColor(value: number): string {
  if (value >= 75) return 'var(--accent-success)';
  if (value >= 50) return 'var(--accent-streak)';
  return 'var(--accent-danger)';
}

export function PhaseSparkline({
  values,
  remainingValuesCount = null,
}: {
  values: readonly (number | null)[];
  remainingValuesCount?: number | null;
}) {
  const remainingValues = remainingValuesCount ? new Array(remainingValuesCount).fill(50) : [];

  return (
    <div className={styles.sparkline}>
      {values.map((rawValue, index) => {
        if (rawValue == null) {
          return (
            <div
              key={index}
              className={cx(styles.sparklineBar, styles.sparklineBarRemaining)}
              style={{ height: '16%' }}
            />
          );
        }
        const value = Math.max(0, Math.min(rawValue, 100));
        return (
          <div
            key={index}
            className={styles.sparklineBar}
            style={{ height: `${value}%`, background: accuracyColor(value) }}
          />
        );
      })}
      {remainingValues.map((value, index) => (
        <div
          key={`rem-${index}`}
          className={cx(styles.sparklineBar, styles.sparklineBarRemaining)}
          style={{ height: `${Math.min(value, 100)}%` }}
        />
      ))}
    </div>
  );
}

export interface MatchHistoryRowItem {
  id: string;
  href: string;
  title: string;
  mode: MatchMode;
  dateLabel: string;
  phaseValues: readonly (number | null)[];
  score: number;
  maxScore: number;
  statLabel: string;
}

export function MatchHistoryRow({ item }: { item: MatchHistoryRowItem }) {
  return (
    <li className={styles.item}>
      <Link href={item.href} className={cx(styles.row, styles.rowLink)}>
        <div className={styles.identity}>
          <span className={styles.setTitle}>{item.title}</span>
          <div className={styles.subline}>
            <span className={styles.modeChip}>{MODE_LABEL[item.mode]}</span>
            <span className={styles.date}>{item.dateLabel}</span>
          </div>
        </div>

        <PhaseSparkline values={item.phaseValues} remainingValuesCount={null} />

        <div className={styles.stat}>
          <span className={cx(styles.statValue, styles.statScore)}>
            {item.score}
            <span className={styles.statMax}> / {item.maxScore}</span>
          </span>
          <span className={styles.statLabel}>{item.statLabel}</span>
        </div>
      </Link>
    </li>
  );
}

interface MatchHistoryListProps {
  items: MatchHistoryRowItem[];
  /** Linhas extras renderizadas no topo da mesma lista (ex.: salas ativas no perfil). */
  leadingItems?: ReactNode;
  hasLeadingItems?: boolean;
  emptyMessage: string;
}

export function MatchHistoryList({
  items,
  leadingItems,
  hasLeadingItems = false,
  emptyMessage,
}: MatchHistoryListProps) {
  const isEmpty = !hasLeadingItems && items.length === 0;

  if (isEmpty) {
    return <p className={styles.empty}>{emptyMessage}</p>;
  }

  return (
    <ul className={styles.list}>
      {leadingItems}
      {items.map((item) => (
        <MatchHistoryRow key={item.id} item={item} />
      ))}
    </ul>
  );
}
