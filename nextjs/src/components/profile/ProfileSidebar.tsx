'use client';

import { Avatar } from '@/components/avatar/Avatar';
import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { User } from '@/lib/types';
import styles from './ProfileSidebar.module.css';

/**
 * Itens ainda não construídos aparecem desabilitados em vez de sumirem: o menu
 * é o mapa do produto, e esconder o que vem depois faz a barra parecer quebrada
 * a cada release.
 */
const SOON = [
  { label: 'Minhas turmas', icon: <Icon.Users size={18} /> },
  { label: 'Notificações', icon: <Icon.Bell size={18} /> },
  { label: 'Configurações', icon: <Icon.Settings size={18} /> },
];

interface ProfileSidebarProps {
  user: User;
  audienceLabel: string;
  onSignOut: () => void;
}

export function ProfileSidebar({ user, audienceLabel, onSignOut }: ProfileSidebarProps) {
  return (
    <nav className={styles.sidebar} aria-label="Navegação da conta">
      <span className={styles.brand}>Codex</span>

      <ul className={styles.nav}>
        <li>
          <span className={cx(styles.navItem, styles.navItemActive)} aria-current="page">
            <Icon.Person size={18} />
            Perfil
          </span>
        </li>
        {SOON.map((item) => (
          <li key={item.label}>
            <span className={cx(styles.navItem, styles.navItemSoon)} title="Em breve">
              {item.icon}
              {item.label}
            </span>
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
