'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button, Toast, ToastViewport } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import type { User, UserReportsHistory } from '@/lib/types';
import { loadVisitedReports, type VisitedReportEntry } from './visitedReportsStorage';
import styles from './ReportsHistoryView.module.css';

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
  const [visited, setVisited] = useState<VisitedReportEntry[]>([]);
  const [linkInput, setLinkInput] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setVisited(loadVisitedReports());
  }, []);

  const leaderReports = serverHistory?.leaderReports ?? [];
  const participantReports = serverHistory?.participantReports ?? [];

  // Filtra os relatórios salvos localmente que já não estejam nas listas do servidor
  const serverShareTokens = new Set(leaderReports.map((r) => r.shareToken));
  const serverAccessTokens = new Set(participantReports.map((r) => r.accessToken));

  const guestSavedReports = visited.filter((v) =>
    v.kind === 'leader' ? !serverShareTokens.has(v.token) : !serverAccessTokens.has(v.token),
  );

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

  async function copyUrl(path: string, label: string) {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast(`${label} copiado para a área de transferência!`);
    } catch {
      setToast(url);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topNav}>
          <Link href={user ? `/perfil/${user.id}` : '/'} className={styles.backLink}>
            <Icon.ArrowLeft size={16} />
            {user ? 'Voltar ao perfil' : 'Início'}
          </Link>
        </div>

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
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Relatórios de Partidas como Líder ({leaderReports.length})
            </h2>

            {leaderReports.length === 0 ? (
              <p className={styles.empty}>
                Você ainda não possui partidas finalizadas como líder.
              </p>
            ) : (
              <div className={styles.list}>
                {leaderReports.map((item) => (
                  <div key={item.matchId} className={styles.card}>
                    <div className={styles.cardMain}>
                      <span className={styles.cardTitle}>{item.title}</span>
                      <span className={styles.cardMeta}>
                        Sala {item.roomCode} · {formatDateBr(item.finishedAt)} · {item.phaseCount}{' '}
                        fases · {item.participantCount} participantes
                      </span>
                    </div>

                    <div className={styles.cardStats}>
                      <div className={styles.statCol}>
                        <span className={styles.statValue}>
                          {item.avgScore} / {item.maxPossibleScore} pts
                        </span>
                        <span className={styles.statLabel}>Média da turma</span>
                      </div>
                      <div className={styles.statCol}>
                        <span className={styles.statValue}>{item.accuracyRate}%</span>
                        <span className={styles.statLabel}>Taxa de acerto</span>
                      </div>
                    </div>

                    <div className={styles.cardActions}>
                      <Link
                        href={`/relatorios/${item.shareToken}`}
                        className={styles.primaryAction}
                      >
                        <Icon.Eye size={15} />
                        Ver página
                      </Link>
                      <Link
                        href={`/relatorios/${item.shareToken}?export=pdf`}
                        className={styles.secondaryAction}
                        title="Exportar página HTML como PDF"
                      >
                        PDF
                      </Link>
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={() =>
                          window.open(
                            `/api/reports/share/${encodeURIComponent(item.shareToken)}/export?format=xlsx`,
                            '_blank',
                          )
                        }
                        title="Baixar Planilha Excel (.xlsx)"
                      >
                        Excel
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={() =>
                          void copyUrl(`/relatorios/${item.shareToken}`, 'Link do relatório')
                        }
                        title="Copiar link compartilhável"
                      >
                        <Icon.Copy size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {user && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Meus Relatórios Individuais como Participante ({participantReports.length})
            </h2>

            {participantReports.length === 0 ? (
              <p className={styles.empty}>
                Nenhuma partida encontrada no seu histórico de participante.
              </p>
            ) : (
              <div className={styles.list}>
                {participantReports.map((item) => (
                  <div key={`${item.matchId}-${item.accessToken}`} className={styles.card}>
                    <div className={styles.cardMain}>
                      <span className={styles.cardTitle}>{item.title}</span>
                      <span className={styles.cardMeta}>
                        Sala {item.roomCode} · {formatDateBr(item.finishedAt)} · Posição #
                        {item.rank} de {item.participantCount}
                      </span>
                    </div>

                    <div className={styles.cardStats}>
                      <div className={styles.statCol}>
                        <span className={styles.statValue}>
                          {item.totalScore} / {item.maxPossibleScore} pts
                        </span>
                        <span className={styles.statLabel}>Minha pontuação</span>
                      </div>
                      <div className={styles.statCol}>
                        <span className={styles.statValue}>{item.accuracyRate}%</span>
                        <span className={styles.statLabel}>
                          {item.correctCount}/{item.phaseCount} acertos
                        </span>
                      </div>
                    </div>

                    <div className={styles.cardActions}>
                      <Link
                        href={`/relatorios/individual/${item.accessToken}`}
                        className={styles.primaryAction}
                      >
                        <Icon.Eye size={15} />
                        Ver meu relatório
                      </Link>
                      <Link
                        href={`/relatorios/individual/${item.accessToken}?export=pdf`}
                        className={styles.secondaryAction}
                        title="Exportar meu relatório HTML como PDF"
                      >
                        PDF
                      </Link>
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={() =>
                          void copyUrl(
                            `/relatorios/individual/${item.accessToken}`,
                            'Seu link individual',
                          )
                        }
                        title="Copiar link individual"
                      >
                        <Icon.Copy size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {(guestSavedReports.length > 0 || !user) && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Relatórios Acessados neste Navegador ({guestSavedReports.length})
            </h2>

            {guestSavedReports.length === 0 ? (
              <p className={styles.empty}>
                Os links de relatórios que você abrir aparecerão salvos aqui para consulta futura.
              </p>
            ) : (
              <div className={styles.list}>
                {guestSavedReports.map((v) => {
                  const href =
                    v.kind === 'leader'
                      ? `/relatorios/${v.token}`
                      : `/relatorios/individual/${v.token}`;
                  return (
                    <div key={`${v.kind}-${v.token}`} className={styles.card}>
                      <div className={styles.cardMain}>
                        <span className={styles.cardTitle}>
                          {v.title}{' '}
                          {v.kind === 'individual' && v.displayName ? `— ${v.displayName}` : ''}
                        </span>
                        <span className={styles.cardMeta}>
                          {v.kind === 'leader' ? 'Relatório da Turma' : 'Relatório Individual'} ·
                          Sala {v.roomCode} · {formatDateBr(v.finishedAt)}
                        </span>
                      </div>

                      <div className={styles.cardStats}>
                        <div className={styles.statCol}>
                          <span className={styles.statValue}>
                            {v.kind === 'leader' ? v.avgScore : v.totalScore} /{' '}
                            {v.maxPossibleScore} pts
                          </span>
                          <span className={styles.statLabel}>
                            {v.kind === 'leader' ? 'Média da turma' : `Posição #${v.rank ?? 1}`}
                          </span>
                        </div>
                        <div className={styles.statCol}>
                          <span className={styles.statValue}>{v.accuracyRate}%</span>
                          <span className={styles.statLabel}>Acerto</span>
                        </div>
                      </div>

                      <div className={styles.cardActions}>
                        <Link href={href} className={styles.primaryAction}>
                          <Icon.Eye size={15} />
                          Abrir
                        </Link>
                        <Link
                          href={`${href}?export=pdf`}
                          className={styles.secondaryAction}
                          title="Exportar relatório como PDF"
                        >
                          PDF
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {toast && (
        <ToastViewport>
          <Toast
            tone="success"
            title="Relatórios"
            message={toast}
            onClose={() => setToast(null)}
          />
        </ToastViewport>
      )}
    </div>
  );
}
