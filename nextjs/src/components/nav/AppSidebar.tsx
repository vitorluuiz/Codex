'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore, useTransition, type ReactNode } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Icon } from '@/components/icons/Icons';
import { AUDIENCE_LABEL } from '@/components/nav/audienceLabels';
import {
  clearStoredProfileMode,
  getProfileHref,
  readStoredProfileMode,
  subscribeProfileMode,
  writeStoredProfileMode,
  type ProfileMode,
} from '@/components/nav/profileMode';
import {
  EMPTY_SIDEBAR_SUBMENU_STATE,
  clearSidebarSubmenus,
  readSidebarSubmenuState,
  reconcileActiveRooms,
  subscribeSidebarSubmenus,
  syncSidebarOwner,
  type SidebarSubmenuState,
} from '@/components/nav/sidebarSubmenus';
import {
  clearVisitedReports,
  readLatestVisitedReport,
  subscribeVisitedReports,
  type VisitedReportEntry,
} from '@/components/reports/visitedReportsStorage';
import { ROOM_STATUS_LABEL } from '@/components/room/activeRoomLabels';
import { logoutAction } from '@/lib/actions/auth';
import { cx } from '@/lib/cx';
import { roomPath } from '@/lib/roomPath';
import type { ActiveRoom, User } from '@/lib/types';
import styles from './AppSidebar.module.css';

/** Chaves das telas que a barra conhece. */
export type AppSection = 'perfil' | 'conjuntos' | 'relatorios' | 'entrar-sala' | 'configuracoes';

export type { ProfileMode };

export interface SidebarSubmenuItem {
  key: string;
  label: string;
  /** Texto auxiliar curto abaixo do rótulo (ex.: "No lobby", "Sala 123456"). */
  meta?: string;
  /** Sem destino o subitem aparece como "Em breve". */
  href?: string;
  /** Indicador visual de item ao vivo (usado para sala ativa). */
  live?: boolean;
}

export interface ActiveSubmenuContext {
  section: AppSection;
  item: SidebarSubmenuItem;
}

/** Corta o nome completo para mostrar apenas as duas primeiras palavras. */
function formatShortUserName(fullName: string): string {
  return fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
}

interface NavEntry {
  key: string;
  label: string;
  icon: ReactNode;
  /** Sem destino a entrada aparece desabilitada. */
  href?: string;
  /**
   * Se o destino exige usuário logado. Padrão: true.
   * Quando o visitante está em rotas públicas sem conta, entradas com
   * `requiresAuth` não aparecem na barra.
   */
  requiresAuth?: boolean;
}

/**
 * Itens ainda não construídos aparecem desabilitados em vez de sumirem: o menu
 * é o mapa do produto, e esconder o que vem depois faz a barra parecer quebrada
 * a cada release. Já abas que exigem autenticação nem aparecem quando o usuário
 * está deslogado, mantendo a barra enxuta apenas com as rotas acessíveis.
 */
const LEADER_ENTRIES: NavEntry[] = [
  { key: 'perfil', label: 'Perfil', icon: <Icon.Person size={18} />, href: getProfileHref('leader'), requiresAuth: true },
  { key: 'entrar-sala', label: 'Entrar em uma sala', icon: <Icon.SignIn size={18} />, href: '/sala', requiresAuth: false },
  { key: 'conjuntos', label: 'Conjuntos de desafios', icon: <Icon.Grid size={18} />, href: '/conjuntos', requiresAuth: true },
  { key: 'salas', label: 'Minhas salas', icon: <Icon.Templates size={18} />, requiresAuth: true },
  { key: 'turmas', label: 'Minhas turmas', icon: <Icon.Users size={18} />, requiresAuth: true },
  { key: 'relatorios', label: 'Relatórios', icon: <Icon.Reports size={18} />, href: '/relatorios', requiresAuth: false },
  { key: 'notificacoes', label: 'Notificações', icon: <Icon.Bell size={18} />, requiresAuth: true },
  {
    key: 'configuracoes',
    label: 'Configurações',
    icon: <Icon.Settings size={18} />,
    href: '/configuracoes',
    requiresAuth: true,
  },
];

const PARTICIPANT_ENTRIES: NavEntry[] = [
  { key: 'perfil', label: 'Perfil', icon: <Icon.Person size={18} />, href: getProfileHref('participant'), requiresAuth: true },
  { key: 'entrar-sala', label: 'Entrar em uma sala', icon: <Icon.SignIn size={18} />, href: '/sala', requiresAuth: false },
  { key: 'relatorios', label: 'Meus relatórios', icon: <Icon.Reports size={18} />, href: '/relatorios', requiresAuth: false },
  { key: 'conquistas', label: 'Conquistas', icon: <Icon.Award size={18} />, requiresAuth: true },
  { key: 'ranking', label: 'Ranking', icon: <Icon.Trophy size={18} />, requiresAuth: true },
  { key: 'turmas-participo', label: 'Turmas em que participo', icon: <Icon.Users size={18} />, requiresAuth: true },
  { key: 'notificacoes', label: 'Notificações', icon: <Icon.Bell size={18} />, requiresAuth: true },
  {
    key: 'configuracoes',
    label: 'Configurações',
    icon: <Icon.Settings size={18} />,
    href: '/configuracoes',
    requiresAuth: true,
  },
];

