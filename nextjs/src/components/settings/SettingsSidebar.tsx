'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import styles from './SettingsSidebar.module.css';

interface SettingsNavEntry {
  key: string;
  label: string;
  icon: ReactNode;
  /** Sem destino o item aparece como "Em breve". */
  href?: string;
}

const SETTINGS_ENTRIES: SettingsNavEntry[] = [
  { key: 'perfil', label: 'Perfil da conta', icon: <Icon.Person size={17} /> },
  {
    key: 'pagamentos',
    label: 'Pagamentos e plano',
    icon: <Icon.Crown size={17} />,
    href: '/configuracoes/pagamentos',
  },
  {
    key: 'ia',
    label: 'Uso de cotas de IA',
    icon: <Icon.Sparkle size={17} />,
    href: '/configuracoes/ia',
  },
];

export function SettingsSidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar} aria-label="Seções de configurações">

      <nav aria-label="Navegação de configurações">
        <ul className={styles.nav}>
          {SETTINGS_ENTRIES.map((entry) => {
            const isActive = Boolean(
              entry.href && (pathname === entry.href || pathname.startsWith(`${entry.href}/`)),
            );

            return (
              <li key={entry.key}>
                {isActive ? (
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
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
