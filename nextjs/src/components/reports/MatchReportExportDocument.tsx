'use client';

import { Avatar } from '@/components/avatar/Avatar';
import { KIND_META } from '@/components/set-editor/phaseKinds';
import { cx } from '@/lib/cx';
import type { MatchReport } from '@/lib/types';
import { IntegritySection } from './insights/IntegritySection';
import { QuestionQualitySection } from './insights/QuestionQualitySection';
import {
  DEFAULT_PDF_EXPORT_OPTIONS,
  type PdfExportOptions,
} from './pdf-export/pdfExportOptions';
import styles from './MatchReportExportDocument.module.css';

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
  if (value >= 85) return '#16a34a';
  if (value >= 75) return '#0bca51';
  if (value >= 60) return '#e9c112';
  if (value >= 50) return '#d97706';
  if (value >= 33) return '#d95006';
  return '#dc2626';
}

export interface MatchReportExportDocumentProps {
  report: MatchReport;
  options?: PdfExportOptions;
  className?: string;
}

export function MatchReportExportDocument({
  report,
  options = DEFAULT_PDF_EXPORT_OPTIONS,
  className,
}: MatchReportExportDocumentProps) {
  const sections = options.sections;
  let sectionNumber = 0;

  function nextSectionMeta() {
    sectionNumber += 1;
    const shouldBreakBefore = options.sectionPerPage && sectionNumber > 1;
    return {
      number: sectionNumber,
      breakProps: shouldBreakBefore ? { 'data-pdf-page-break-before': true } : {},
    };
  }

  return (
    <article
      className={cx(
        styles.exportDocument,
        options.inkSaverMode === 'eco' && styles.inkSaverEco,
        options.inkSaverMode === 'max' && styles.inkSaverMax,
        options.density === 'compact' && styles.compact,
        className,
      )}
    >
      {/* Cabeçalho do Relatório */}
      <header className={styles.hero} data-pdf-keep-together>
        <div className={styles.heroTop}>
          <div className={styles.badges}>
            <span className={styles.badgePrimary}>Relatório consolidado da Turma</span>
            <span className={styles.badgeNeutral}>Sala {report.roomCode}</span>
            <span className={styles.badgeNeutral}>{MODE_LABEL[report.mode]}</span>
          </div>

          <div className={styles.brandGroup}>
            {options.logoDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={options.logoDataUrl}
                alt="Logo institucional"
                className={styles.schoolLogo}
              />
            )}
            <span className={styles.brandMark}>Codex</span>
          </div>
        </div>

        <h1 className={styles.title}>{report.title}</h1>
        <p className={styles.subtitle}>
          Concluída em {formatDateBr(report.finishedAt)} · Duração de{' '}
          {formatDuration(report.durationSeconds)} · {report.overview.phaseCount} fases realizadas
          {options.footerText.trim() ? ` · ${options.footerText.trim()}` : ''}
        </p>
      </header>

      {/* Cards de Indicadores Gerais (KPIs) */}
      {sections.overview && (
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
              Maior: {report.overview.maxAchievedScore} pts · Mediana:{' '}
              {report.overview.medianScore} pts
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
      )}

      {/* SEÇÃO: Análise por Fase */}
      {sections.phases &&
        (() => {
          const meta = nextSectionMeta();
          return (
            <section className={styles.sectionBlock} {...meta.breakProps}>
              <div className={styles.sectionHeader} data-pdf-keep-together>
                <div className={styles.sectionTag}>Seção {meta.number}</div>
                <h2 className={styles.sectionTitle}>Análise Detalhada por Fase</h2>
              </div>

              {/* Gráfico de barras de acerto */}
              <div className={styles.phaseChartCard} data-pdf-keep-together>
                <div className={styles.chartHeader}>
                  <h3 className={styles.cardHeading}>Curva de Desempenho e Acertos</h3>
                  <span className={styles.cardMuted}>Visão comparativa entre fases</span>
                </div>

                <div className={styles.phaseBars}>
                  {report.phases.map((ph) => (
                    <div key={ph.phaseId} className={styles.phaseBarCol}>
                      <span className={styles.phaseBarPct}>{ph.accuracyRate}%</span>
                      <div className={styles.phaseBarTrack}>
                        <div
                          className={styles.phaseBarFill}
                          style={
                            {
                              height: `${Math.max(8, ph.accuracyRate)}%`,
                              '--bar-color': accuracyColor(ph.accuracyRate),
                            } as React.CSSProperties
                          }
                        />
                      </div>
                      <span className={styles.phaseBarLabel} title={ph.name}>
                        F{ph.phaseNumber}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lista de Fases e Gabaritos */}
              <div className={styles.phaseList}>
                {report.phases.map((ph) => {
                  const kindMeta = KIND_META[ph.kind];
                  return (
                    <article key={ph.phaseId} className={styles.phaseCard} data-pdf-keep-together>
                      <div className={styles.phaseHead}>
                        <div className={styles.phaseTitleGroup}>
                          <span className={styles.phaseNumBadge}>Fase {ph.phaseNumber}</span>
                          <span className={styles.phaseKindChip} style={{ color: kindMeta.color }}>
                            {kindMeta.icon}
                            {kindMeta.label}
                          </span>
                          <h4 className={styles.phaseName}>{ph.name}</h4>
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
                                  style={
                                    {
                                      width: `${opt.percentage}%`,
                                      '--opt-color': opt.isCorrect ? '#16a34a' : '#3b82f6',
                                    } as React.CSSProperties
                                  }
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
        })()}

      {/* SEÇÃO: Diagnóstico de Qualidade das Questões + Revisão IA */}
      {(sections.questionQuality || sections.aiReview) &&
        (() => {
          const meta = nextSectionMeta();
          return (
            <section className={styles.sectionBlock} {...meta.breakProps}>
              <div className={styles.sectionHeader} data-pdf-keep-together>
                <div className={styles.sectionTag}>Seção {meta.number}</div>
                <h2 className={styles.sectionTitle}>
                  Diagnóstico Psicométrico e Qualidade das Questões
                </h2>
              </div>

              <QuestionQualitySection
                report={report}
                variant="export"
                mode={options.questionQualityMode}
                showAiReview={sections.aiReview}
                inkSaverMode={options.inkSaverMode}
              />
            </section>
          );
        })()}

      {/* SEÇÃO: Classificação Geral */}
      {sections.ranking &&
        (() => {
          const meta = nextSectionMeta();
          return (
            <section className={styles.sectionBlock} {...meta.breakProps}>
              <div className={styles.sectionHeader} data-pdf-keep-together>
                <div className={styles.sectionTag}>Seção {meta.number}</div>
                <h2 className={styles.sectionTitle}>Classificação Geral dos Participantes</h2>
              </div>

              <div className={styles.tableCard} data-pdf-keep-together>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th style={{ width: 64 }}>Posição</th>
                        <th>Participante</th>
                        <th>Pontuação</th>
                        <th>Taxa de Acerto</th>
                        <th>Acertos / Fases</th>
                        <th>Tempo Total</th>
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
                            <span className={styles.scoreMuted}>
                              {' '}
                              / {p.maxPossibleScore} pts
                            </span>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          );
        })()}

      {/* SEÇÃO: Matriz Aluno x Fase */}
      {sections.matrix &&
        (() => {
          const meta = nextSectionMeta();
          return (
            <section className={styles.sectionBlock} {...meta.breakProps}>
              <div className={styles.sectionHeader} data-pdf-keep-together>
                <div className={styles.sectionTag}>Seção {meta.number}</div>
                <h2 className={styles.sectionTitle}>Matriz Cruzada: Aluno × Fase</h2>
              </div>

              <div className={styles.tableCard} data-pdf-keep-together>
                <div className={styles.matrixWrapper}>
                  <table className={styles.matrixTable}>
                    <thead>
                      <tr>
                        <th className={styles.colRank} style={{ width: 44 }}>
                          #
                        </th>
                        <th className={styles.colPlayer} style={{ width: 140 }}>
                          Participante
                        </th>
                        <th className={styles.colTotal} style={{ width: 68 }}>
                          Total
                        </th>
                        {report.phases.map((ph) => (
                          <th
                            key={ph.phaseId}
                            className={styles.colPhase}
                            title={`Fase ${ph.phaseNumber}: ${ph.name}`}
                          >
                            F{ph.phaseNumber}
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
                            <td className={styles.matrixPlayerName} title={p.displayName}>
                              {p.displayName}
                            </td>
                            <td className={styles.scoreStrong}>{p.totalScore}</td>
                            {report.phases.map((ph) => {
                              const ans = ansByPhase.get(ph.phaseId);
                              if (!ans || !ans.submitted) {
                                return (
                                  <td
                                    key={ph.phaseId}
                                    className={cx(styles.matrixCell, styles.cellUnanswered)}
                                    title="Em branco"
                                  >
                                    <span className={styles.cellMain}>—</span>
                                  </td>
                                );
                              }
                              if (ans.grading === 'pending') {
                                return (
                                  <td
                                    key={ph.phaseId}
                                    className={cx(styles.matrixCell, styles.cellPending)}
                                    title={`Pendente: ${ans.givenAnswerText}`}
                                  >
                                    <span className={styles.cellMain}>⏳</span>
                                  </td>
                                );
                              }
                              return (
                                <td
                                  key={ph.phaseId}
                                  className={cx(
                                    styles.matrixCell,
                                    ans.correct ? styles.cellCorrect : styles.cellWrong,
                                  )}
                                  title={`${ans.correct ? 'Acertou' : 'Errou'} · ${ans.score} pts (${ans.elapsedSeconds}s) · Resposta: ${ans.givenAnswerText}`}
                                >
                                  <span className={styles.cellMain}>
                                    {ans.correct ? '✓' : '✗'} {ans.score}
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
        })()}

      {/* SEÇÃO: Integridade Acadêmica (Chute e/ou Cola — Confidencial Docente) */}
      {(sections.guessing || sections.collusion) &&
        (() => {
          const meta = nextSectionMeta();
          return (
            <section className={styles.sectionBlock} {...meta.breakProps}>
              <div className={styles.sectionHeader} data-pdf-keep-together>
                <div className={styles.sectionTag}>Seção {meta.number}</div>
                <h2 className={styles.sectionTitle}>
                  Análise de Integridade e Padrões de Resposta (Confidencial Docente)
                </h2>
              </div>

              <IntegritySection
                report={report}
                variant="export"
                inkSaverMode={options.inkSaverMode}
                showGuessing={sections.guessing}
                showCollusion={sections.collusion}
              />
            </section>
          );
        })()}
    </article>
  );
}