function getServerLatestReport(): VisitedReportEntry | null {
  return null;
}

function getServerSidebarSubmenus(): SidebarSubmenuState {
  return EMPTY_SIDEBAR_SUBMENU_STATE;
}

function toReportSubmenuItem(report: VisitedReportEntry): SidebarSubmenuItem {
  return {
    key: `report:${report.kind}:${report.token}`,
    label: report.title,
    meta:
      report.kind === 'individual'
        ? `Individual · Sala ${report.roomCode}`
        : `Sala ${report.roomCode}`,
    href:
      report.kind === 'individual'
        ? `/relatorios/individual/${report.token}`
        : `/relatorios/${report.token}`,
  };
}

interface AppSidebarProps {
  user?: User | null;
  audienceLabel?: string;
  /** Qual entrada está aberta. As demais viram link ou item "em breve". */
  active: AppSection;
  /**
   * Submenu atualmente aberto na tela (ex.: conjunto em `/conjunto/[setId]` ou
   * relatório em `/relatorios/[token]`). Passado pelo componente da tela para
   * garantir SSR sem flash e tornar o item pai clicável para retorno à listagem.
   */
  currentSubmenu?: ActiveSubmenuContext;
  /**
   * Salas ativas já carregadas pelo Server Component (ex.: `/perfil`), evitando
   * uma chamada extra a `/api/rooms/active` nessa rota.
   */
  activeRooms?: ActiveRoom[];
  onSignOut?: () => void;
  /**
   * Modo de perfil controlado (ex.: na tela `/perfil`). Quando omitido, a barra
   * usa o último perfil escolhido salvo no navegador e redireciona para a tela
   * do perfil escolhido ao alternar.
   */
  profileMode?: ProfileMode;
  onProfileModeChange?: (mode: ProfileMode) => void;
}

