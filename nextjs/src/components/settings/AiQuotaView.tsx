'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { Button, Card, Meter, Tag, Toast, ToastViewport } from '@/components/ds';
import { StateMessage } from '@/components/feedback/StateMessage';
import { Icon } from '@/components/icons/Icons';
import { getAiUsageAction } from '@/lib/actions/ai';
import { cx } from '@/lib/cx';
import type { AiUsage, PlanId, User } from '@/lib/types';
import styles from './AiQuotaView.module.css';

const PLAN_LABEL: Record<PlanId, string> = {
  free: 'Grátis',
  intermediate: 'Intermediário',
  pro: 'Pro',
};

interface PlanQuotaTier {
  id: PlanId;
  name: string;
  description: string;
  credits: number;
  dailySuggestions: number;
}

const PLAN_QUOTA_TIERS: PlanQuotaTier[] = [
  {
    id: 'free',
    name: 'Grátis',
    description: 'Para experimentar os recursos de IA',
    credits: 20,
    dailySuggestions: 30,
  },
  {
    id: 'intermediate',
    name: 'Intermediário',
    description: 'Para turmas ativas ao longo do mês',
    credits: 150,
    dailySuggestions: 200,
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Para seleções e uso intensivo de IA',
    credits: 600,
    dailySuggestions: 1000,
  },
];

const OPERATION_COSTS = [
  {
    id: 'generate-phase',
    title: 'Gerar desafio com IA',
    description: 'Quiz, código, dissertativa ou completar frase',
    costLabel: '1 crédito',
    free: false,
    icon: Icon.Sparkle,
  },
  {
    id: 'variations-small',
    title: 'Gerar variações (1 a 3)',
    description: 'Adapta enunciado, valores, contexto ou distratores',
    costLabel: '1 crédito',
    free: false,
    icon: Icon.Shuffle,
  },
  {
    id: 'variations-large',
    title: 'Gerar variações (4 ou 5)',
    description: 'Lote estendido de variações numa única solicitação',
    costLabel: '2 créditos',
    free: false,
    icon: Icon.PhaseTypes,
  },
  {
    id: 'report-review',
    title: 'Revisão de relatório com IA',
    description: 'Análise ortográfica, conceitual e de clareza das fases',
    costLabel: '1 crédito',
    free: false,
    icon: Icon.Reports,
  },
  {
    id: 'quiz-suggestions',
    title: 'Sugerir alternativas de quiz',
    description: 'Usa apenas o limite diário de sugestões',
    costLabel: 'Grátis',
    free: true,
    icon: Icon.Quiz,
  },
] as const;

