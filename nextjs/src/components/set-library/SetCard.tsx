'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Icon } from '@/components/icons/Icons';
import { ImageSlot } from '@/components/media/ImageSlot';
import { Popover, anchorFrom, type AnchorRect } from '@/components/ds';
import { KIND_META, KIND_ORDER, KIND_SHORT_LABEL } from '@/components/set-editor/phaseKinds';
import { cssVars } from '@/lib/cssVars';
import { cx } from '@/lib/cx';
import { setColor } from '@/lib/setColor';
import type { PhaseSetLibraryEntry } from '@/lib/types';
import styles from './SetCard.module.css';
import Image from 'next/image';

/** Faixas de acerto médio que pintam o número. */
function accuracyTone(rate: number): string {
  if (rate >= 75) return 'var(--accent-success)';
  if (rate >= 65) return 'var(--amber-600)';
  return 'var(--accent-danger)';
}

interface MenuAction {
  label: string;
  icon: React.ReactNode;
  onSelect?: () => void;
  danger?: boolean;
}

interface SetCardProps {
  set: PhaseSetLibraryEntry;
  /** `true` enquanto a barra de seleção em massa está ligada. */
  onStartRoom: () => void;
  onPublish?: () => void;
  onCopy?: () => void;
  onDelete: () => void;
}

export function SetCard({
  set,
  onStartRoom,
  onPublish,
  onCopy,
  onDelete,
}: SetCardProps) {
  const router = useRouter();
  const [menuAnchor, setMenuAnchor] = useState<AnchorRect | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  const owned = set.source === 'owned';
  const href = `/conjunto/${set.id}`;
  const editHref = `/conjunto/${set.id}/editar`;

  // Ações sem rota no contrato aparecem desabilitadas em vez de sumirem — é o
  // mesmo critério da barra lateral: o menu mostra o que o conjunto vai poder
  // fazer, e some só o que nunca vai existir aqui.
  const actions: MenuAction[] = owned
    ? [
      { label: 'Iniciar sala com este conjunto', icon: <Icon.Power size={16} />, onSelect: onStartRoom },
      { label: 'Editar conjunto', icon: <Icon.Pencil size={16} />, onSelect: () => router.push(editHref) },
      { label: 'Compartilhar', icon: <Icon.Globe size={16} />, onSelect: onPublish },
      { label: 'Exportar', icon: <Icon.Download size={16} /> },
      { label: 'Excluir', icon: <Icon.Close size={16} />, onSelect: onDelete, danger: true },
    ]
    : [
      { label: 'Iniciar sala com este conjunto', icon: <Icon.Power size={16} />, onSelect: onStartRoom },
      { label: 'Importar conjunto', icon: <Icon.Copy size={16} />, onSelect: onCopy },
      { label: 'Exportar', icon: <Icon.Download size={16} /> },
    ];

  const handleMenuAnchor = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setMenuAnchor(menuButton.current ? anchorFrom(menuButton.current) : null)
  }

  const byline = [set.authorName, set.updatedLabel].filter(Boolean).join(' · ');

  return (
    <article
      className={cx(
        styles.card,
        // O pano de fundo do menu cobre o card e mata o `:hover`; sem isto o
        // card desceria os 2px do realce no instante em que o menu abre.
        menuAnchor && styles.cardRaised,
      )}
    >
      <Link href={href}>
        <div className={styles.cover}>
          {/* Sem capa o card recebe a cor derivada do id, a mesma que o perfil usa
          (`lib/setColor.ts`). O contorno tracejado do `ImageSlot` não serve
          aqui: o texto do marcador cairia por cima do título. */}
          {set.coverUrl ? (
            <ImageSlot
              className={styles.coverImage}
              placeholder={`Capa de ${set.title}`}
              src={set.coverUrl}
              shape="rect"
              onDark
              width={480}
              height={300}
            />
          ) : (
            <div
              className={styles.coverFallback}
              style={cssVars({ '--set-color': setColor(set.id) })}
            />
          )}
          <div className={styles.coverShade} />

          <button
            type="button"
            ref={menuButton}
            className={styles.menuButton}
            onClick={handleMenuAnchor}
            aria-label={`Ações de ${set.title}`}
          >
            <Icon.More size={18} />
          </button>

          <div className={styles.coverText}>
            {/* O link cobre o card inteiro (ver `.title::after`): assim o alvo é
            grande sem que a região clicável seja uma `div` com `onClick`. */}
            <h3 className={styles.title}>
              {set.title}
            </h3>
            {byline && <p className={styles.byline}>{byline}</p>}

            <div className={styles.kinds}>
              {KIND_ORDER.filter((kind) => (set.phaseKindCounts[kind] ?? 0) > 0).map((kind) => (
                <span
                  key={kind}
                  className={styles.kind}
                  style={cssVars({ '--kind-color': KIND_META[kind].color })}
                  title={`${set.phaseKindCounts[kind]} fases de ${KIND_META[kind].label}`}
                >
                  {set.phaseKindCounts[kind]} {KIND_SHORT_LABEL[kind]}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.body}>
          <dl className={styles.stats}>
            <div className={styles.stat}>
              <dt>
                <Icon.PhaseTypes size={14} />
                <span className="visuallyHidden">Fases</span>
              </dt>
              <dd>{set.phaseCount} fases</dd>
            </div>
            <div className={styles.stat}>
              <dt>
                <Image src={"/Icons/play_arrow.svg"} alt={''} width={24} height={24}></Image>
                <span className="visuallyHidden">Acerto médio</span>
              </dt>
              <dd style={cssVars({ '--stat-color': set.accuracyRate === null ? 'var(--text-secondary)' : accuracyTone(set.accuracyRate) })}>
                {set.accuracyRate === null ? 'sem partidas' : `${set.accuracyRate}% de acerto`}
              </dd>
            </div>
            <div className={styles.stat}>
              <dt>
                <Icon.Clock size={14} />
                <span className="visuallyHidden">Duração</span>
              </dt>
              <dd>{set.durationLabel}</dd>
            </div>
          </dl>

          <span className={styles.subject}>{set.subject}</span>
        </div>
      </Link>

      {menuAnchor && (
        <Popover
          anchor={menuAnchor}
          align="end"
          width={240}
          estimatedHeight={actions.length * 40 + 12}
          label={`Ações de ${set.title}`}
          onClose={() => setMenuAnchor(null)}
        >
          <div className={styles.menu}>
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={cx(styles.menuItem, action.danger && styles.menuItemDanger)}
                disabled={!action.onSelect}
                title={action.onSelect ? undefined : 'Em breve'}
                onClick={(e) => {
                  e.preventDefault();
                  setMenuAnchor(null);
                  action.onSelect?.();
                }}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </article>
  );
}
