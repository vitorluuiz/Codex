'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { formatAiErrorMessage } from '@/components/set-editor/ai/aiErrors';
import { KIND_META } from '@/components/set-editor/phaseKinds';
import { runReportAiReviewAction } from '@/lib/actions/reports';
import { cx } from '@/lib/cx';
import type { AiPhaseReview, MatchReport, QuestionInsight, ReportAiReview } from '@/lib/types';
import {
  AI_VERDICT_META,
  DIFFICULTY_META,
  QUESTION_FLAG_META,
  SEVERITY_META,
} from './insightLabels';
import styles from './QuestionQualitySection.module.css';

export interface QuestionQualitySectionProps {
  report: MatchReport;
  variant?: 'web' | 'export';
  mode?: 'full' | 'highlights';
  showAiReview?: boolean;
  inkSaverMode?: 'original' | 'eco' | 'max';
  isLeader?: boolean;
  onAiReviewUpdated?: (review: ReportAiReview) => void;
}

export function QuestionQualitySection({
  report,
  variant = 'web',
  mode = 'full',
  showAiReview = true,
  inkSaverMode = 'original',
  isLeader = false,
  onAiReviewUpdated,
}: QuestionQualitySectionProps) {
  const router = useRouter();
  const [isRunningAi, setIsRunningAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const questions: QuestionInsight[] = useMemo(
    () => report.insights?.questions ?? [],
    [report.insights?.questions],
  );
  const aiReview = report.aiReview ?? null;

  const aiByPhaseId = useMemo(() => {
    const map = new Map<string, AiPhaseReview>();
    if (aiReview?.phases) {
      for (const item of aiReview.phases) {
        map.set(item.phaseId, item);
      }
    }
    return map;
  }, [aiReview]);

  const phaseById = useMemo(
    () => new Map(report.phases.map((p) => [p.phaseId, p])),
    [report.phases],
  );

  // Calcula tempo médio e percentual de uso considerando não envios como 100% do cronômetro
  const effectiveTimingByPhaseId = useMemo(() => {
    const map = new Map<string, { avgSec: number; limitSec: number; timeUsagePct: number }>();
    const participantCount = report.participants.length;

    for (const ph of report.phases) {
      const limitSec = Math.max(1, ph.timeSeconds || 30);
      if (participantCount > 0) {
        let totalSec = 0;
        for (const p of report.participants) {
          const ans = p.answers.find((a) => a.phaseId === ph.phaseId);
          if (ans && ans.submitted && ans.elapsedSeconds !== null) {
            totalSec += Math.min(limitSec, Math.max(0, ans.elapsedSeconds));
          } else {
            totalSec += limitSec;
          }
        }
        const avgSec = Math.round((totalSec / participantCount) * 10) / 10;
        const timeUsagePct = Math.max(0, Math.min(100, Math.round((avgSec / limitSec) * 100)));
        map.set(ph.phaseId, { avgSec, limitSec, timeUsagePct });
      } else {
        const avgSec = ph.avgElapsedSeconds ?? 0;
        const timeUsagePct = Math.max(0, Math.min(100, Math.round((avgSec / limitSec) * 100)));
        map.set(ph.phaseId, { avgSec, limitSec, timeUsagePct });
      }
    }
    return map;
  }, [report.phases, report.participants]);

  const easyQuestions = useMemo(
    () =>
      questions.filter(
        (q) => q.difficulty === 'very_easy' || q.difficulty === 'easy',
      ),
    [questions],
  );

  const hardQuestions = useMemo(
    () =>
      questions.filter(
        (q) => q.difficulty === 'very_hard' || q.difficulty === 'hard',
      ),
    [questions],
  );

  const flaggedQuestions = useMemo(() => {
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
      const hasAiAlert = ai && ai.verdict !== 'ok';
      return hasHeuristicAlert || Boolean(hasAiAlert);
    });
  }, [questions, aiByPhaseId]);

  const displayedQuestions = mode === 'highlights' ? flaggedQuestions : questions;

  async function handleRunAiReview() {
    if (isRunningAi) return;
    setIsRunningAi(true);
    setAiError(null);
    try {
      const res = await runReportAiReviewAction(report.matchId);
      if (!res.ok) {
        setAiError(formatAiErrorMessage(res.code, res.message));
        return;
      }
      onAiReviewUpdated?.(res.data.aiReview);
      router.refresh();
    } catch {
      setAiError('Não foi possível executar a revisão por IA no momento.');
    } finally {
      setIsRunningAi(false);
    }
  }

  return (
    <div
      className={cx(
        styles.root,
        variant === 'export' && styles.exportVariant,
        inkSaverMode === 'eco' && styles.inkSaverEco,
        inkSaverMode === 'max' && styles.inkSaverMax,
      )}
    >
      {/* Cards de destaques pedagógicos */}
      <div className={styles.highlightsGrid} data-pdf-keep-together>
        <div className={styles.highlightCard}>
          <span className={styles.highlightLabel}>Mais Fáceis</span>
          <span className={styles.highlightValue}>{easyQuestions.length}</span>
          <span className={styles.highlightSub}>
            {easyQuestions.length > 0
              ? easyQuestions.map((q) => `F${q.phaseNumber}`).join(', ')
              : 'Nenhuma questão com acerto ≥ 75%'}
          </span>
        </div>

        <div className={styles.highlightCard}>
          <span className={styles.highlightLabel}>Mais Difíceis</span>
          <span className={styles.highlightValue}>{hardQuestions.length}</span>
          <span className={styles.highlightSub}>
            {hardQuestions.length > 0
              ? hardQuestions.map((q) => `F${q.phaseNumber}`).join(', ')
              : 'Nenhuma questão com acerto ≤ 40%'}
          </span>
        </div>

        <div className={styles.highlightCard}>
          <span className={styles.highlightLabel}>Com Alertas de Qualidade</span>
          <span className={styles.highlightValue}>{flaggedQuestions.length}</span>
          <span className={styles.highlightSub}>
            {flaggedQuestions.length > 0
              ? `Atenção em ${flaggedQuestions.map((q) => `F${q.phaseNumber}`).join(', ')}`
              : 'Nenhum alerta crítico detectado'}
          </span>
        </div>

        <div className={styles.highlightCard}>
          <span className={styles.highlightLabel}>Revisão Pedagógica IA</span>
          <span className={styles.highlightValue}>
            {aiReview ? 'Concluída' : 'Não executada'}
          </span>
          <span className={styles.highlightSub}>
            {aiReview
              ? `${aiReview.phases.filter((p) => p.verdict === 'ok').length}/${aiReview.phases.length} validadas sem ressalvas`
              : 'Análise ortográfica, conceitual e de gabarito'}
          </span>
        </div>
      </div>

      {/* Painel de ação da Revisão por IA (somente no relatório web) */}
      {variant === 'web' && showAiReview && (
        <div className={styles.aiBanner}>
          <div className={styles.aiBannerInfo}>
            <div className={styles.aiBannerTitleRow}>
              <span className={styles.aiBannerBadge}>
                <Icon.Sparkle size={12} /> IA Pedagógica
              </span>
              <h3 className={styles.aiBannerTitle}>
                {aiReview
                  ? 'Revisão linguística, conceitual e de gabarito concluída'
                  : 'Auditar enunciados, alternativas e gabarito com Inteligência Artificial'}
              </h3>
            </div>
            <p className={styles.aiBannerDesc}>
              {aiReview
                ? `Analisado pelo modelo ${aiReview.model} em ${new Date(aiReview.generatedAt).toLocaleString('pt-BR')}. Os apontamentos aparecem detalhados abaixo em cada fase.`
                : 'Verifica erros de ortografia/gramática, imprecisões conceituais, ambiguidade no enunciado e se o gabarito cadastrado realmente responde à pergunta.'}
            </p>
            {aiError && <div className={styles.aiBannerError}>{aiError}</div>}
          </div>

          <div className={styles.aiBannerActions}>
            {isLeader ? (
              <Button
                size="sm"
                variant={aiReview ? 'secondary' : 'primary'}
                disabled={isRunningAi}
                onClick={() => void handleRunAiReview()}
              >
                <Icon.Sparkle size={15} />
                {isRunningAi
                  ? 'Analisando questões...'
                  : aiReview
                    ? 'Reexecutar revisão com IA (1 crédito)'
                    : 'Revisar questões com IA (1 crédito)'}
              </Button>
            ) : (
              !aiReview && (
                <span className={styles.chartHint}>
                  Apenas o líder da partida pode solicitar a revisão por IA.
                </span>
              )
            )}
          </div>
        </div>
      )}

      {/* Gráfico de Dispersão: Taxa de Acerto vs Índice de Discriminação (D) */}
      {questions.length > 0 && mode === 'full' && (
        <div className={styles.chartCard} data-pdf-keep-together>
          <div className={styles.chartHeader}>
            <h3 className={styles.chartTitle}>
              Mapa Psicométrico: Taxa de Acerto × Índice de Discriminação (D)
            </h3>
            <span className={styles.chartHint}>
              D &gt; 0.30 diferencia bem o grupo superior; D &lt; 0 sugere gabarito invertido ou
              enunciado ambíguo
            </span>
          </div>

          <div className={styles.scatterPlot}>
            <div className={styles.scatterHardZone} title="Zona difícil (acerto ≤ 35%)" />
            <div className={styles.scatterEasyZone} title="Zona fácil (acerto ≥ 78%)" />
            <div className={styles.scatterZeroLine} />

            {/* Placeholders explicativos de cada quadrante do mapa psicométrico */}
            <div className={styles.scatterQuadrants} aria-hidden="true">
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Desafiadora · Seletiva</span>
                <span className={styles.quadrantSub}>Difícil, mas destaca os melhores (D &gt; 0)</span>
              </div>
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Zona Ideal · Calibrada</span>
                <span className={styles.quadrantSub}>Dificuldade equilibrada e boa discriminação</span>
              </div>
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Fixação · Nivelamento</span>
                <span className={styles.quadrantSub}>Fácil com domínio consistente da turma</span>
              </div>
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Crítica · Rever Gabarito</span>
                <span className={styles.quadrantSub}>Difícil e melhores alunos erraram mais (D &lt; 0)</span>
              </div>
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Possível Ambiguidade</span>
                <span className={styles.quadrantSub}>Enunciado ou distrator confunde o topo (D &lt; 0)</span>
              </div>
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Pegadinha · Desatenção</span>
                <span className={styles.quadrantSub}>Fácil, porém com tropeço no grupo superior</span>
              </div>
            </div>

            <span className={styles.scatterYLabelTop}>+1.0</span>
            <span className={styles.scatterYLabelMid}>D = 0</span>
            <span className={styles.scatterYLabelBot}>-1.0</span>

            <span className={styles.scatterXLabelLeft}>0% acerto (Difícil)</span>
            <span className={styles.scatterXLabelCenter}>50% acerto</span>
            <span className={styles.scatterXLabelRight}>100% acerto (Fácil)</span>

            {questions.map((q) => {
              const phase = phaseById.get(q.phaseId);
              const d = q.discriminationIndex ?? 0;
              const leftPct = Math.max(4, Math.min(96, q.accuracyRate));
              const topPct = Math.max(10, Math.min(90, 50 - d * 42));
              const diffMeta = DIFFICULTY_META[q.difficulty];
              const dotColor =
                d < 0
                  ? '#dc2626'
                  : q.flags.includes('suspect_answer_key')
                    ? '#d97706'
                    : diffMeta.colorHex;
              return (
                <div
                  key={q.phaseId}
                  className={styles.scatterDot}
                  style={
                    {
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      background: dotColor,
                      '--dot-color': dotColor,
                    } as React.CSSProperties
                  }
                  title={`Fase ${q.phaseNumber} (${phase?.name ?? ''}): ${q.accuracyRate}% acerto · D = ${q.discriminationIndex ?? 'N/A'}`}
                >
                  F{q.phaseNumber}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mapa de Ritmo & Tempo: Taxa de Acerto vs Tempo de Resposta */}
      {questions.length > 0 && mode === 'full' && (
        <div className={styles.chartCard} data-pdf-keep-together>
          <div className={styles.chartHeader}>
            <h3 className={styles.chartTitle}>
              Mapa de Ritmo &amp; Tempo: Taxa de Acerto × Tempo de Resposta
            </h3>
            <span className={styles.chartHint}>
              Relaciona a dificuldade da fase com o cronômetro consumido (não envios contam como 100% do tempo)
            </span>
          </div>

          <div className={styles.scatterPlot}>
            <div className={styles.scatterHardZone} title="Zona difícil (acerto ≤ 35%)" />
            <div className={styles.scatterEasyZone} title="Zona fácil (acerto ≥ 78%)" />
            <div className={styles.scatterZeroLine} />

            {/* Placeholders explicativos de cada quadrante do mapa de tempo vs acerto */}
            <div className={styles.scatterQuadrants} aria-hidden="true">
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Tempo Curto · Sobrecarga</span>
                <span className={styles.quadrantSub}>Difícil e consome quase todo o cronômetro</span>
              </div>
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Reflexão Densa · Trabalhosa</span>
                <span className={styles.quadrantSub}>Exige leitura/cálculo com acerto equilibrado</span>
              </div>
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Leitura Longa · Fácil</span>
                <span className={styles.quadrantSub}>Turma acerta, mas gasta muito tempo lendo</span>
              </div>
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Chute Impulsivo · Pegadinha</span>
                <span className={styles.quadrantSub}>Respondem rápido demais e erram muito</span>
              </div>
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Ritmo Ágil · Fluida</span>
                <span className={styles.quadrantSub}>Resolução rápida com dificuldade calibrada</span>
              </div>
              <div className={styles.scatterQuadrant}>
                <span className={styles.quadrantTitle}>Domínio Imediato · Folgada</span>
                <span className={styles.quadrantSub}>Acerto alto e rápido (tempo de sobra)</span>
              </div>
            </div>

            <span className={styles.scatterYLabelTop}>100%</span>
            <span className={styles.scatterYLabelMid}>50%</span>
            <span className={styles.scatterYLabelBot}>0s</span>

            <span className={styles.scatterXLabelLeft}>0% acerto (Difícil)</span>
            <span className={styles.scatterXLabelCenter}>50% acerto</span>
            <span className={styles.scatterXLabelRight}>100% acerto (Fácil)</span>

            {questions.map((q) => {
              const phase = phaseById.get(q.phaseId);
              const timing = effectiveTimingByPhaseId.get(q.phaseId);
              const avgSec = timing?.avgSec ?? phase?.avgElapsedSeconds ?? 0;
              const limitSec = timing?.limitSec ?? phase?.timeSeconds ?? 30;
              const timeUsagePct =
                timing?.timeUsagePct ?? Math.max(0, Math.min(100, Math.round(q.avgTimeUsageRate)));
              const leftPct = Math.max(4, Math.min(96, q.accuracyRate));
              // 100% do tempo no topo (10%), 0% na base (90%)
              const topPct = Math.max(10, Math.min(90, 90 - (timeUsagePct / 100) * 80));
              const diffMeta = DIFFICULTY_META[q.difficulty];
              const dotColor =
                q.flags.includes('time_too_short') || timeUsagePct >= 85
                  ? '#dc2626'
                  : q.flags.includes('reading_exceeds_time')
                    ? '#d97706'
                    : q.flags.includes('time_too_long')
                      ? '#0284c7'
                      : diffMeta.colorHex;

              return (
                <div
                  key={q.phaseId}
                  className={styles.scatterDot}
                  style={
                    {
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      background: dotColor,
                      '--dot-color': dotColor,
                    } as React.CSSProperties
                  }
                  title={`Fase ${q.phaseNumber} (${phase?.name ?? ''}): ${q.accuracyRate}% acerto · Tempo médio: ${avgSec}s / ${limitSec}s (${timeUsagePct}% do limite · não envios = 100%)`}
                >
                  F{q.phaseNumber} · {avgSec}s
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lista detalhada de diagnóstico por questão */}
      <div className={styles.phaseList}>
        {displayedQuestions.map((q) => {
          const phase = phaseById.get(q.phaseId);
          const timing = effectiveTimingByPhaseId.get(q.phaseId);
          const kindMeta = phase ? KIND_META[phase.kind] : null;
          const diffMeta = DIFFICULTY_META[q.difficulty];
          const ai = showAiReview ? aiByPhaseId.get(q.phaseId) : undefined;
          const timeLimitSeconds = timing?.limitSec ?? phase?.timeSeconds ?? 30;
          const avgElapsedSeconds = timing?.avgSec ?? phase?.avgElapsedSeconds ?? 0;
          const optionCount = phase?.optionDistribution.length ?? 0;
          const timeUsagePct =
            timing?.timeUsagePct ?? Math.min(100, Math.round(q.avgTimeUsageRate));
          const readingRatio =
            timeLimitSeconds > 0 ? (q.estimatedReadingSeconds / timeLimitSeconds) * 100 : 0;
          const readingPct = Math.min(100, Math.round(readingRatio));

          return (
            <article key={q.phaseId} className={styles.phaseCard} data-pdf-keep-together>
              <div className={styles.phaseHeader}>
                <div className={styles.phaseTitleGroup}>
                  <span className={styles.phaseNumBadge}>Fase {q.phaseNumber}</span>
                  {kindMeta && (
                    <span className={styles.phaseKindChip} style={{ color: kindMeta.color }}>
                      {kindMeta.icon}
                      {kindMeta.label}
                    </span>
                  )}
                  <h4 className={styles.phaseName}>
                    {phase?.name ?? `Fase ${q.phaseNumber}`}
                  </h4>
                </div>

                <div className={styles.badgeRow}>
                  <span
                    className={styles.pill}
                    style={{
                      color: diffMeta.colorHex,
                      background: diffMeta.bgHex,
                    }}
                  >
                    {diffMeta.label} ({q.accuracyRate}%)
                  </span>

                  {q.flags.map((flag) => {
                    const meta = QUESTION_FLAG_META[flag];
                    if (!meta) return null;
                    return (
                      <span
                        key={flag}
                        className={styles.pill}
                        style={{
                          color: meta.colorHex,
                          background: meta.bgHex,
                        }}
                        title={meta.description}
                      >
                        {meta.shortLabel}
                      </span>
                    );
                  })}

                  {ai && (
                    <span
                      className={styles.pill}
                      style={{
                        color: AI_VERDICT_META[ai.verdict].colorHex,
                        background: AI_VERDICT_META[ai.verdict].bgHex,
                      }}
                    >
                      {AI_VERDICT_META[ai.verdict].shortLabel}
                    </span>
                  )}
                </div>
              </div>

              <div className={styles.metricsGrid}>
                <div className={styles.metricBox}>
                  <span className={styles.metricLabel}>Discriminação (D)</span>
                  <span className={styles.metricValue}>
                    {q.discriminationIndex !== null ? q.discriminationIndex.toFixed(2) : 'N/A'}
                  </span>
                  <span className={styles.metricSub}>
                    {q.discriminationIndex === null
                      ? 'Amostra < 4 alunos'
                      : q.discriminationIndex < 0
                        ? 'Alerta: alunos melhores erraram mais'
                        : q.discriminationIndex >= 0.3
                          ? 'Ótima diferenciação pedagógica'
                          : 'Diferenciação moderada/baixa'}
                  </span>
                </div>

                <div className={styles.metricBox}>
                  <span className={styles.metricLabel}>Uso do Tempo Limite</span>
                  <span className={styles.metricValue}>
                    Méd. {avgElapsedSeconds}s / {timeLimitSeconds}s ({timeUsagePct}%)
                  </span>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={
                        {
                          width: `${timeUsagePct}%`,
                          '--prog-color':
                            timeUsagePct >= 85
                              ? '#dc2626'
                              : timeUsagePct <= 25
                                ? '#2563eb'
                                : '#16a34a',
                        } as React.CSSProperties
                      }
                    />
                  </div>
                  <span className={styles.metricSub}>
                    Estouro final: {q.lateSubmissionRate}% · Em branco: {q.unansweredRate}% (100% do tempo)
                  </span>
                </div>

                <div className={styles.metricBox}>
                  <span className={styles.metricLabel}>Carga de Leitura</span>
                  <span className={styles.metricValue}>
                    ~{q.estimatedReadingSeconds}s leitura ({readingPct}% do timer)
                  </span>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={
                        {
                          width: `${readingPct}%`,
                          '--prog-color': readingPct > 50 ? '#d97706' : '#0284c7',
                        } as React.CSSProperties
                      }
                    />
                  </div>
                  <span className={styles.metricSub}>
                    Enunciado: {q.questionCharCount} carac. ({q.questionWordCount} pal.)
                  </span>
                </div>

                <div className={styles.metricBox}>
                  <span className={styles.metricLabel}>Tamanho das Alternativas</span>
                  <span className={styles.metricValue}>
                    {q.maxOptionCharCount !== null
                      ? `Máx. ${q.maxOptionCharCount} carac.`
                      : 'Discursiva'}
                  </span>
                  <span className={styles.metricSub}>
                    {q.avgOptionCharCount !== null
                      ? `${optionCount} opções · Média ${q.avgOptionCharCount} carac.`
                      : `Gabarito: ${phase?.correctAnswerText ?? '—'}`}
                  </span>
                </div>
              </div>

              {q.flags.includes('suspect_answer_key') && q.topDistractor && (
                <div className={styles.distractorAlert}>
                  <strong>Possível gabarito invertido ou distrator ambíguo:</strong> A alternativa
                  incorreta <strong>&ldquo;{q.topDistractor.label}&rdquo;</strong> foi escolhida por{' '}
                  <strong>{q.topDistractor.percentage}%</strong> da turma (e por{' '}
                  {q.topDistractor.upperGroupPercentage}% do grupo superior), superando a taxa de
                  acerto do gabarito oficial ({q.accuracyRate}%).
                </div>
              )}

              {ai && (
                <div className={styles.aiReviewCard}>
                  <div className={styles.aiReviewTop}>
                    <span className={styles.aiReviewHeading}>
                      <Icon.Sparkle size={13} /> Parecer Pedagógico da IA
                    </span>
                    <span
                      className={styles.pill}
                      style={{
                        color: AI_VERDICT_META[ai.verdict].colorHex,
                        background: AI_VERDICT_META[ai.verdict].bgHex,
                      }}
                    >
                      Gabarito:{' '}
                      {ai.answerKey === 'ok'
                        ? 'Válido'
                        : ai.answerKey === 'suspect'
                          ? 'Suspeito'
                          : ai.answerKey === 'wrong'
                            ? 'Incorreto'
                            : 'N/A'}
                    </span>
                  </div>

                  {ai.answerKey !== 'ok' && ai.answerKeyNote && (
                    <div className={styles.distractorAlert}>
                      <strong>Auditoria de Gabarito:</strong> {ai.answerKeyNote}
                    </div>
                  )}

                  {(ai.spelling.length > 0 ||
                    ai.conceptual.length > 0 ||
                    ai.clarity.length > 0) && (
                    <div className={styles.aiIssueList}>
                      {ai.spelling.map((issue, idx) => (
                        <div key={`sp-${idx}`} className={styles.aiIssueItem}>
                          <span
                            className={styles.aiIssueTag}
                            style={{ background: '#fef3c7', color: '#b45309' }}
                          >
                            Ortografia
                          </span>
                          Trecho: <strong>&ldquo;{issue.excerpt}&rdquo;</strong> → Sugestão:{' '}
                          <strong>&ldquo;{issue.suggestion}&rdquo;</strong>
                        </div>
                      ))}

                      {ai.conceptual.map((issue, idx) => {
                        const sev = SEVERITY_META[issue.severity];
                        return (
                          <div key={`co-${idx}`} className={styles.aiIssueItem}>
                            <span
                              className={styles.aiIssueTag}
                              style={{ background: sev.bgHex, color: sev.colorHex }}
                            >
                              Conceitual ({sev.shortLabel})
                            </span>
                            {issue.description}
                          </div>
                        );
                      })}

                      {ai.clarity.map((issue, idx) => (
                        <div key={`cl-${idx}`} className={styles.aiIssueItem}>
                          <span
                            className={styles.aiIssueTag}
                            style={{ background: '#eff6ff', color: '#1d4ed8' }}
                          >
                            Clareza
                          </span>
                          {issue.description}
                          {issue.suggestion ? ` — Sugestão: ${issue.suggestion}` : ''}
                        </div>
                      ))}
                    </div>
                  )}

                  {ai.spelling.length === 0 &&
                    ai.conceptual.length === 0 &&
                    ai.clarity.length === 0 &&
                    ai.answerKey === 'ok' && (
                      <p className={styles.aiComment}>
                        Nenhuma inconsistência ortográfica, conceitual ou de gabarito encontrada
                        pela IA nesta fase.
                      </p>
                    )}

                  {ai.suggestedRewrite && (
                    <div className={styles.aiRewriteBox}>
                      <strong>Sugestão de reescrita:</strong> {ai.suggestedRewrite}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
