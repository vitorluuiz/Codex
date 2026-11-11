'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Button, Toast, ToastViewport } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { AppSidebar } from '@/components/nav/AppSidebar';
import { KIND_META } from '@/components/set-editor/phaseKinds';
import { cx } from '@/lib/cx';
import type { MatchReport, ReportAiReview, User } from '@/lib/types';
import { exportHtmlElementToPdf } from './exportHtmlToPdf';
import {
  AI_VERDICT_META,
  DIFFICULTY_META,
  QUESTION_FLAG_META,
} from './insights/insightLabels';
import { IntegritySection } from './insights/IntegritySection';
import { QuestionQualitySection } from './insights/QuestionQualitySection';
import { MatchReportExportDocument } from './MatchReportExportDocument';
import { PdfExportModal } from './pdf-export/PdfExportModal';
import {
  DEFAULT_PDF_EXPORT_OPTIONS,
  type PdfExportOptions,
} from './pdf-export/pdfExportOptions';
import { loadPdfExportOptions } from './pdf-export/pdfExportStorage';
import { saveVisitedReport } from './visitedReportsStorage';
import styles from './MatchReportView.module.css';

type TabKey = 'phases' | 'quality' | 'ranking' | 'matrix' | 'integrity';

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

interface MatchReportViewProps {
  report: MatchReport;
  isLeader?: boolean;
  backHref?: string;
  backLabel?: string;
  user?: User | null;
}

