'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { User } from '@/lib/types';
import styles from './AppSidebar.module.css';

/** Chaves das telas que a barra conhece. */
export type AppSection = 'perfil' | 'conjuntos';

/** As duas faces do perfil — cada uma com seu próprio menu. */
export type ProfileMode = 'leader' | 'participant';

interface NavEntry {
  key: string;
  label: string;
  icon: ReactNode;
  /** Sem destino a entrada aparece desabilitada — a tela ainda não existe. */
  href?: string;
}

/**
 * Itens ainda não construídos aparecem desabilitados em vez de sumirem: o menu
 * é o mapa do produto, e esconder o que vem depois faz a barra parecer quebrada
 * a cada release.
 */
const LEADER_ENTRIES: NavEntry[] = [
  { key: 'perfil', label: 'Perfil', icon: <Icon.Person size={18} />, href: '/perfil' },
  { key: 'conjuntos', label: 'Conjuntos de desafios', icon: <Icon.Grid size={18} />, href: '/conjuntos' },
  { key: 'salas', label: 'Minhas salas', icon: <Icon.Templates size={18} /> },
  { key: 'turmas', label: 'Minhas turmas', icon: <Icon.Users size={18} /> },
  { key: 'relatorios', label: 'Relatórios', icon: <Icon.Reports size={18} /> },
  { key: 'notificacoes', label: 'Notificações', icon: <Icon.Bell size={18} /> },
  { key: 'configuracoes', label: 'Configurações', icon: <Icon.Settings size={18} /> },
];

const PARTICIPANT_ENTRIES: NavEntry[] = [
  { key: 'perfil', label: 'Perfil', icon: <Icon.Person size={18} />, href: '/perfil' },
  { key: 'conquistas', label: 'Conquistas', icon: <Icon.Award size={18} /> },
  { key: 'ranking', label: 'Ranking', icon: <Icon.Trophy size={18} /> },
  { key: 'turmas-participo', label: 'Turmas em que participo', icon: <Icon.Users size={18} /> },
  { key: 'notificacoes', label: 'Notificações', icon: <Icon.Bell size={18} /> },
  { key: 'configuracoes', label: 'Configurações', icon: <Icon.Settings size={18} /> },
];

const PROFILE_OPTIONS: { mode: ProfileMode; label: string; hint: string; icon: ReactNode }[] = [
  { mode: 'leader', label: 'Perfil de líder', hint: 'Conjuntos, salas e turmas', icon: <Icon.Grid size={15} /> },
  {
    mode: 'participant',
    label: 'Perfil de participante',
    hint: 'Conquistas e partidas',
    icon: <Icon.Award size={15} />,
  },
];

interface AppSidebarProps {
  user: User;
  audienceLabel: string;
  /** Qual entrada está aberta. As demais viram link ou item "em breve". */
  active: AppSection;
  onSignOut: () => void;
  /**
   * Qual face do perfil está aberta. Presente só em `/perfil`: é o que decide
   * o menu (líder vs participante) e habilita o switcher "Trocar de perfil" no
   * rodapé. Ausente (caso de `/conjuntos`), a barra volta a ser a única lista
   * fixa de sempre — sem switcher, entradas de líder.
   */
  profileMode?: ProfileMode;
  onProfileModeChange?: (mode: ProfileMode) => void;
}

export function AppSidebar({
  user,
  audienceLabel,
  active,
  onSignOut,
  profileMode,
  onProfileModeChange,
}: AppSidebarProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const entries = profileMode === 'participant' ? PARTICIPANT_ENTRIES : LEADER_ENTRIES;

  return (
    <nav className={styles.sidebar} aria-label="Navegação da conta">
      <Link href="/" className={styles.brand}>
        Codex
      </Link>

      <ul className={styles.nav}>
        {entries.map((entry) => (
          <li key={entry.key}>
            {entry.key === active ? (
              <span className={cx(styles.navItem, styles.navItemActive)} aria-current="page">
                {entry.icon}
                {entry.label}
              </span>
            ) : entry.href ? (
              <Link href={entry.href} className={cx(styles.navItem, styles.navItemLink)}>
                {entry.icon}
                {entry.label}
              </Link>
            ) : (
              <span className={cx(styles.navItem, styles.navItemSoon)} title="Em breve">
                {entry.icon}
                {entry.label}
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className={styles.footer}>
        {onProfileModeChange && (
          <div className={styles.switcher}>
            {switcherOpen && (
              <div className={styles.switcherPanel}>
                <div className={styles.switcherHeading}>Trocar de perfil</div>
                {PROFILE_OPTIONS.map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    className={cx(
                      styles.switcherOption,
                      option.mode === (profileMode ?? 'leader') && styles.switcherOptionActive,
                    )}
                    onClick={() => {
                      onProfileModeChange(option.mode);
                      setSwitcherOpen(false);
                    }}
                  >
                    <span className={styles.switcherIcon}>{option.icon}</span>
                    <span className={styles.switcherText}>
                      <span className={styles.switcherLabel}>{option.label}</span>
                      <span className={styles.switcherHint}>{option.hint}</span>
                    </span>
                    {option.mode === (profileMode ?? 'leader') && (
                      <Icon.Check size={16} className={styles.switcherCheck} />
                    )}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              className={styles.account}
              title="Trocar de perfil"
              onClick={() => setSwitcherOpen((open) => !open)}
            >
              <Avatar index={user.avatarIndex} size="sm" name={user.name} />
              <div className={styles.accountInfo}>
                <div className={styles.accountName}>{user.name}</div>
                <div className={styles.accountRole}>{audienceLabel}</div>
              </div>
              <Icon.ChevronDown size={16} className={styles.switcherChevron} />
            </button>
          </div>
        )}

        {!onProfileModeChange && (
          <div className={styles.account}>
            <Avatar index={user.avatarIndex} size="sm" name={user.name} />
            <div className={styles.accountInfo}>
              <div className={styles.accountName}>{user.name}</div>
              <div className={styles.accountRole}>{audienceLabel}</div>
            </div>
          </div>
        )}

        <button type="button" className={styles.signOut} onClick={onSignOut}>
          <Icon.SignOut size={18} />
          Sair
        </button>
      </div>
    </nav>
  );
}
