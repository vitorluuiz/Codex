'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Button, Toast, ToastViewport } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { KIND_META } from '@/components/set-editor/phaseKinds';
import { cx } from '@/lib/cx';
import type { MatchReport } from '@/lib/types';
import { exportHtmlElementToPdf } from './exportHtmlToPdf';
import { saveVisitedReport } from './visitedReportsStorage';
import styles from './MatchReportView.module.css';

type TabKey = 'phases' | 'ranking' | 'matrix';

const MODE_LABEL: Record<MatchReport['mode'], string> = {
  live: 'Ao vivo',
  'self-paced': 'Próprio ritmo',
};

function formatDateBr(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins} min ${secs}s`;
}

function accuracyColor(value: number): string {
  if (value >= 75) return 'var(--accent-success)';
  if (value >= 50) return 'var(--accent-streak)';
  return 'var(--accent-danger)';
}

interface ReportContentSectionProps {
  report: MatchReport;
  forPdf?: boolean;
  onCopyIndividualLink?: (accessToken: string, name: string) => void;
}

function ReportHeroAndKpis({ report }: { report: MatchReport }) {
  return (
    <>
      <header className={styles.hero} data-pdf-keep-together>
        <div className={styles.heroInfo}>
          <div className={styles.badges}>
            <span className={styles.badgePrimary}>Relatório Consolidado da Turma</span>
            <span className={styles.badgeNeutral}>Sala {report.roomCode}</span>
            <span className={styles.badgeNeutral}>{MODE_LABEL[report.mode]}</span>
          </div>
          <h1 className={styles.title}>{report.title}</h1>
          <p className={styles.subtitle}>
            Concluída em {formatDateBr(report.finishedAt)} · Duração de{' '}
            {formatDuration(report.durationSeconds)} · {report.overview.phaseCount} fases
          </p>
        </div>
      </header>

      <section
        className={styles.kpiGrid}
        aria-label="Indicadores gerais da partida"
        data-pdf-keep-together
      >
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Participantes</span>
          <span className={styles.kpiValue}>{report.overview.participantCount}</span>
          <span className={styles.kpiSub}>
            {report.overview.totalSubmissions} respostas enviadas
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Pontuação Média</span>
          <span className={cx(styles.kpiValue, styles.kpiScore)}>
            {report.overview.avgScore}
            <span className={styles.kpiUnit}> / {report.overview.maxPossibleScore} pts</span>
          </span>
          <span className={styles.kpiSub}>
            Maior: {report.overview.maxAchievedScore} pts · Mediana: {report.overview.medianScore}{' '}
            pts
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Taxa de Acerto Global</span>
          <span
            className={styles.kpiValue}
            style={{ color: accuracyColor(report.overview.accuracyRate) }}
          >
            {report.overview.accuracyRate}%
          </span>
          <span className={styles.kpiSub}>
            {report.overview.totalCorrect} acertos em {report.overview.totalGraded} corrigidas
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Tempo Médio / Fase</span>
          <span className={styles.kpiValue}>{report.overview.avgResponseSeconds}s</span>
          <span className={styles.kpiSub}>
            Duração total: {formatDuration(report.durationSeconds)}
          </span>
        </div>
      </section>
    </>
  );
}

function PhasesSection({ report, forPdf }: ReportContentSectionProps) {
  return (
    <section className={styles.tabContent}>
      {forPdf && (
        <div className={styles.pdfSectionDivider} data-pdf-keep-together>
          <span className={styles.pdfSectionIndex}>Seção 1</span>
          <h2 className={styles.pdfSectionHeading}>Análise Detalhada por Fase</h2>
        </div>
      )}

      <div className={styles.phaseChartCard} data-pdf-keep-together>
        <h2 className={styles.sectionTitle}>Curva de Acerto por Fase</h2>
        <div className={styles.phaseBars}>
          {report.phases.map((ph) => (
            <div key={ph.phaseId} className={styles.phaseBarCol}>
              <span className={styles.phaseBarPct}>{ph.accuracyRate}%</span>
              <div className={styles.phaseBarTrack}>
                <div
                  className={styles.phaseBarFill}
                  style={{
                    height: `${Math.max(6, ph.accuracyRate)}%`,
                    background: accuracyColor(ph.accuracyRate),
                  }}
                />
              </div>
              <span className={styles.phaseBarLabel} title={ph.name}>
                F{ph.phaseNumber}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.phaseList}>
        {report.phases.map((ph) => {
          const meta = KIND_META[ph.kind];
          return (
            <article key={ph.phaseId} className={styles.phaseCard} data-pdf-keep-together>
              <div className={styles.phaseHead}>
                <div className={styles.phaseTitleGroup}>
                  <span className={styles.phaseNumBadge}>Fase {ph.phaseNumber}</span>
                  <span className={styles.phaseKindChip} style={{ color: meta.color }}>
                    {meta.icon}
                    {meta.label}
                  </span>
                  <h3 className={styles.phaseName}>{ph.name}</h3>
                </div>

                <div className={styles.phaseQuickStats}>
                  <span
                    className={styles.phaseAccuracyPill}
                    style={{ color: accuracyColor(ph.accuracyRate) }}
                  >
                    {ph.accuracyRate}% de acerto
                  </span>
                  <span className={styles.phaseStatText}>
                    Média: <strong>{ph.avgScore}</strong> / {ph.maxScore} pts
                  </span>
                  <span className={styles.phaseStatText}>
                    Tempo médio: <strong>{ph.avgElapsedSeconds}s</strong>
                  </span>
                </div>
              </div>

              <p className={styles.phaseQuestion}>{ph.question}</p>

              <div className={styles.phaseDetailsRow}>
                <div className={styles.phaseAnswerBox}>
                  <span className={styles.detailLabel}>Gabarito esperado</span>
                  <span className={styles.detailValue}>{ph.correctAnswerText}</span>
                </div>
                <div className={styles.phaseAnswerBox}>
                  <span className={styles.detailLabel}>Distribuição de entregas</span>
                  <span className={styles.detailValue}>
                    {ph.correctCount} acertos · {ph.incorrectCount} erros ·{' '}
                    {ph.unansweredCount} em branco
                    {ph.pendingCount > 0 ? ` · ${ph.pendingCount} pendentes` : ''}
                  </span>
                </div>
              </div>

              {ph.optionDistribution.length > 0 && (
                <div className={styles.optionDistList}>
                  {ph.optionDistribution.map((opt) => (
                    <div
                      key={opt.optionId}
                      className={cx(
                        styles.optionDistRow,
                        opt.isCorrect && styles.optionDistCorrect,
                      )}
                    >
                      <div className={styles.optionDistHeader}>
                        <span className={styles.optionDistLabel}>
                          {opt.isCorrect ? '✓ ' : ''}
                          {opt.label}
                        </span>
                        <span className={styles.optionDistCount}>
                          {opt.count} ({opt.percentage}%)
                        </span>
                      </div>
                      <div className={styles.optionDistTrack}>
                        <div
                          className={styles.optionDistFill}
                          style={{
                            width: `${opt.percentage}%`,
                            background: opt.isCorrect
                              ? 'var(--accent-success)'
                              : 'var(--blue-400)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RankingSection({ report, forPdf, onCopyIndividualLink }: ReportContentSectionProps) {
  return (
    <section className={styles.tabContent}>
      {forPdf && (
        <div className={styles.pdfSectionDivider} data-pdf-keep-together>
          <span className={styles.pdfSectionIndex}>Seção 2</span>
          <h2 className={styles.pdfSectionHeading}>Classificação Geral dos Participantes</h2>
        </div>
      )}

      <div className={styles.tableCard}>
        <div className={styles.tableHeaderDesc} data-pdf-keep-together>
          <h2 className={styles.sectionTitle}>Classificação Geral dos Participantes</h2>
          <p className={styles.sectionHint}>
            {forPdf
              ? 'Desempenho consolidado da turma ordenado por pontuação e tempo de resposta.'
              : 'Cada participante possui um link exclusivo protegido contra força bruta para consultar seu relatório individual compacto.'}
          </p>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead data-pdf-keep-together>
              <tr>
                <th>Posição</th>
                <th>Participante</th>
                <th>Pontuação</th>
                <th>Taxa de Acerto</th>
                <th>Acertos / Fases</th>
                <th>Tempo Total</th>
                {!forPdf && <th>Relatório Individual</th>}
              </tr>
            </thead>
            <tbody>
              {report.participants.map((p) => (
                <tr key={p.participantId} data-pdf-keep-together>
                  <td className={styles.rankCell}>
                    <span
                      className={cx(
                        styles.rankBadge,
                        p.rank === 1 && styles.rankFirst,
                        p.rank === 2 && styles.rankSecond,
                        p.rank === 3 && styles.rankThird,
                      )}
                    >
                      #{p.rank}
                    </span>
                  </td>
                  <td>
                    <div className={styles.playerCell}>
                      <Avatar index={p.avatarIndex} size="sm" name={p.displayName} />
                      <div>
                        <div className={styles.playerName}>{p.displayName}</div>
                        <div className={styles.playerMeta}>
                          {p.userId ? 'Conta cadastrada' : 'Convidado'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={styles.scoreStrong}>{p.totalScore}</span>
                    <span className={styles.scoreMuted}> / {p.maxPossibleScore} pts</span>
                  </td>
                  <td>
                    <span
                      className={styles.accuracyStrong}
                      style={{ color: accuracyColor(p.accuracyRate) }}
                    >
                      {p.accuracyRate}%
                    </span>
                  </td>
                  <td>
                    {p.correctCount} acertos · {p.incorrectCount} erros
                    {p.unansweredCount > 0 ? ` · ${p.unansweredCount} em branco` : ''}
                  </td>
                  <td>
                    {p.totalElapsedSeconds}s (méd. {p.avgElapsedSeconds}s)
                  </td>
                  {!forPdf && (
                    <td>
                      <div className={styles.rowActions}>
                        <Link
                          href={`/relatorios/individual/${p.accessToken}`}
                          className={styles.actionLinkBtn}
                        >
                          <Icon.Eye size={14} />
                          Abrir
                        </Link>
                        <button
                          type="button"
                          className={styles.copyIconBtn}
                          onClick={() => onCopyIndividualLink?.(p.accessToken, p.displayName)}
                          title={`Copiar link individual de ${p.displayName}`}
                        >
                          <Icon.Copy size={14} />
                          Copiar link
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MatrixSection({ report, forPdf }: ReportContentSectionProps) {
  return (
    <section className={styles.tabContent}>
      {forPdf && (
        <div className={styles.pdfSectionDivider} data-pdf-keep-together>
          <span className={styles.pdfSectionIndex}>Seção 3</span>
          <h2 className={styles.pdfSectionHeading}>Matriz Cruzada: Aluno × Fase</h2>
        </div>
      )}

      <div className={styles.tableCard}>
        <div className={styles.tableHeaderDesc} data-pdf-keep-together>
          <h2 className={styles.sectionTitle}>Matriz Cruzada: Aluno × Fase</h2>
          <p className={styles.sectionHint}>
            Visão consolidada de todas as submissões da turma em cada fase da partida.
          </p>
        </div>

        <div className={cx(styles.tableWrapper, forPdf && styles.tableWrapperPdf)}>
          <table className={cx(styles.matrixTable, forPdf && styles.matrixTablePdf)}>
            <thead data-pdf-keep-together>
              <tr>
                <th>#</th>
                <th>Participante</th>
                <th>Total</th>
                {report.phases.map((ph) => (
                  <th key={ph.phaseId} title={ph.name}>
                    F{ph.phaseNumber}: {ph.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.participants.map((p) => {
                const ansByPhase = new Map(p.answers.map((a) => [a.phaseId, a]));
                return (
                  <tr key={p.participantId} data-pdf-keep-together>
                    <td className={styles.rankCell}>#{p.rank}</td>
                    <td className={styles.matrixPlayerName}>{p.displayName}</td>
                    <td className={styles.scoreStrong}>{p.totalScore} pts</td>
                    {report.phases.map((ph) => {
                      const ans = ansByPhase.get(ph.phaseId);
                      if (!ans || !ans.submitted) {
                        return (
                          <td key={ph.phaseId} className={styles.cellUnanswered}>
                            <span className={styles.cellMain}>—</span>
                            <span className={styles.cellSub}>Em branco</span>
                          </td>
                        );
                      }
                      if (ans.grading === 'pending') {
                        return (
                          <td key={ph.phaseId} className={styles.cellPending}>
                            <span className={styles.cellMain}>⏳ Pendente</span>
                            <span className={styles.cellSub}>{ans.givenAnswerText}</span>
                          </td>
                        );
                      }
                      return (
                        <td
                          key={ph.phaseId}
                          className={ans.correct ? styles.cellCorrect : styles.cellWrong}
                        >
                          <span className={styles.cellMain}>
                            {ans.correct ? '✓' : '✗'} {ans.score} pts ({ans.elapsedSeconds}s)
                          </span>
                          <span className={styles.cellSub} title={ans.givenAnswerText}>
                            {ans.givenAnswerText}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

interface MatchReportViewProps {
  report: MatchReport;
  backHref?: string;
  backLabel?: string;
}

export function MatchReportView({
  report,
  backHref = '/relatorios',
  backLabel = 'Histórico de relatórios',
}: MatchReportViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('phases');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);
  const autoExportTriggeredRef = useRef(false);

  useEffect(() => {
    saveVisitedReport({
      kind: 'leader',
      token: report.shareToken,
      matchId: report.matchId,
      roomCode: report.roomCode,
      title: report.title,
      mode: report.mode,
      finishedAt: report.finishedAt,
      visitedAt: new Date().toISOString(),
      avgScore: report.overview.avgScore,
      maxPossibleScore: report.overview.maxPossibleScore,
      accuracyRate: report.overview.accuracyRate,
      participantCount: report.overview.participantCount,
    });
  }, [report]);

  const exportPdfFromHtml = useCallback(async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setToast('Renderizando página HTML em tema claro e gerando PDF...');
  }, [isExportingPdf]);

  // Quando `isExportingPdf` liga e o container offscreen com as 3 abas em tema claro é montado,
  // capturamos com html2canvas + jsPDF e baixamos o PDF.
  useEffect(() => {
    if (!isExportingPdf || !pdfContainerRef.current) return;

    let cancelled = false;
    const run = async () => {
      try {
        await exportHtmlElementToPdf(pdfContainerRef.current!, {
          filename: `relatorio-${report.roomCode}-${report.matchId.slice(0, 8)}.pdf`,
          footerTitle: `${report.title} (Sala ${report.roomCode})`,
        });
        if (!cancelled) {
          setToast('Relatório em PDF exportado com sucesso!');
        }
      } catch (err) {
        console.error('Erro ao exportar HTML para PDF:', err);
        if (!cancelled) {
          setToast('Não foi possível exportar o PDF. Tente novamente.');
        }
      } finally {
        if (!cancelled) {
          setIsExportingPdf(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isExportingPdf, report]);

  // Dispara exportação automática se a página foi aberta com `?export=pdf` (ex.: atalho de /relatorios ou /perfil)
  useEffect(() => {
    if (autoExportTriggeredRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('export') === 'pdf') {
      autoExportTriggeredRef.current = true;
      params.delete('export');
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
      window.history.replaceState({}, '', nextUrl);
      void exportPdfFromHtml();
    }
  }, [exportPdfFromHtml]);

  async function copyShareLink() {
    const url = `${window.location.origin}/relatorios/${report.shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast('Link seguro do relatório copiado para a área de transferência!');
    } catch {
      setToast(url);
    }
  }

  async function copyIndividualLink(accessToken: string, name: string) {
    const url = `${window.location.origin}/relatorios/individual/${accessToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast(`Link individual de ${name} copiado!`);
    } catch {
      setToast(url);
    }
  }

  function downloadExcel() {
    const url = `/api/reports/share/${encodeURIComponent(report.shareToken)}/export?format=xlsx`;
    window.open(url, '_blank');
    setToast('Gerando e baixando planilha Excel (.xlsx)...');
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <Link href={backHref} className={styles.backLink}>
            <Icon.ArrowLeft size={16} />
            {backLabel}
          </Link>

          <div className={styles.exportActions}>
            <Button variant="secondary" size="sm" onClick={() => void copyShareLink()}>
              <Icon.Copy size={15} />
              Copiar link seguro
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={isExportingPdf}
              onClick={() => void exportPdfFromHtml()}
            >
              <Icon.Download size={15} />
              {isExportingPdf ? 'Gerando PDF...' : 'Exportar PDF'}
            </Button>
            <Button size="sm" onClick={downloadExcel}>
              <Icon.Download size={15} />
              Exportar Excel (.xlsx)
            </Button>
          </div>
        </div>

        <ReportHeroAndKpis report={report} />

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'phases'}
            className={cx(styles.tabButton, activeTab === 'phases' && styles.tabButtonActive)}
            onClick={() => setActiveTab('phases')}
          >
            Análise por Fase ({report.phases.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ranking'}
            className={cx(styles.tabButton, activeTab === 'ranking' && styles.tabButtonActive)}
            onClick={() => setActiveTab('ranking')}
          >
            Classificação & Links Individuais ({report.participants.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'matrix'}
            className={cx(styles.tabButton, activeTab === 'matrix' && styles.tabButtonActive)}
            onClick={() => setActiveTab('matrix')}
          >
            Matriz Aluno × Fase
          </button>
        </div>

        {activeTab === 'phases' && <PhasesSection report={report} />}

        {activeTab === 'ranking' && (
          <RankingSection report={report} onCopyIndividualLink={copyIndividualLink} />
        )}

        {activeTab === 'matrix' && <MatrixSection report={report} />}
      </div>

      {/* Superfície de exportação HTML -> PDF: renderiza os mesmos componentes da página em tema claro com as 3 abas expandidas */}
      {isExportingPdf && (
        <div className={styles.pdfOffscreenWrapper} aria-hidden="true">
          <div ref={pdfContainerRef} className={cx(styles.pdfExportRoot, styles.container)}>
            <ReportHeroAndKpis report={report} />
            <PhasesSection report={report} forPdf />
            <RankingSection report={report} forPdf />
            <MatrixSection report={report} forPdf />
          </div>
        </div>
      )}

      {toast && (
        <ToastViewport>
          <Toast
            tone="success"
            title="Relatório"
            message={toast}
            onClose={() => setToast(null)}
          />
        </ToastViewport>
      )}
    </div>
  );
}
