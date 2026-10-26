'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Avatar } from '@/components/avatar/Avatar';
import { Button, Toast, ToastViewport } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { KIND_META } from '@/components/set-editor/phaseKinds';
import { cx } from '@/lib/cx';
import type { IndividualReport } from '@/lib/types';
import { exportHtmlElementToPdf } from './exportHtmlToPdf';
import { saveVisitedReport } from './visitedReportsStorage';
import styles from './IndividualReportView.module.css';

function formatDateBr(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function accuracyColor(value: number): string {
  if (value >= 75) return 'var(--accent-success)';
  if (value >= 50) return 'var(--accent-streak)';
  return 'var(--accent-danger)';
}

function IndividualReportBody({ report }: { report: IndividualReport }) {
  const p = report.participant;
  const c = report.classOverview;

  return (
    <>
      <header className={styles.heroCard} data-pdf-keep-together>
        <div className={styles.identityRow}>
          <Avatar index={p.avatarIndex} size="lg" name={p.displayName} />
          <div className={styles.identityInfo}>
            <div className={styles.badges}>
              <span className={styles.rankBadge}>
                #{p.rank} de {c.participantCount} participantes
              </span>
              <span className={styles.roomBadge}>Sala {report.roomCode}</span>
            </div>
            <h1 className={styles.playerName}>{p.displayName}</h1>
            <p className={styles.matchMeta}>
              <strong>{report.title}</strong> · {formatDateBr(report.finishedAt)}
            </p>
          </div>
        </div>

        <div className={styles.scoreHighlight}>
          <span className={styles.scoreLabel}>Pontuação Final</span>
          <span className={styles.scoreBig}>
            {p.totalScore}
            <span className={styles.scoreMax}> / {p.maxPossibleScore} pts</span>
          </span>
          <span className={styles.scoreSub}>Média da turma: {c.avgScore} pts</span>
        </div>
      </header>

      <section className={styles.kpiGrid} data-pdf-keep-together>
        <div className={styles.kpiTile}>
          <span className={styles.kpiLabel}>Taxa de Acerto</span>
          <span
            className={styles.kpiValue}
            style={{ color: accuracyColor(p.accuracyRate) }}
          >
            {p.accuracyRate}%
          </span>
          <span className={styles.kpiComparison}>Turma: {c.accuracyRate}%</span>
        </div>

        <div className={styles.kpiTile}>
          <span className={styles.kpiLabel}>Fases Corretas</span>
          <span className={styles.kpiValue}>
            {p.correctCount} / {c.phaseCount}
          </span>
          <span className={styles.kpiComparison}>
            {p.incorrectCount} erros · {p.unansweredCount} em branco
          </span>
        </div>

        <div className={styles.kpiTile}>
          <span className={styles.kpiLabel}>Tempo Médio</span>
          <span className={styles.kpiValue}>{p.avgElapsedSeconds}s</span>
          <span className={styles.kpiComparison}>
            Tempo total: {p.totalElapsedSeconds}s (Turma: {c.avgResponseSeconds}s/fase)
          </span>
        </div>
      </section>

      <section className={styles.reviewSection}>
        <h2 className={styles.sectionTitle} data-pdf-keep-together>
          Revisão Compacta por Fase
        </h2>

        <div className={styles.answerList}>
          {p.answers.map((ans) => {
            const meta = KIND_META[ans.kind];
            const stateClass = !ans.submitted
              ? styles.cardUnanswered
              : ans.grading === 'pending'
                ? styles.cardPending
                : ans.correct
                  ? styles.cardCorrect
                  : styles.cardWrong;

            const statusLabel = !ans.submitted
              ? 'Não respondeu'
              : ans.grading === 'pending'
                ? 'Em correção'
                : ans.correct
                  ? 'Acertou'
                  : 'Errou';

            return (
              <article
                key={ans.phaseId}
                className={cx(styles.answerCard, stateClass)}
                data-pdf-keep-together
              >
                <div className={styles.answerHead}>
                  <div className={styles.answerTitleWrap}>
                    <span className={styles.phaseNum}>F{ans.phaseNumber}</span>
                    <span className={styles.kindChip} style={{ color: meta.color }}>
                      {meta.icon}
                      {meta.label}
                    </span>
                    <h3 className={styles.phaseTitle}>{ans.phaseName}</h3>
                  </div>

                  <div className={styles.answerStats}>
                    <span className={styles.statusPill}>{statusLabel}</span>
                    <span className={styles.pointsText}>
                      <strong>{ans.score}</strong> / {ans.maxScore} pts
                    </span>
                    {ans.elapsedSeconds !== null && (
                      <span className={styles.timeText}>{ans.elapsedSeconds}s</span>
                    )}
                  </div>
                </div>

                <p className={styles.questionText}>{ans.question}</p>

                <div className={styles.comparisonGrid}>
                  <div className={styles.answerBox}>
                    <span className={styles.boxLabel}>Sua resposta</span>
                    <span className={styles.boxValue}>{ans.givenAnswerText}</span>
                  </div>
                  <div className={styles.answerBox}>
                    <span className={styles.boxLabel}>Gabarito esperado</span>
                    <span className={styles.boxValue}>{ans.correctAnswerText}</span>
                  </div>
                </div>

                <div className={styles.classFoot}>
                  <span>Média da turma nesta fase: {ans.classAvgScore} pts</span>
                  <span>Taxa de acerto da turma: {ans.classAccuracyRate}%</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

interface IndividualReportViewProps {
  report: IndividualReport;
}

export function IndividualReportView({ report }: IndividualReportViewProps) {
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);
  const autoExportTriggeredRef = useRef(false);

  const p = report.participant;
  const c = report.classOverview;

  useEffect(() => {
    saveVisitedReport({
      kind: 'individual',
      token: p.accessToken,
      matchId: report.matchId,
      roomCode: report.roomCode,
      title: report.title,
      mode: report.mode,
      finishedAt: report.finishedAt,
      visitedAt: new Date().toISOString(),
      displayName: p.displayName,
      avatarIndex: p.avatarIndex,
      rank: p.rank,
      totalScore: p.totalScore,
      maxPossibleScore: p.maxPossibleScore,
      accuracyRate: p.accuracyRate,
      participantCount: c.participantCount,
    });
  }, [report, p, c]);

  const exportPdfFromHtml = useCallback(async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setToast('Renderizando seu relatório em tema claro e gerando PDF...');
  }, [isExportingPdf]);

  useEffect(() => {
    if (!isExportingPdf || !pdfContainerRef.current) return;

    let cancelled = false;
    const run = async () => {
      try {
        await exportHtmlElementToPdf(pdfContainerRef.current!, {
          filename: `meu-relatorio-${report.roomCode}-${p.displayName}.pdf`,
          footerTitle: `${p.displayName} · ${report.title} (Sala ${report.roomCode})`,
        });
        if (!cancelled) {
          setToast('Seu relatório individual em PDF foi baixado!');
        }
      } catch (err) {
        console.error('Erro ao exportar relatório individual HTML para PDF:', err);
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
  }, [isExportingPdf, report, p]);

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

  async function copyMyLink() {
    const url = `${window.location.origin}/relatorios/individual/${p.accessToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast('Seu link de acesso individual foi copiado!');
    } catch {
      setToast(url);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <Link href="/relatorios" className={styles.backLink}>
            <Icon.ArrowLeft size={16} />
            Meus relatórios
          </Link>

          <div className={styles.actions}>
            <Button variant="secondary" size="sm" onClick={() => void copyMyLink()}>
              <Icon.Copy size={15} />
              Copiar meu link permanente
            </Button>
            <Button
              size="sm"
              disabled={isExportingPdf}
              onClick={() => void exportPdfFromHtml()}
            >
              <Icon.Download size={15} />
              {isExportingPdf ? 'Gerando PDF...' : 'Baixar PDF Individual'}
            </Button>
          </div>
        </div>

        <IndividualReportBody report={report} />
      </div>

      {/* Superfície de exportação HTML -> PDF: renderiza os mesmos componentes da página em tema claro */}
      {isExportingPdf && (
        <div className={styles.pdfOffscreenWrapper} aria-hidden="true">
          <div ref={pdfContainerRef} className={cx(styles.pdfExportRoot, styles.container)}>
            <IndividualReportBody report={report} />
          </div>
        </div>
      )}

      {toast && (
        <ToastViewport>
          <Toast
            tone="success"
            title="Relatório Individual"
            message={toast}
            onClose={() => setToast(null)}
          />
        </ToastViewport>
      )}
    </div>
  );
}
