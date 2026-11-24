'use client';

import type { AvatarIndex, MatchMode } from '@/lib/types';

export interface VisitedReportEntry {
  kind: 'leader' | 'individual';
  token: string;
  matchId: string;
  roomCode: string;
  title: string;
  mode: MatchMode;
  finishedAt: string;
  visitedAt: string;
  // Campos especificos do individual
  displayName?: string;
  avatarIndex?: AvatarIndex;
  rank?: number;
  totalScore?: number;
  // Campos especificos do lider
  avgScore?: number;
  maxPossibleScore: number;
  accuracyRate: number;
  participantCount: number;
}

const STORAGE_KEY = 'codex:visited_reports:v1';
const CHANGE_EVENT = 'codex:visited-reports-change';

let cachedRaw: string | null | undefined = undefined;
let cachedLatest: VisitedReportEntry | null = null;

export function loadVisitedReports(): VisitedReportEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VisitedReportEntry[]) : [];
  } catch {
    return [];
  }
}

export function readLatestVisitedReport(): VisitedReportEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedLatest;
    cachedRaw = raw;
    if (!raw) {
      cachedLatest = null;
      return null;
    }
    const parsed = JSON.parse(raw);
    cachedLatest =
      Array.isArray(parsed) && parsed.length > 0 ? (parsed[0] as VisitedReportEntry) : null;
    return cachedLatest;
  } catch {
    return null;
  }
}

export function saveVisitedReport(entry: VisitedReportEntry): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = loadVisitedReports().filter(
      (item) => !(item.kind === entry.kind && item.token === entry.token),
    );
    const updated = [entry, ...existing].slice(0, 50);
    const serialized = JSON.stringify(updated);
    window.localStorage.setItem(STORAGE_KEY, serialized);
    cachedRaw = serialized;
    cachedLatest = updated[0] ?? null;
  } catch {
    /* localStorage indisponivel */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearVisitedReports(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage indisponivel */
  }
  cachedRaw = null;
  cachedLatest = null;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeVisitedReports(onStoreChange: () => void): () => void {
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