export function AppSidebar({
  user,
  audienceLabel,
  active,
  currentSubmenu,
  activeRooms,
  onSignOut,
  profileMode,
  onProfileModeChange,
}: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const storedProfileMode = useSyncExternalStore(
    subscribeProfileMode,
    readStoredProfileMode,
    () => 'leader' as ProfileMode,
  );
  const storedSubmenus = useSyncExternalStore(
    subscribeSidebarSubmenus,
    readSidebarSubmenuState,
    getServerSidebarSubmenus,
  );
  const latestVisitedReport = useSyncExternalStore(
    subscribeVisitedReports,
    readLatestVisitedReport,
    getServerLatestReport,
  );

  const userId = user?.id ?? null;

  useEffect(() => {
    syncSidebarOwner(userId);
  }, [userId]);

  useEffect(() => {
    if (activeRooms && activeRooms.length > 0) {
      reconcileActiveRooms(activeRooms, userId);
    }
  }, [activeRooms, userId]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/rooms/active', { cache: 'no-store', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { rooms?: ActiveRoom[]; apiConfigured?: boolean } | null) => {
        if (!payload || !payload.apiConfigured || !Array.isArray(payload.rooms)) return;
        reconcileActiveRooms(payload.rooms, userId);
      })
      .catch(() => {
        // Falha de rede ou aborto na navegação: mantém estado atual sem quebrar a barra.
      });

    return () => controller.abort();
  }, [pathname, userId]);

  const currentProfileMode: ProfileMode = profileMode ?? storedProfileMode;

  const allEntries = currentProfileMode === 'participant' ? PARTICIPANT_ENTRIES : LEADER_ENTRIES;
  const entries = user ? allEntries : allEntries.filter((entry) => entry.requiresAuth === false);
  const leaderRoleLabel = audienceLabel ?? (user ? AUDIENCE_LABEL[user.audience] : '');
  const roleLabel = currentProfileMode === 'participant' ? 'Participante' : leaderRoleLabel;
  const displayName = user ? formatShortUserName(user.name) : '';

  function resolveSubItems(entry: NavEntry): SidebarSubmenuItem[] {
    if (entry.key === 'conjuntos') {
      if (currentSubmenu?.section === 'conjuntos') {
        return [currentSubmenu.item];
      }
      if (storedSubmenus.lastSet) {
        return [
          {
            key: `set:${storedSubmenus.lastSet.id}`,
            label: storedSubmenus.lastSet.title,
            meta: storedSubmenus.lastSet.subject,
            href: storedSubmenus.lastSet.href,
          },
        ];
      }
      return [];
    }

    if (entry.key === 'entrar-sala') {
      if (currentSubmenu?.section === 'entrar-sala') {
        return [currentSubmenu.item];
      }
      const room = storedSubmenus.lastRoom;
      if (room && (room.status === 'lobby' || room.status === 'running')) {
        return [
          {
            key: `room:${room.code}`,
            label: `Sala ${room.code}`,
            meta: ROOM_STATUS_LABEL[room.status],
            href: roomPath(room),
            live: true,
          },
        ];
      }
      return [];
    }

    if (entry.key === 'relatorios') {
      if (currentSubmenu?.section === 'relatorios') {
        return [currentSubmenu.item];
      }
      if (latestVisitedReport) {
        return [toReportSubmenuItem(latestVisitedReport)];
      }
      return [];
    }

    return [];
  }

  function isSubItemActive(entryKey: string, item: SidebarSubmenuItem): boolean {
    if (currentSubmenu?.section === entryKey && currentSubmenu.item.key === item.key) {
      return true;
    }
    return Boolean(item.href && pathname === item.href);
  }

  const nextProfileMode: ProfileMode = currentProfileMode === 'leader' ? 'participant' : 'leader';
  const switchProfileLabel =
    nextProfileMode === 'participant'
      ? 'Trocar para perfil de participante'
      : 'Trocar para perfil de líder';

  function handleProfileModeToggle() {
    writeStoredProfileMode(nextProfileMode);

    if (onProfileModeChange) {
      onProfileModeChange(nextProfileMode);
    }

    if (active !== 'perfil' || !onProfileModeChange) {
      router.push(getProfileHref(nextProfileMode));
    }
  }

  function handleSignOut() {
    clearStoredProfileMode();
    clearSidebarSubmenus();
    clearVisitedReports();
    if (onSignOut) {
      onSignOut();
    } else {
      startTransition(() => void logoutAction());
    }
  }

  return (
    <nav className={styles.sidebar} aria-label="Navegação da conta">
      <Link href="/" className={styles.brand}>
        Codex
      </Link>

      <ul className={styles.nav}>
        {entries.map((entry) => {
          const subItems = resolveSubItems(entry);
          const hasActiveSubItem = subItems.some((item) => isSubItemActive(entry.key, item));

          return (
            <li key={entry.key} className={styles.navItemGroup}>
              {entry.key === active && !hasActiveSubItem ? (
                <span className={cx(styles.navItem, styles.navItemActive)} aria-current="page">
                  {entry.icon}
                  {entry.label}
                </span>
              ) : entry.href ? (
                <Link
                  href={entry.href}
                  className={cx(
                    styles.navItem,
                    styles.navItemLink,
                    entry.key === active && hasActiveSubItem && styles.navItemParentActive,
                  )}
                >
                  {entry.icon}
                  {entry.label}
                </Link>
              ) : (
                <span className={cx(styles.navItem, styles.navItemSoon)} title="Em breve">
                  {entry.icon}
                  {entry.label}
                </span>
              )}

              {subItems.length > 0 && (
                <ul className={styles.subNav} aria-label={`Submenu de ${entry.label}`}>
                  {subItems.map((subItem) => {
                    const subActive = isSubItemActive(entry.key, subItem);
                    const content = (
                      <>
                        {subItem.live && <span className={styles.liveDot} aria-hidden="true" />}
                        <span className={styles.subNavText}>
                          <span className={styles.subNavLabel}>{subItem.label}</span>
                          {subItem.meta && (
                            <span className={styles.subNavMeta}>{subItem.meta}</span>
                          )}
                        </span>
                      </>
                    );

                    return (
                      <li key={subItem.key}>
                        {subActive ? (
                          <span
                            className={cx(styles.subNavItem, styles.subNavItemActive)}
                            aria-current="page"
                            title={subItem.label}
                          >
                            {content}
                          </span>
                        ) : subItem.href ? (
                          <Link
                            href={subItem.href}
                            className={cx(styles.subNavItem, styles.subNavItemLink)}
                            title={subItem.label}
                          >
                            {content}
                          </Link>
                        ) : (
                          <span
                            className={cx(styles.subNavItem, styles.subNavItemSoon)}
                            title="Em breve"
                          >
                            {content}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <div className={styles.footer}>
        {user && (
          <div className={styles.switcher}>
            <button
              type="button"
              className={styles.account}
              title={switchProfileLabel}
              aria-label={switchProfileLabel}
              onClick={handleProfileModeToggle}
            >
              <div className={styles.accountInfo}>
                <Avatar index={user.avatarIndex} size="sm" name={user.name} />
                <div className={styles.accountText}>
                  <div className={styles.accountName}>{displayName}</div>
                  <div className={styles.accountRole}>{roleLabel}</div>
                </div>
              </div>
              <Icon.Swap size={16} className={styles.switcherIcon} />
            </button>
          </div>
        )}

        {user ? (
          <button type="button" className={styles.signOut} onClick={handleSignOut}>
            <Icon.SignOut size={18} />
            Sair
          </button>
        ) : (
          <Link href="/entrar" className={styles.signIn}>
            <Icon.Person size={18} />
            Entrar
          </Link>
        )}
      </div>
    </nav>
  );
}
