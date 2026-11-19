'use client';

import { clearVisitedReports } from '@/components/reports/visitedReportsStorage';
import type { ActiveRoom, RoomMembershipRole, RoomStatus } from '@/lib/types';

export interface StoredSetSubmenu {
  id: string;
  title: string;
  subject?: string;
  href: string;
}

export interface StoredRoomSubmenu {
  code: string;
  status: RoomStatus;
  role: RoomMembershipRole;
  leaderName?: string | null;
  setTitle?: string | null;
}

export interface StoredSettingsSubmenu {
  key: string;
  label: string;
  href: string;
}

export interface SidebarSubmenuState {
  ownerUserId: string | null;
  lastSet: StoredSetSubmenu | null;
  lastRoom: StoredRoomSubmenu | null;
  lastSettings: StoredSettingsSubmenu | null;
}

const STORAGE_KEY = 'codex:sidebar-submenus:v1';
const CHANGE_EVENT = 'codex:sidebar-submenus-change';

export const EMPTY_SIDEBAR_SUBMENU_STATE: SidebarSubmenuState = {
  ownerUserId: null,
  lastSet: null,
  lastRoom: null,
  lastSettings: null,
};

let cachedRaw: string | null | undefined = undefined;
let cachedState: SidebarSubmenuState = EMPTY_SIDEBAR_SUBMENU_STATE;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSet(value: unknown): StoredSetSubmenu | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.href !== 'string') {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    subject: typeof value.subject === 'string' ? value.subject : undefined,
    href: value.href,
  };
}

function parseRoom(value: unknown): StoredRoomSubmenu | null {
  if (!isRecord(value)) return null;
  if (typeof value.code !== 'string') return null;
  const status = value.status;
  if (status !== 'lobby' && status !== 'running' && status !== 'finished') return null;
  const role = value.role === 'leader' ? 'leader' : 'participant';
  return {
    code: value.code,
    status,
    role,
    leaderName: typeof value.leaderName === 'string' ? value.leaderName : null,
    setTitle: typeof value.setTitle === 'string' ? value.setTitle : null,
  };
}

function parseSettings(value: unknown): StoredSettingsSubmenu | null {
  if (!isRecord(value)) return null;
  if (typeof value.key !== 'string' || typeof value.label !== 'string' || typeof value.href !== 'string') {
    return null;
  }
  return {
    key: value.key,
    label: value.label,
    href: value.href,
  };
}

function parseState(raw: string | null): SidebarSubmenuState {
  if (!raw) return EMPTY_SIDEBAR_SUBMENU_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return EMPTY_SIDEBAR_SUBMENU_STATE;
    return {
      ownerUserId: typeof parsed.ownerUserId === 'string' ? parsed.ownerUserId : null,
      lastSet: parseSet(parsed.lastSet),
      lastRoom: parseRoom(parsed.lastRoom),
      lastSettings: parseSettings(parsed.lastSettings),
    };
  } catch {
    return EMPTY_SIDEBAR_SUBMENU_STATE;
  }
}

export function readSidebarSubmenuState(): SidebarSubmenuState {
  if (typeof window === 'undefined') return EMPTY_SIDEBAR_SUBMENU_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedState;
    cachedRaw = raw;
    cachedState = parseState(raw);
    return cachedState;
  } catch {
    return EMPTY_SIDEBAR_SUBMENU_STATE;
  }
}

function writeState(next: SidebarSubmenuState): void {
  if (typeof window === 'undefined') return;
  try {
    const serialized = JSON.stringify(next);
    if (serialized === cachedRaw) return;
    window.localStorage.setItem(STORAGE_KEY, serialized);
    cachedRaw = serialized;
    cachedState = next;
  } catch {
    // localStorage indisponível (ex.: modo privado restritivo)
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeSidebarSubmenus(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      cachedRaw = undefined;
      onStoreChange();
    }
  };
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener('storage', handleStorage);
  };
}

function sameRoom(a: StoredRoomSubmenu | null, b: StoredRoomSubmenu | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.code === b.code &&
    a.status === b.status &&
    a.role === b.role &&
    (a.leaderName ?? null) === (b.leaderName ?? null) &&
    (a.setTitle ?? null) === (b.setTitle ?? null)
  );
}

function sameSet(a: StoredSetSubmenu | null, b: StoredSetSubmenu | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.title === b.title &&
    (a.subject ?? undefined) === (b.subject ?? undefined) &&
    a.href === b.href
  );
}