function calcUsagePercent(used: number, limit: number): number {
  if (limit <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

function formatRenewalDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

function formatDaysUntil(resetsAtIso: string, referenceIso: string): string | null {
  const target = new Date(resetsAtIso).getTime();
  const now = new Date(referenceIso).getTime();
  if (Number.isNaN(target) || Number.isNaN(now)) return null;
  const diffDays = Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
  if (diffDays === 0) return 'hoje';
  if (diffDays === 1) return 'em 1 dia';
  return `em ${diffDays} dias`;
}

function formatNumberPt(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

interface AiQuotaViewProps {
  user: User;
  initialUsage: AiUsage | null;
  fetchedAtIso: string;
}

export function AiQuotaView({ user, initialUsage, fetchedAtIso }: AiQuotaViewProps) {
  const [usage, setUsage] = useState<AiUsage | null>(initialUsage);
  const [referenceIso, setReferenceIso] = useState(fetchedAtIso);
  const [refreshing, startRefresh] = useTransition();
  const [toast, setToast] = useState<{
    tone: 'info' | 'danger';
    title: string;
    message: string;
  } | null>(null);

  function handleRefresh() {
    startRefresh(async () => {
      const next = await getAiUsageAction();
      if (next) {
        setUsage(next);
        setReferenceIso(new Date().toISOString());
      } else {
        setToast({
          tone: 'danger',
          title: 'Não foi possível atualizar',
          message: 'A API de cotas de IA não respondeu. Tente novamente em instantes.',
        });
      }
    });
  }

  const activePlan: PlanId = usage?.plan ?? user.plan;
  const creditsUsed = usage?.creditsUsed ?? 0;
  const creditsLimit = usage?.creditsLimit ?? 0;
  const creditsRemaining = Math.max(0, creditsLimit - creditsUsed);
  const creditsPercent = calcUsagePercent(creditsUsed, creditsLimit);
  const creditsExhausted = Boolean(usage && creditsLimit > 0 && creditsUsed >= creditsLimit);
  const creditsNearLimit = Boolean(usage && !creditsExhausted && creditsPercent >= 80);

  const suggestionsUsed = usage?.suggestionsUsedToday ?? 0;
  const suggestionsLimit = usage?.suggestionsDailyLimit ?? 0;
  const suggestionsRemaining = Math.max(0, suggestionsLimit - suggestionsUsed);
  const suggestionsPercent = calcUsagePercent(suggestionsUsed, suggestionsLimit);
  const suggestionsExhausted = Boolean(
    usage && suggestionsLimit > 0 && suggestionsUsed >= suggestionsLimit,
  );

  const renewalDate = usage ? formatRenewalDate(usage.resetsAt) : null;
  const daysUntilRenewal = usage ? formatDaysUntil(usage.resetsAt, referenceIso) : null;

  function resolveStatusTag() {
    if (!usage) return null;
    if (!usage.enabled) return <Tag tone="neutral">IA desativada</Tag>;
    if (creditsExhausted) return <Tag tone="pink">Cota mensal esgotada</Tag>;
    if (creditsNearLimit) return <Tag tone="amber">Próximo do limite</Tag>;
    return <Tag tone="green">Ativo</Tag>;
  }

  return (
    <>
      <div className={styles.page}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>Configurações</span>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Uso de cotas de IA</h1>
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon.Restart size={15} className={cx(refreshing && styles.spinning)} />}
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Atualizando...' : 'Atualizar'}
            </Button>
          </div>
          <p className={styles.subtitle}>
            Acompanhe o saldo de créditos mensais e o limite diário de sugestões de IA da sua conta.
          </p>
        </header>

          {!usage ? (
            <div>
              <StateMessage title="Consumo de IA indisponível" hint="GET /ai/usage">
                Não foi possível carregar o uso de cotas de IA agora. Verifique se a API está
                configurada e tente atualizar.
              </StateMessage>
              <div className={styles.unavailableActions}>
                <Button variant="secondary" onClick={handleRefresh} disabled={refreshing}>
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : (
            <>
              <section aria-labelledby="ai-plan-heading">
                <Card className={styles.card}>
                  <div className={styles.planTop}>
                    <div>
                      <span className={styles.planLabel}>Plano atual</span>
                      <h2 id="ai-plan-heading" className={styles.planName}>
                        {PLAN_LABEL[activePlan]}
                      </h2>
                    </div>
                    {resolveStatusTag()}
                  </div>

                  {renewalDate && (
                    <div className={styles.renewalRow}>
                      <Icon.Clock size={16} />
                      <span>
                        Renova em <strong>{renewalDate}</strong>
                        {daysUntilRenewal ? ` (${daysUntilRenewal})` : ''}
                      </span>
                    </div>
                  )}

                  {!usage.enabled && (
                    <div className={cx(styles.notice, styles.noticeWarning)} role="status">
                      <Icon.Info size={16} className={styles.noticeIcon} />
                      <span>
                        Os recursos de geração por IA estão desativados neste ambiente no momento.
                      </span>
                    </div>
                  )}

                  {usage.enabled && creditsExhausted && (
                    <div className={cx(styles.notice, styles.noticeDanger)} role="alert">
                      <Icon.Alert size={16} className={styles.noticeIcon} />
                      <span>
                        Você atingiu o limite mensal de créditos do plano {PLAN_LABEL[activePlan]}.
                        Novas gerações serão liberadas na renovação do ciclo.
                      </span>
                    </div>
                  )}

                  {usage.enabled && creditsNearLimit && (
                    <div className={cx(styles.notice, styles.noticeWarning)} role="status">
                      <Icon.Alert size={16} className={styles.noticeIcon} />
                      <span>
                        Você já utilizou {Math.round(creditsPercent)}% dos seus créditos mensais de
                        IA.
                      </span>
                    </div>
                  )}
                </Card>
              </section>

              <section aria-labelledby="ai-usage-heading">
                <Card className={styles.card}>
                  <div className={styles.sectionHeader}>
                    <h2 id="ai-usage-heading" className={styles.sectionTitle}>
                      Consumo do ciclo
                    </h2>
                    <p className={styles.sectionHint}>
                      Créditos são contabilizados por mês; sugestões de quiz renovam diariamente.
                    </p>
                  </div>

                  <div className={styles.quotaBlock}>
                    <div className={styles.quotaTop}>
                      <span className={styles.quotaLabel}>
                        <Icon.Sparkle size={16} className={styles.quotaIconPrimary} />
                        Créditos mensais de IA
                      </span>
                      <span className={styles.quotaValue}>
                        <strong>{formatNumberPt(creditsUsed)}</strong> /{' '}
                        {formatNumberPt(creditsLimit)}
                      </span>
                    </div>

                    <Meter
                      value={creditsPercent}
                      tone={creditsExhausted ? 'danger' : 'primary'}
                      size="medium"
                      label="Consumo de créditos mensais de IA"
                    />

                    <div className={styles.quotaFooter}>
                      <span>
                        {creditsExhausted
                          ? 'Nenhum crédito restante neste mês'
                          : `${formatNumberPt(creditsRemaining)} ${
                              creditsRemaining === 1 ? 'crédito restante' : 'créditos restantes'
                            }`}
                      </span>
                      <span className={styles.quotaPercent}>{Math.round(creditsPercent)}%</span>
                    </div>
                  </div>

                  <hr className={styles.divider} />

                  <div className={styles.quotaBlock}>
                    <div className={styles.quotaTop}>
                      <span className={styles.quotaLabel}>
                        <Icon.Ai size={16} className={styles.quotaIconInfo} />
                        Sugestões de alternativas hoje
                      </span>
                      <span className={styles.quotaValue}>
                        <strong>{formatNumberPt(suggestionsUsed)}</strong> /{' '}
                        {formatNumberPt(suggestionsLimit)}
                      </span>
                    </div>

                    <Meter
                      value={suggestionsPercent}
                      tone={suggestionsExhausted ? 'danger' : 'info'}
                      size="medium"
                      label="Consumo diário de sugestões de alternativas"
                    />

                    <div className={styles.quotaFooter}>
                      <span>
                        {suggestionsExhausted
                          ? 'Limite diário atingido · renova à meia-noite'
                          : `${formatNumberPt(suggestionsRemaining)} restantes hoje · sem gasto de créditos`}
                      </span>
                      <span className={styles.quotaPercent}>{Math.round(suggestionsPercent)}%</span>
                    </div>
                  </div>
                </Card>
              </section>

              <section aria-labelledby="ai-costs-heading">
                <Card className={styles.card}>
                  <div className={styles.sectionHeader}>
                    <h2 id="ai-costs-heading" className={styles.sectionTitle}>
                      Custo por operação
                    </h2>
                    <p className={styles.sectionHint}>
                      Solicitações que falharem por indisponibilidade não são descontadas da sua
                      cota.
                    </p>
                  </div>

                  <ul className={styles.operationList}>
                    {OPERATION_COSTS.map((item) => {
                      const OperationIcon = item.icon;
                      return (
                        <li key={item.id} className={styles.operationRow}>
                          <div className={styles.operationInfo}>
                            <span className={styles.operationIcon}>
                              <OperationIcon size={16} />
                            </span>
                            <div className={styles.operationText}>
                              <span className={styles.operationTitle}>{item.title}</span>
                              <span className={styles.operationDesc}>{item.description}</span>
                            </div>
                          </div>
                          {item.free ? (
                            <Tag tone="green">{item.costLabel}</Tag>
                          ) : (
                            <span className={styles.costBadge}>{item.costLabel}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </section>

              <section aria-labelledby="ai-plans-heading">
                <Card className={styles.card}>
                  <div className={styles.sectionHeader}>
                    <h2 id="ai-plans-heading" className={styles.sectionTitle}>
                      Limites por plano
                    </h2>
                    <p className={styles.sectionHint}>
                      Cotas mensais de créditos e sugestões diárias incluídas em cada plano.
                    </p>
                  </div>

                  <ul className={styles.planList}>
                    {PLAN_QUOTA_TIERS.map((tier) => {
                      const isCurrent = tier.id === activePlan;
                      return (
                        <li
                          key={tier.id}
                          className={cx(styles.planRow, isCurrent && styles.planRowActive)}
                        >
                          <div className={styles.planRowMeta}>
                            <span className={styles.planRowTitle}>
                              {tier.name}
                              {isCurrent && <Tag tone="blue">Atual</Tag>}
                            </span>
                            <span className={styles.planRowQuota}>{tier.description}</span>
                          </div>
                          <div className={styles.planRowNumbers}>
                            <strong>{formatNumberPt(tier.credits)} créd./mês</strong>
                            <span>{formatNumberPt(tier.dailySuggestions)} sug./dia</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <div className={styles.cardFooter}>
                    <span className={styles.footerNote}>
                      Precisa de mais créditos para suas turmas ou seleções?
                    </span>
                    <Link href="/configuracoes/pagamentos" className={styles.footerLink}>
                      Comparar planos
                      <Icon.ChevronRight size={15} />
                    </Link>
                  </div>
                </Card>
              </section>
            </>
          )}
      </div>

      {toast && (
        <ToastViewport>
          <Toast
            tone={toast.tone}
            title={toast.title}
            message={toast.message}
            onClose={() => setToast(null)}
          />
        </ToastViewport>
      )}
    </>
  );
}
