'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { User } from '@/lib/types';
import styles from './AppSidebar.module.css';

/** Chaves das telas que a barra conhece. */
export type AppSection = 'perfil' | 'conjuntos';

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
const ENTRIES: NavEntry[] = [
  { key: 'perfil', label: 'Perfil', icon: <Icon.Person size={18} />, href: '/perfil' },
  { key: 'conjuntos', label: 'Conjuntos de desafios', icon: <Icon.Grid size={18} />, href: '/conjuntos' },
  { key: 'salas', label: 'Minhas salas', icon: <Icon.Templates size={18} /> },
  { key: 'turmas', label: 'Minhas turmas', icon: <Icon.Users size={18} /> },
  { key: 'relatorios', label: 'Relatórios', icon: <Icon.Reports size={18} /> },
  { key: 'notificacoes', label: 'Notificações', icon: <Icon.Bell size={18} /> },
  { key: 'configuracoes', label: 'Configurações', icon: <Icon.Settings size={18} /> },
];

interface AppSidebarProps {
  user: User;
  audienceLabel: string;
  /** Qual entrada está aberta. As demais viram link ou item "em breve". */
  active: AppSection;
  onSignOut: () => void;
}

export function AppSidebar({ user, audienceLabel, active, onSignOut }: AppSidebarProps) {
  return (
    <nav className={styles.sidebar} aria-label="Navegação da conta">
      <Link href="/" className={styles.brand}>
        Codex
      </Link>

      <ul className={styles.nav}>
        {ENTRIES.map((entry) => (
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
        <div className={styles.account}>
          <Avatar index={user.avatarIndex} size="sm" name={user.name} />
          <div className={styles.accountInfo}>
            <div className={styles.accountName}>{user.name}</div>
            <div className={styles.accountRole}>{audienceLabel}</div>
          </div>
        </div>
        <button type="button" className={styles.signOut} onClick={onSignOut}>
          <Icon.SignOut size={18} />
          Sair
        </button>
      </div>
    </nav>
  );
}