function sameSettings(a: StoredSettingsSubmenu | null, b: StoredSettingsSubmenu | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.key === b.key && a.label === b.label && a.href === b.href;
}

/**
 * Garante isolamento entre contas no mesmo navegador: se outro usuário fez
 * login sem passar pelo botão de sair, limpa os submenus privados da conta
 * anterior.
 */
export function syncSidebarOwner(currentUserId: string | null): void {
  if (typeof window === 'undefined' || !currentUserId) return;
  const current = readSidebarSubmenuState();
  if (current.ownerUserId && current.ownerUserId !== currentUserId) {
    clearVisitedReports();
    writeState({
      ownerUserId: currentUserId,
      lastSet: null,
      lastRoom: null,
      lastSettings: null,
    });
  }
}

export function recordLastVisitedSet(
  set: StoredSetSubmenu,
  ownerUserId?: string | null,
): void {
  const current = readSidebarSubmenuState();
  const nextOwner = ownerUserId ?? current.ownerUserId;
  if (sameSet(current.lastSet, set) && current.ownerUserId === nextOwner) return;
  writeState({
    ...current,
    ownerUserId: nextOwner,
    lastSet: set,
  });
}

export function clearLastVisitedSetIfMatches(ids: string[]): void {
  if (ids.length === 0) return;
  const current = readSidebarSubmenuState();
  if (!current.lastSet || !ids.includes(current.lastSet.id)) return;
  writeState({
    ...current,
    lastSet: null,
  });
}

export function recordLastActiveRoom(
  room: StoredRoomSubmenu,
  ownerUserId?: string | null,
): void {
  if (room.status === 'finished') {
    clearLastActiveRoomIfMatches(room.code);
    return;
  }

  const current = readSidebarSubmenuState();
  const prev = current.lastRoom?.code === room.code ? current.lastRoom : null;
  const merged: StoredRoomSubmenu = {
    code: room.code,
    status: room.status,
    role: room.role,
    leaderName: room.leaderName ?? prev?.leaderName ?? null,
    setTitle: room.setTitle ?? prev?.setTitle ?? null,
  };
  const nextOwner = ownerUserId ?? current.ownerUserId;

  if (sameRoom(current.lastRoom, merged) && current.ownerUserId === nextOwner) return;
  writeState({
    ...current,
    ownerUserId: nextOwner,
    lastRoom: merged,
  });
}

export function clearLastActiveRoomIfMatches(code?: string): void {
  const current = readSidebarSubmenuState();
  if (!current.lastRoom) return;
  if (code && current.lastRoom.code !== code) return;
  writeState({
    ...current,
    lastRoom: null,
  });
}

/**
 * Reconcilia a última sala armazenada com a lista real retornada por
 * `GET /rooms/active`: mantém a última sala acessada se ela ainda estiver
 * aberta (atualizando status/metadados) ou troca pela primeira sala ativa
 * disponível, removendo-a quando não houver mais nenhuma sala de pé.
 */
export function reconcileActiveRooms(
  rooms: ActiveRoom[],
  ownerUserId?: string | null,
): void {
  const openRooms = rooms.filter((r) => r.status === 'lobby' || r.status === 'running');
  const current = readSidebarSubmenuState();
  const nextOwner = ownerUserId ?? current.ownerUserId;

  const matched = current.lastRoom
    ? openRooms.find((r) => r.code === current.lastRoom?.code)
    : undefined;
  const chosen = matched ?? openRooms[0] ?? null;

  const nextRoom: StoredRoomSubmenu | null = chosen
    ? {
        code: chosen.code,
        status: chosen.status,
        role: chosen.role,
        leaderName: chosen.leaderName,
        setTitle: chosen.setTitle,
      }
    : null;

  if (sameRoom(current.lastRoom, nextRoom) && current.ownerUserId === nextOwner) return;
  writeState({
    ...current,
    ownerUserId: nextOwner,
    lastRoom: nextRoom,
  });
}

export function recordLastSettingsSection(
  section: StoredSettingsSubmenu,
  ownerUserId?: string | null,
): void {
  const current = readSidebarSubmenuState();
  const nextOwner = ownerUserId ?? current.ownerUserId;
  if (sameSettings(current.lastSettings, section) && current.ownerUserId === nextOwner) return;
  writeState({
    ...current,
    ownerUserId: nextOwner,
    lastSettings: section,
  });
}

export function clearSidebarSubmenus(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage indisponível
  }
  cachedRaw = null;
  cachedState = EMPTY_SIDEBAR_SUBMENU_STATE;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