export function MatchReportView({
  report,
  isLeader = false,
  backHref = '/relatorios',
  backLabel = 'Histórico de relatórios',
  user = null,
}: MatchReportViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('phases');
  const [aiReviewOverride, setAiReviewOverride] = useState<ReportAiReview | null>(null);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [pdfOptions, setPdfOptions] = useState<PdfExportOptions>(DEFAULT_PDF_EXPORT_OPTIONS);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);
  const autoExportTriggeredRef = useRef(false);
  const kpiGridRef = useRef<HTMLElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  const scrollToTabSection = useCallback(() => {
    let targetY = 0;
    if (kpiGridRef.current) {
      const rect = kpiGridRef.current.getBoundingClientRect();
      const kpiGridBottomInDoc = rect.bottom + window.scrollY;
      const container = kpiGridRef.current.parentElement;
      const gap = container
        ? parseFloat(window.getComputedStyle(container).rowGap || window.getComputedStyle(container).gap) || 20
        : 20;
      targetY = kpiGridBottomInDoc + gap;
    } else if (tabsRef.current) {
      const rect = tabsRef.current.getBoundingClientRect();
      targetY = rect.top + window.scrollY;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.scrollTo({
      top: Math.max(0, Math.round(targetY)),
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, []);

  const handleTabClick = useCallback(
    (tabKey: TabKey) => {
      if (activeTab === tabKey) {
        scrollToTabSection();
      } else {
        setActiveTab(tabKey);
      }
    },
    [activeTab, scrollToTabSection],
  );

  const effectiveReport = useMemo<MatchReport>(
    () => ({
      ...report,
      aiReview: aiReviewOverride ?? report.aiReview ?? null,
    }),
    [report, aiReviewOverride],
  );

  const questionInsightByPhaseId = useMemo(
    () => new Map((effectiveReport.insights?.questions ?? []).map((q) => [q.phaseId, q])),
    [effectiveReport.insights?.questions],
  );

  const aiByPhaseId = useMemo(
    () => new Map((effectiveReport.aiReview?.phases ?? []).map((p) => [p.phaseId, p])),
    [effectiveReport.aiReview?.phases],
  );

  const qualityAlertCount = useMemo(() => {
    const questions = effectiveReport.insights?.questions ?? [];
    return questions.filter((q) => {
      const hasHeuristicAlert = q.flags.some(
        (f) =>
          f === 'suspect_answer_key' ||
          f === 'negative_discrimination' ||
          f === 'time_too_short' ||
          f === 'reading_exceeds_time' ||
          f === 'long_question' ||
          f === 'long_options',
      );
      const ai = aiByPhaseId.get(q.phaseId);
      return hasHeuristicAlert || (ai && ai.verdict !== 'ok');
    }).length;
  }, [effectiveReport.insights?.questions, aiByPhaseId]);

  const integrityAlertCount = useMemo(() => {
    const guessCount = (effectiveReport.insights?.guessing?.participants ?? []).filter(
      (g) => g.events.length > 0,
    ).length;
    const collusionCount = (effectiveReport.insights?.collusion?.pairs ?? []).length;
    return guessCount + collusionCount;
  }, [effectiveReport.insights?.guessing, effectiveReport.insights?.collusion]);

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

  const openPdfModal = useCallback(() => {
    if (isExportingPdf) return;
    const loaded = loadPdfExportOptions();
    setPdfOptions(loaded);
    setIsPdfModalOpen(true);
  }, [isExportingPdf]);

  const handleConfirmPdfExport = useCallback(
    (chosenOptions: PdfExportOptions) => {
      if (isExportingPdf) return;
      setPdfOptions(chosenOptions);
      setIsPdfModalOpen(false);
      setIsExportingPdf(true);
      setToast('Renderizando página HTML personalizada e gerando PDF...');
    },
    [isExportingPdf],
  );

  // Quando `isExportingPdf` liga e o container offscreen com o documento A4 é montado,
  // capturamos com html2canvas + jsPDF e baixamos o PDF.
  useEffect(() => {
    if (!isExportingPdf || !pdfContainerRef.current) return;

    let cancelled = false;
    const run = async () => {
      try {
        await exportHtmlElementToPdf(pdfContainerRef.current!, {
          filename: `relatorio-${effectiveReport.roomCode}-${effectiveReport.matchId.slice(0, 8)}.pdf`,
          footerTitle: `${effectiveReport.title} (Sala ${effectiveReport.roomCode})`,
          footerText: pdfOptions.footerText,
          footerLogoDataUrl: pdfOptions.logoDataUrl,
          honorForcedBreaks: pdfOptions.sectionPerPage,
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
  }, [isExportingPdf, effectiveReport, pdfOptions]);

  // Abre modal de exportação automaticamente se a página foi aberta com `?export=pdf`
  useEffect(() => {
    if (autoExportTriggeredRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('export') === 'pdf') {
      autoExportTriggeredRef.current = true;
      params.delete('export');
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
      window.history.replaceState({}, '', nextUrl);
      openPdfModal();
    }
  }, [openPdfModal]);

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
    <div className={styles.layout}>
      <AppSidebar user={user} active="relatorios" />

      <main className={styles.content}>
        <div className={styles.container}>
          <div className={styles.topBar}>
            <Link href={backHref} className={styles.backLink}>
              <Icon.ArrowLeft size={16} />
              {backLabel}
            </Link>

          <div className={styles.exportActions}>
            {process.env.NODE_ENV !== 'production' && (
              <Link
                href={`/relatorios/preview?token=${encodeURIComponent(report.shareToken)}`}
                className={styles.devPreviewLink}
                title="Abrir visualizador com Hot-Reload para editar o layout da folha A4"
              >
                Prévia A4 (Dev)
              </Link>
            )}
            <Button variant="secondary" size="sm" onClick={() => void copyShareLink()}>
              <Icon.Copy size={15} />
              Copiar link seguro
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={isExportingPdf}
              onClick={openPdfModal}
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

        <header className={styles.hero}>
          <div className={styles.heroInfo}>
            <div className={styles.badges}>
              <span className={styles.badgePrimary}>Relatório Consolidado da Turma</span>
              <span className={styles.badgeNeutral}>Sala {effectiveReport.roomCode}</span>
              <span className={styles.badgeNeutral}>{MODE_LABEL[effectiveReport.mode]}</span>
            </div>
            <h1 className={styles.title}>{effectiveReport.title}</h1>
            <p className={styles.subtitle}>
              Concluída em {formatDateBr(effectiveReport.finishedAt)} · Duração de{' '}
              {formatDuration(effectiveReport.durationSeconds)} ·{' '}
              {effectiveReport.overview.phaseCount} fases
            </p>
          </div>
        </header>

        <section
          ref={kpiGridRef}
          className={styles.kpiGrid}
          aria-label="Indicadores gerais da partida"
        >
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Participantes</span>
            <span className={styles.kpiValue}>{effectiveReport.overview.participantCount}</span>
            <span className={styles.kpiSub}>
              {effectiveReport.overview.totalSubmissions} respostas enviadas
            </span>
          </div>

          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Pontuação Média</span>
            <span className={cx(styles.kpiValue, styles.kpiScore)}>
              {effectiveReport.overview.avgScore}
              <span className={styles.kpiUnit}>
                {' '}
                / {effectiveReport.overview.maxPossibleScore} pts
              </span>
            </span>
            <span className={styles.kpiSub}>
              Maior: {effectiveReport.overview.maxAchievedScore} pts · Mediana:{' '}
              {effectiveReport.overview.medianScore} pts
            </span>
          </div>

          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Taxa de Acerto Global</span>
            <span
              className={styles.kpiValue}
              style={{ color: accuracyColor(effectiveReport.overview.accuracyRate) }}
            >
              {effectiveReport.overview.accuracyRate}%
            </span>
            <span className={styles.kpiSub}>
              {effectiveReport.overview.totalCorrect} acertos em{' '}
              {effectiveReport.overview.totalGraded} corrigidas
            </span>
          </div>

          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Tempo Médio / Fase</span>
            <span className={styles.kpiValue}>
              {effectiveReport.overview.avgResponseSeconds}s
            </span>
            <span className={styles.kpiSub}>
              Duração total: {formatDuration(effectiveReport.durationSeconds)}
            </span>
          </div>
        </section>

        <div
          ref={tabsRef}
          className={styles.tabs}
          role="tablist"
          aria-label="Seções do relatório"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'phases'}
            className={cx(styles.tabButton, activeTab === 'phases' && styles.tabButtonActive)}
            onClick={() => handleTabClick('phases')}
          >
            Análise por Fase ({effectiveReport.phases.length})
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'quality'}
            className={cx(styles.tabButton, activeTab === 'quality' && styles.tabButtonActive)}
            onClick={() => handleTabClick('quality')}
          >
            Diagnóstico das Questões
            <span
              className={cx(
                styles.tabBadge,
                qualityAlertCount > 0 && styles.tabBadgeWarn,
              )}
            >
              {qualityAlertCount > 0 ? `${qualityAlertCount} alerta(s)` : 'OK'}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ranking'}
            className={cx(styles.tabButton, activeTab === 'ranking' && styles.tabButtonActive)}
            onClick={() => handleTabClick('ranking')}
          >
            Classificação & Links Individuais ({effectiveReport.participants.length})
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'matrix'}
            className={cx(styles.tabButton, activeTab === 'matrix' && styles.tabButtonActive)}
            onClick={() => handleTabClick('matrix')}
          >
            Matriz Aluno × Fase
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'integrity'}
            className={cx(styles.tabButton, activeTab === 'integrity' && styles.tabButtonActive)}
            onClick={() => handleTabClick('integrity')}
          >
            Integridade
            <span
              className={cx(
                styles.tabBadge,
                integrityAlertCount > 0 && styles.tabBadgeWarn,
              )}
            >
              {integrityAlertCount}
            </span>
          </button>
        </div>

        {activeTab === 'phases' && (
          <section className={styles.tabContent}>
            <div className={styles.phaseChartCard}>
              <h2 className={styles.sectionTitle}>Curva de Acerto por Fase</h2>
              <div className={styles.phaseBars}>
                {effectiveReport.phases.map((ph) => (
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
              {effectiveReport.phases.map((ph) => {
                const meta = KIND_META[ph.kind];
                const qInsight = questionInsightByPhaseId.get(ph.phaseId);
                const aiPhase = aiByPhaseId.get(ph.phaseId);

                return (
                  <article key={ph.phaseId} className={styles.phaseCard}>
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

                    {qInsight && (
                      <div className={styles.phaseDiagnosticStrip}>
                        <span
                          className={styles.diagnosticChip}
                          style={{
                            color: DIFFICULTY_META[qInsight.difficulty].colorHex,
                            background: DIFFICULTY_META[qInsight.difficulty].bgHex,
                          }}
                        >
                          {DIFFICULTY_META[qInsight.difficulty].label}
                        </span>

                        {qInsight.flags.map((flag) => {
                          const flagMeta = QUESTION_FLAG_META[flag];
                          if (!flagMeta) return null;
                          return (
                            <span
                              key={flag}
                              className={styles.diagnosticChip}
                              style={{
                                color: flagMeta.colorHex,
                                background: flagMeta.bgHex,
                              }}
                              title={flagMeta.description}
                            >
                              {flagMeta.shortLabel}
                            </span>
                          );
                        })}

                        {aiPhase && (
                          <span
                            className={styles.diagnosticChip}
                            style={{
                              color: AI_VERDICT_META[aiPhase.verdict].colorHex,
                              background: AI_VERDICT_META[aiPhase.verdict].bgHex,
                            }}
                          >
                            {AI_VERDICT_META[aiPhase.verdict].shortLabel}
                          </span>
                        )}
                      </div>
                    )}

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
        )}

        {activeTab === 'quality' && (
          <section className={styles.tabContent}>
            <QuestionQualitySection
              report={effectiveReport}
              variant="web"
              mode="full"
              showAiReview
              isLeader={isLeader}
              onAiReviewUpdated={(review) => {
                setAiReviewOverride(review);
                setToast('Revisão pedagógica por IA concluída e salva no relatório!');
              }}
            />
          </section>
        )}

        {activeTab === 'ranking' && (
          <section className={styles.tabContent}>
            <div className={styles.tableCard}>
              <div className={styles.tableHeaderDesc}>
                <h2 className={styles.sectionTitle}>Classificação Geral dos Participantes</h2>
                <p className={styles.sectionHint}>
                  Cada participante possui um link exclusivo protegido contra força bruta para
                  consultar seu relatório individual compacto.
                </p>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Posição</th>
                      <th>Participante</th>
                      <th>Pontuação</th>
                      <th>Taxa de Acerto</th>
                      <th>Acertos / Fases</th>
                      <th>Tempo Total</th>
                      <th>Relatório Individual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveReport.participants.map((p) => (
                      <tr key={p.participantId}>
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
                              onClick={() => void copyIndividualLink(p.accessToken, p.displayName)}
                              title={`Copiar link individual de ${p.displayName}`}
                            >
                              <Icon.Copy size={14} />
                              Copiar link
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'matrix' && (
          <section className={styles.tabContent}>
            <div className={styles.tableCard}>
              <div className={styles.tableHeaderDesc}>
                <h2 className={styles.sectionTitle}>Matriz Cruzada: Aluno × Fase</h2>
                <p className={styles.sectionHint}>
                  Visão consolidada de todas as submissões da turma em cada fase da partida.
                </p>
              </div>

              <div className={styles.matrixScrollWrapper}>
                <table className={styles.matrixTable}>
                  <thead>
                    <tr>
                      <th className={styles.stickyColRank}>#</th>
                      <th className={styles.stickyColPlayer}>Participante</th>
                      <th className={styles.stickyColTotal}>Total</th>
                      {effectiveReport.phases.map((ph) => (
                        <th key={ph.phaseId} title={ph.name}>
                          F{ph.phaseNumber}: {ph.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveReport.participants.map((p) => {
                      const ansByPhase = new Map(p.answers.map((a) => [a.phaseId, a]));
                      return (
                        <tr key={p.participantId}>
                          <td className={cx(styles.rankCell, styles.stickyColRank)}>#{p.rank}</td>
                          <td
                            className={cx(styles.matrixPlayerName, styles.stickyColPlayer)}
                            title={p.displayName}
                          >
                            {p.displayName}
                          </td>
                          <td className={cx(styles.scoreStrong, styles.stickyColTotal)}>
                            {p.totalScore} pts
                          </td>
                          {effectiveReport.phases.map((ph) => {
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
        )}

        {activeTab === 'integrity' && (
          <section className={styles.tabContent}>
            <IntegritySection report={effectiveReport} variant="web" />
          </section>
        )}
      </div>
    </main>

    {/* Modal pré-exportação de PDF com templates, switches e preview animado */}
      <PdfExportModal
        open={isPdfModalOpen}
        report={effectiveReport}
        initialOptions={pdfOptions}
        isExporting={isExportingPdf}
        onClose={() => setIsPdfModalOpen(false)}
        onConfirmExport={handleConfirmPdfExport}
      />

      {/* Superfície de exportação HTML -> PDF: renderiza o MatchReportExportDocument */}
      {isExportingPdf && (
        <div className={styles.pdfOffscreenWrapper} aria-hidden="true">
          <div ref={pdfContainerRef}>
            <MatchReportExportDocument report={effectiveReport} options={pdfOptions} />
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
