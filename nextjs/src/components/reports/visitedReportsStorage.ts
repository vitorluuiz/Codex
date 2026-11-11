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

export function saveVisitedReport(entry: VisitedReportEntry): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = loadVisitedReports().filter(
      (item) => !(item.kind === entry.kind && item.token === entry.token),
    );
    const updated = [entry, ...existing].slice(0, 50);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    /* localStorage indisponivel */
  }
}
