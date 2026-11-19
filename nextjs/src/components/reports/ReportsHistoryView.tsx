'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Tabs, type TabItem } from '@/components/ds';
import {
  MatchHistoryList,
  type MatchHistoryRowItem,
} from '@/components/match-history/MatchHistoryList';
import { AppSidebar } from '@/components/nav/AppSidebar';
import type { Audience, User, UserReportsHistory } from '@/lib/types';
import styles from './ReportsHistoryView.module.css';

type ReportsTab = 'leader' | 'participant';

const PARTICIPANTS_LABEL: Record<Audience, string> = {
  teacher: 'Participantes',
  recruiter: 'Candidatos',
};

function formatDateBr(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

interface ReportsHistoryViewProps {
  user: User | null;
  serverHistory: UserReportsHistory | null;
}

export function ReportsHistoryView({ user, serverHistory }: ReportsHistoryViewProps) {
  const router = useRouter();
  const [linkInput, setLinkInput] = useState('');
  const [activeTab, setActiveTab] = useState<ReportsTab>('leader');

  const leaderReports = serverHistory?.leaderReports ?? [];
  const participantReports = serverHistory?.participantReports ?? [];
  const participantsLabel = user ? PARTICIPANTS_LABEL[user.audience] : 'Participantes';

  const tabs: TabItem<ReportsTab>[] = [
    { id: 'leader', label: `Relatórios como Líder (${leaderReports.length})` },
    { id: 'participant', label: `Relatórios como Participante (${participantReports.length})` },
  ];

  const leaderItems: MatchHistoryRowItem[] = leaderReports.map((item) => ({
    id: item.matchId,
    href: `/relatorios/${item.shareToken}`,
    title: item.title,
    mode: item.mode,
    dateLabel: formatDateBr(item.finishedAt),
    phaseValues: item.phaseScores ?? [],
    score: item.avgScore,
    maxScore: item.maxPossibleScore,
    statLabel: `${item.participantCount} ${participantsLabel}`,
  }));

  const participantItems: MatchHistoryRowItem[] = participantReports.map((item) => ({
    id: `${item.matchId}-${item.accessToken}`,
    href: `/relatorios/individual/${item.accessToken}`,
    title: item.title,
    mode: item.mode,
    dateLabel: formatDateBr(item.finishedAt),
    phaseValues: item.phaseScores ?? [],
    score: item.totalScore,
    maxScore: item.maxPossibleScore,
    statLabel: `#${item.rank} de ${item.participantCount} · ${item.correctCount}/${item.phaseCount} acertos`,
  }));

  function openByInput(e: React.FormEvent) {
    e.preventDefault();
    const raw = linkInput.trim();
    if (!raw) return;

    const indivMatch = /\/relatorios\/individual\/([A-Za-z0-9_-]+)/.exec(raw);
    if (indivMatch) {
      router.push(`/relatorios/individual/${indivMatch[1]}`);
      return;
    }

    const shareMatch = /\/relatorios\/([A-Za-z0-9_-]+)/.exec(raw);
    if (shareMatch) {
      router.push(`/relatorios/${shareMatch[1]}`);
      return;
    }

    router.push(`/relatorios/individual/${encodeURIComponent(raw)}`);
  }

  return (
    <div className={styles.layout}>
      <AppSidebar user={user} active="relatorios" />

      <main className={styles.content}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1 className={styles.title}>Central de Relatórios</h1>
            <p className={styles.subtitle}>
              Consulte relatórios completos de partidas conduzidas como líder, seus relatórios
              individuais compactos e exporte a página HTML em PDF ou planilha Excel (.xlsx).
            </p>
          </header>

          <form className={styles.lookupBar} onSubmit={openByInput}>
            <input
              type="text"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="Cole um link ou token de relatório recebido..."
              className={styles.lookupInput}
            />
            <Button type="submit" size="sm">
              Abrir relatório
            </Button>
          </form>

          {user && (
            <>
              <div className={styles.tabs}>
                <Tabs
                  label="Categoria de relatórios"
                  tabs={tabs}
                  active={activeTab}
                  onChange={setActiveTab}
                />
              </div>

              <section className={styles.section} role="tabpanel">
                {activeTab === 'leader' ? (
                  <MatchHistoryList
                    items={leaderItems}
                    emptyMessage="Você ainda não possui partidas finalizadas como líder."
                  />
                ) : (
                  <MatchHistoryList
                    items={participantItems}
                    emptyMessage="Nenhuma partida encontrada no seu histórico de participante."
                  />
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
