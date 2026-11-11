'use client';

import { Avatar } from '@/components/avatar/Avatar';
import { KIND_META } from '@/components/set-editor/phaseKinds';
import { cx } from '@/lib/cx';
import type { IndividualReport } from '@/lib/types';
import styles from './IndividualReportExportDocument.module.css';

function formatDateBr(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function accuracyColor(value: number): string {
  if (value >= 75) return '#16a34a';
  if (value >= 50) return '#d97706';
  return '#dc2626';
}

export interface IndividualReportExportDocumentProps {
  report: IndividualReport;
  className?: string;
}

export function IndividualReportExportDocument({
  report,
  className,
}: IndividualReportExportDocumentProps) {
  const p = report.participant;
  const c = report.classOverview;

  return (
    <article className={cx(styles.exportDocument, className)}>
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
        <div className={styles.sectionHeader} data-pdf-keep-together>
          <span className={styles.sectionTag}>Revisão</span>
          <h2 className={styles.sectionTitle}>Revisão Fase a Fase</h2>
        </div>

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
    </article>
  );
}
