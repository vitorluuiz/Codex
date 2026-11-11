'use client';

import { Avatar } from '@/components/avatar/Avatar';
import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { MatchReport } from '@/lib/types';
import { SEVERITY_META } from './insightLabels';
import styles from './IntegritySection.module.css';

export interface IntegritySectionProps {
  report: MatchReport;
  variant?: 'web' | 'export';
  inkSaverMode?: 'original' | 'eco' | 'max';
  showGuessing?: boolean;
  showCollusion?: boolean;
}

export function IntegritySection({
  report,
  variant = 'web',
  inkSaverMode = 'original',
  showGuessing = true,
  showCollusion = true,
}: IntegritySectionProps) {
  const guessingBlock = report.insights?.guessing;
  const guessingList = (guessingBlock?.participants ?? []).filter((g) => g.events.length > 0);
  const collusionBlock = report.insights?.collusion;
  const collusionPairs = collusionBlock?.pairs ?? [];
  const collusionGroups = collusionBlock?.groups ?? [];

  return (
    <div
      className={cx(
        styles.root,
        variant === 'export' && styles.exportVariant,
        inkSaverMode === 'eco' && styles.inkSaverEco,
        inkSaverMode === 'max' && styles.inkSaverMax,
      )}
    >
      {/* Aviso Pedagógico Obrigatório */}
      <div className={styles.disclaimerBanner} data-pdf-keep-together>
        <div className={styles.disclaimerIcon}>
          <Icon.Alert size={20} />
        </div>
        <div className={styles.disclaimerBody}>
          <h3 className={styles.disclaimerTitle}>
            Aviso Pedagógico Importante — Indícios Estatísticos, Não Provas
          </h3>
          <p className={styles.disclaimerText}>
            Os padrões abaixo são calculados automaticamente a partir do tempo de leitura,
            intervalos em milissegundos entre envios e raridade das respostas incorretas. Eles
            servem exclusivamente como subsídio para mediação pedagógica do professor e nunca devem
            ser utilizados isoladamente como prova disciplinar. Esta seção jamais aparece nos
            relatórios individuais dos alunos.
          </p>
        </div>
      </div>

      {/* Subseção 1: Indícios de Chute */}
      {showGuessing && (
        <div className={styles.card} data-pdf-keep-together>
          <div className={styles.cardHeader}>
            <div>
              <h3 className={styles.cardTitle}>
                Indícios de Respostas por Chute ({guessingList.length})
              </h3>
              <p className={styles.cardSubtitle}>
                Erros impulsivos (&le; 2s ou &lt; 50% do tempo mínimo de leitura) ou marcados no
                estouro final do cronômetro (&ge; 92% do tempo limite).
              </p>
            </div>
          </div>

          {guessingBlock && !guessingBlock.eligible && guessingBlock.reason ? (
            <div className={styles.emptyState}>{guessingBlock.reason}</div>
          ) : guessingList.length === 0 ? (
            <div className={styles.emptyState}>
              Nenhum padrão relevante de chute impulsivo ou de estouro de tempo foi identificado
              nesta partida.
            </div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Participante</th>
                    <th>Severidade</th>
                    <th>Taxa de Chute</th>
                    <th>Erros Impulsivos</th>
                    <th>Erros no Estouro</th>
                    <th>Fases e Evidências</th>
                  </tr>
                </thead>
                <tbody>
                  {guessingList.map((item) => {
                    const sev = SEVERITY_META[item.severity];
                    return (
                      <tr key={item.participantId} data-pdf-keep-together>
                        <td>
                          <div className={styles.playerCell}>
                            <Avatar
                              index={item.avatarIndex}
                              size="sm"
                              name={item.displayName}
                            />
                            <span>{item.displayName}</span>
                          </div>
                        </td>
                        <td>
                          <span
                            className={styles.severityPill}
                            style={{
                              color: sev.colorHex,
                              background: sev.bgHex,
                            }}
                          >
                            {sev.shortLabel}
                          </span>
                        </td>
                        <td>
                          <strong>{item.guessRate}%</strong> ({item.events.length} de{' '}
                          {item.gradedCount} resp.)
                        </td>
                        <td>{item.fastWrongCount}</td>
                        <td>{item.lateWrongCount}</td>
                        <td>
                          <div className={styles.evidenceChips}>
                            {item.events.map((ev) => (
                              <span
                                key={`${ev.phaseId}-${ev.type}`}
                                className={cx(
                                  styles.evidenceChip,
                                  ev.type === 'fast_wrong'
                                    ? styles.evidenceChipFast
                                    : styles.evidenceChipLate,
                                )}
                                title={`Fase ${ev.phaseNumber} (${ev.phaseName}): respondeu "${ev.givenAnswerText}" em ${ev.elapsedSeconds}s (limite ${ev.timeSeconds}s)`}
                              >
                                <strong>F{ev.phaseNumber}</strong>:{' '}
                                {ev.type === 'fast_wrong' ? '⚡ Rápida' : '⏱ Fim do tempo'} (
                                {ev.elapsedSeconds}s)
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Subseção 2: Indícios de Cola / Repasse de Respostas */}
      {showCollusion && (
        <div className={styles.card} data-pdf-keep-together>
          <div className={styles.cardHeader}>
            <div>
              <h3 className={styles.cardTitle}>
                Indícios de Repasse de Respostas entre Pares ({collusionPairs.length})
              </h3>
              <p className={styles.cardSubtitle}>
                Combina coincidência de erros raros na turma com envios idênticos em sequência
                (&Delta;t &le; 3,0s).
              </p>
            </div>
          </div>

          {collusionGroups.length > 0 && (
            <div className={styles.groupsRow}>
              <span className={styles.groupsLabel}>
                Agrupamentos (Clusters Conectados Detectados):
              </span>
              <div className={styles.groupChips}>
                {collusionGroups.map((grp, idx) => {
                  const sev = SEVERITY_META[grp.maxSeverity];
                  return (
                    <div key={`grp-${idx}`} className={styles.groupChip}>
                      <span>{grp.displayNames.join(' ↔ ')}</span>
                      <span
                        className={styles.severityPill}
                        style={{
                          color: sev.colorHex,
                          background: sev.bgHex,
                        }}
                      >
                        {sev.shortLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {collusionBlock && !collusionBlock.eligible && collusionBlock.reason ? (
            <div className={styles.emptyState}>{collusionBlock.reason}</div>
          ) : collusionPairs.length === 0 ? (
            <div className={styles.emptyState}>
              Nenhum par de participantes apresentou coincidência estatística atípica de erros raros
              ou envios simultâneos.
            </div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Par de Participantes</th>
                    <th>Severidade</th>
                    <th>Score</th>
                    <th>Concordância</th>
                    <th>Erros Idênticos</th>
                    <th>Envios &le; 3s</th>
                    <th>Fases Coincidentes</th>
                  </tr>
                </thead>
                <tbody>
                  {collusionPairs.map((pair) => {
                    const sev = SEVERITY_META[pair.severity];
                    const followerName =
                      pair.dominantFollowerId === pair.participantAId
                        ? pair.participantAName
                        : pair.dominantFollowerId === pair.participantBId
                          ? pair.participantBName
                          : null;
                    return (
                      <tr
                        key={`${pair.participantAId}-${pair.participantBId}`}
                        data-pdf-keep-together
                      >
                        <td>
                          <div className={styles.pairCell}>
                            <span className={styles.pairNames}>
                              {pair.participantAName} ↔ {pair.participantBName}
                            </span>
                            {followerName && (
                              <span className={styles.followerHint}>
                                ↳ Seguidor frequente: {followerName}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span
                            className={styles.severityPill}
                            style={{
                              color: sev.colorHex,
                              background: sev.bgHex,
                            }}
                          >
                            {sev.shortLabel}
                          </span>
                        </td>
                        <td>
                          <strong>{pair.score}</strong>/100
                        </td>
                        <td>
                          {pair.agreementRate}% ({pair.identicalAnswers}/{pair.commonPhases})
                        </td>
                        <td>
                          <strong>{pair.sharedWrongCount}</strong> (peso raro:{' '}
                          {pair.weightedRareSharedWrong.toFixed(2)})
                        </td>
                        <td>{pair.sequentialCount}</td>
                        <td>
                          <div className={styles.evidenceChips}>
                            {pair.evidence.map((ev, idx) => (
                              <span
                                key={`${ev.phaseId}-${idx}`}
                                className={cx(
                                  styles.evidenceChip,
                                  ev.type === 'shared_wrong' && styles.evidenceChipFast,
                                )}
                                title={`Fase ${ev.phaseNumber} (${ev.phaseName}): resposta "${ev.answerText}"`}
                              >
                                <strong>F{ev.phaseNumber}</strong>:{' '}
                                {ev.type === 'shared_wrong' ? '✗ Erro raro' : '⏱ Sequencial'}
                                {ev.deltaMs !== null
                                  ? ` · Δ${(ev.deltaMs / 1000).toFixed(1)}s`
                                  : ''}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
