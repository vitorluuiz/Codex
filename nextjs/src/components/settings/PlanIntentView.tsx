'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { Button, Card, Input, Tag, TextArea, Toast, ToastViewport } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { PRICING_PLANS, PRICING_ROWS, type PricingPlan } from '@/content/landing';
import { savePlanIntentAction } from '@/lib/actions/billing';
import { cx } from '@/lib/cx';
import type {
  PlanId,
  PlanIntent,
  PlanPricePerception,
  PlanSubscriptionIntent,
  User,
} from '@/lib/types';
import styles from './PlanIntentView.module.css';

type WizardStep = 1 | 2 | 3;

const PLAN_BY_ID: Record<PlanId, PricingPlan> = {
  free: PRICING_PLANS[0],
  intermediate: PRICING_PLANS[1],
  pro: PRICING_PLANS[2],
};

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 1, label: 'Aviso' },
  { id: 2, label: 'Planos e benefícios' },
  { id: 3, label: 'Preço sugerido' },
];

function formatPriceBrl(amount: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

function perceptionLabel(planId: PlanId, perception: PlanPricePerception): string {
  if (planId === 'free') {
    if (perception === 'fair') return 'Faz sentido ser gratuito com esses limites';
    if (perception === 'expectedHigher') return 'Esperava que tivesse algum custo';
  }
  switch (perception) {
    case 'expectedLower':
      return 'Esperava um preço menor';
    case 'fair':
      return 'Está dentro do que eu esperava';
    case 'expectedHigher':
      return 'Esperava um preço maior';
  }
}

function intentLabel(planId: PlanId, intent: PlanSubscriptionIntent): string {
  if (planId === 'free') {
    switch (intent) {
      case 'yes':
        return 'Sim, manteria o plano Grátis';
      case 'maybe':
        return 'Talvez, precisaria avaliar melhor';
      case 'no':
        return 'Não escolheria este plano';
    }
  }
  switch (intent) {
    case 'yes':
      return 'Sim, eu assinaria';
    case 'maybe':
      return 'Talvez, precisaria avaliar melhor';
    case 'no':
      return 'Não assinaria por esse valor';
  }
}

function getPlanHighlights(planId: PlanId): string[] {
  const items: string[] = [];
  for (const row of PRICING_ROWS) {
    const value = row[planId];
    if (value === true) {
      items.push(row.label);
    } else if (typeof value === 'string') {
      items.push(`${row.label}: ${value}`);
    }
  }
  return items;
}

interface PlanIntentViewProps {
  user: User;
  initialIntent: PlanIntent | null;
}

export function PlanIntentView({ user, initialIntent }: PlanIntentViewProps) {
  const [savedIntent, setSavedIntent] = useState<PlanIntent | null>(initialIntent);
  const [editing, setEditing] = useState<boolean>(initialIntent === null);
  const [step, setStep] = useState<WizardStep>(1);

  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(
    initialIntent?.selectedPlan ?? null,
  );
  const [pricePerception, setPricePerception] = useState<PlanPricePerception | null>(
    initialIntent?.pricePerception ?? null,
  );
  const [subscriptionIntent, setSubscriptionIntent] = useState<PlanSubscriptionIntent | null>(
    initialIntent?.subscriptionIntent ?? null,
  );
  const [expectedPriceInput, setExpectedPriceInput] = useState<string>(
    initialIntent?.expectedPriceBrl != null ? String(initialIntent.expectedPriceBrl) : '',
  );
  const [expectedPriceError, setExpectedPriceError] = useState<string | null>(null);
  const [comment, setComment] = useState<string>(initialIntent?.comment ?? '');

  const [submitting, startSubmit] = useTransition();
  const [toast, setToast] = useState<{
    tone: 'success' | 'danger' | 'info';
    title: string;
    message: string;
  } | null>(null);

  const activePlan = selectedPlan ? PLAN_BY_ID[selectedPlan] : null;
  const currentUserPlan = PLAN_BY_ID[user.plan];

  function handleSelectPlan(planId: PlanId) {
    setSelectedPlan(planId);
    if (planId === 'free' && pricePerception === 'expectedLower') {
      setPricePerception(null);
      setExpectedPriceInput('');
      setExpectedPriceError(null);
    }
  }

  function handleStartEdit() {
    if (savedIntent) {
      setSelectedPlan(savedIntent.selectedPlan);
      setPricePerception(savedIntent.pricePerception);
      setSubscriptionIntent(savedIntent.subscriptionIntent);
      setExpectedPriceInput(
        savedIntent.expectedPriceBrl != null ? String(savedIntent.expectedPriceBrl) : '',
      );
      setComment(savedIntent.comment ?? '');
    }
    setExpectedPriceError(null);
    setStep(1);
    setEditing(true);
  }

  function handleCancelEdit() {
    if (!savedIntent) return;
    setExpectedPriceError(null);
    setEditing(false);
  }

  function handleStepJump(target: WizardStep) {
    if (target < step) {
      setStep(target);
    } else if (target === 2 && step === 1) {
      setStep(2);
    } else if (target === 3 && selectedPlan) {
      setStep(3);
    }
  }

  function handleSubmit() {
    if (!selectedPlan || !pricePerception || !subscriptionIntent) return;

    let parsedExpectedPrice: number | null = null;
    if (pricePerception !== 'fair' && expectedPriceInput.trim() !== '') {
      const normalized = expectedPriceInput.trim().replace(',', '.');
      const numeric = Number(normalized);
      if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0 || numeric > 100_000) {
        setExpectedPriceError('Informe um valor inteiro em reais entre 0 e 100.000.');
        return;
      }
      parsedExpectedPrice = numeric;
    }

    setExpectedPriceError(null);

    startSubmit(async () => {
      const result = await savePlanIntentAction({
        selectedPlan,
        pricePerception,
        subscriptionIntent,
        expectedPriceBrl: parsedExpectedPrice,
        comment: comment.trim() || null,
      });

      if (result.ok) {
        setSavedIntent(result.data);
        setEditing(false);
        setToast({
          tone: 'success',
          title: 'Resposta registrada',
          message: 'Obrigado! Sua opinião vai ajudar a definir os planos do Codex.',
        });
      } else {
        setToast({
          tone: 'danger',
          title: 'Não foi possível salvar',
          message: result.message,
        });
      }
    });
  }

  const showSummary = savedIntent !== null && !editing;

  const perceptionOptions: {
    value: PlanPricePerception;
    title: string;
    description: string;
  }[] =
    selectedPlan === 'free'
      ? [
          {
            value: 'fair',
            title: 'Faz sentido ser gratuito com esses limites',
            description: 'Os recursos incluídos parecem equilibrados para começar sem custo.',
          },
          {
            value: 'expectedHigher',
            title: 'Esperava que tivesse algum custo',
            description: 'Pelo que oferece, imaginei que este plano já seria pago.',
          },
        ]
      : [
          {
            value: 'expectedLower',
            title: 'Esperava um preço menor',
            description: 'Achei o valor acima do que eu imaginava para estes benefícios.',
          },
          {
            value: 'fair',
            title: 'Está dentro do que eu esperava',
            description: 'O valor sugerido parece justo para o que o plano oferece.',
          },
          {
            value: 'expectedHigher',
            title: 'Esperava um preço maior',
            description: 'Achei mais acessível do que eu imaginava para estes benefícios.',
          },
        ];

  const intentOptions: {
    value: PlanSubscriptionIntent;
    title: string;
    description: string;
  }[] =
    selectedPlan === 'free'
      ? [
          {
            value: 'yes',
            title: 'Sim, manteria o plano Grátis',
            description: 'Os recursos gratuitos atendem bem o que preciso no momento.',
          },
          {
            value: 'maybe',
            title: 'Talvez, precisaria avaliar melhor',
            description: 'Ainda quero testar mais para saber se o gratuito será suficiente.',
          },
          {
            value: 'no',
            title: 'Não escolheria este plano',
            description: 'Prefiro olhar outro conjunto de recursos e limites.',
          },
        ]
      : [
          {
            value: 'yes',
            title: 'Sim, eu assinaria',
            description: 'A combinação de valor sugerido e benefícios faz sentido para mim.',
          },
          {
            value: 'maybe',
            title: 'Talvez, precisaria avaliar melhor',
            description: 'Tenho interesse, mas gostaria de testar ou comparar com calma.',
          },
          {
            value: 'no',
            title: 'Não assinaria por esse valor',
            description: 'Com esse preço, eu não contrataria este plano no lançamento.',
          },
        ];

  return (
    <>
      <div className={styles.page} data-settings-wide="true">
        <header className={styles.header}>
          <span className={styles.eyebrow}>Configurações</span>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Pagamentos e plano</h1>
            <Tag tone="blue" icon={<Icon.Crown size={13} />}>
              Pesquisa de planos
            </Tag>
          </div>
          <p className={styles.subtitle}>
            Os planos pagos ainda não estão ativos. Ajude a plataforma a entender qual plano e faixa
            de valor fazem mais sentido para você.
          </p>
        </header>

        {showSummary && savedIntent ? (
          <Card className={styles.card}>
            <div className={styles.summaryTop}>
              <div className={styles.summaryHeading}>
                <span className={styles.summaryBadgeIcon} aria-hidden="true">
                  <Icon.Check size={18} />
                </span>
                <div>
                  <h2 className={styles.sectionTitle}>Intenção de plano registrada</h2>
                  <p className={styles.sectionHint}>
                    Obrigado por responder! Nenhuma cobrança foi feita — avisaremos quando os planos
                    entrarem em operação.
                  </p>
                </div>
              </div>
              <Tag tone="green">Registrado</Tag>
            </div>

            <div className={styles.noticeInfo} role="status">
              <Icon.Info size={16} className={styles.noticeIcon} />
              <span>
                Os pagamentos ainda não estão disponíveis na plataforma. Sua resposta serve
                exclusivamente para orientar o lançamento dos planos.
              </span>
            </div>

            <dl className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <dt>Plano escolhido</dt>
                <dd>
                  <strong>{PLAN_BY_ID[savedIntent.selectedPlan].name}</strong>
                </dd>
              </div>
              <div className={styles.summaryItem}>
                <dt>Valor sugerido revelado</dt>
                <dd className={styles.monoValue}>
                  <strong>{formatPriceBrl(savedIntent.suggestedPriceBrl)}</strong>
                  <span>{PLAN_BY_ID[savedIntent.selectedPlan].priceSuffix ?? ''}</span>
                </dd>
              </div>
              <div className={styles.summaryItem}>
                <dt>O que você achou do valor</dt>
                <dd>{perceptionLabel(savedIntent.selectedPlan, savedIntent.pricePerception)}</dd>
              </div>
              <div className={styles.summaryItem}>
                <dt>Intenção após saber o preço</dt>
                <dd>{intentLabel(savedIntent.selectedPlan, savedIntent.subscriptionIntent)}</dd>
              </div>
              {savedIntent.expectedPriceBrl != null && (
                <div className={styles.summaryItem}>
                  <dt>Valor mensal esperado</dt>
                  <dd className={styles.monoValue}>
                    <strong>{formatPriceBrl(savedIntent.expectedPriceBrl)}</strong>/mês
                  </dd>
                </div>
              )}
              {savedIntent.comment && (
                <div className={cx(styles.summaryItem, styles.summaryItemFull)}>
                  <dt>Comentário</dt>
                  <dd>{savedIntent.comment}</dd>
                </div>
              )}
            </dl>

            <div className={styles.summaryFooter}>
              <span className={styles.updatedAt}>
                Atualizado em {formatUpdatedAt(savedIntent.updatedAt)}
                {savedIntent.submissionCount > 1 ? ` · ${savedIntent.submissionCount} envios` : ''}
              </span>
              <Button variant="secondary" icon={<Icon.Pencil size={15} />} onClick={handleStartEdit}>
                Atualizar resposta
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <nav className={styles.stepper} aria-label="Etapas do formulário de intenção">
              <ol className={styles.stepperList}>
                {STEPS.map((item) => {
                  const isCurrent = step === item.id;
                  const isCompleted = step > item.id;
                  const canJump =
                    item.id < step ||
                    (item.id === 2 && step === 1) ||
                    (item.id === 3 && Boolean(selectedPlan));

                  return (
                    <li
                      key={item.id}
                      className={cx(
                        styles.stepperItem,
                        isCurrent && styles.stepperItemCurrent,
                        isCompleted && styles.stepperItemCompleted,
                      )}
                    >
                      <button
                        type="button"
                        className={styles.stepperButton}
                        onClick={() => handleStepJump(item.id)}
                        disabled={!canJump}
                        aria-current={isCurrent ? 'step' : undefined}
                      >
                        <span className={styles.stepperNumber}>
                          {isCompleted ? <Icon.Check size={13} /> : item.id}
                        </span>
                        <span className={styles.stepperLabel}>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            {step === 1 && (
              <Card className={styles.card}>
                <div className={styles.noticeWarning} role="status">
                  <Icon.Info size={18} className={styles.noticeIcon} />
                  <div>
                    <strong className={styles.noticeTitle}>
                      Os planos ainda não estão disponíveis para contratação
                    </strong>
                    <p className={styles.noticeBody}>
                      A área de pagamentos ainda não está em operação e nenhuma cobrança está ativa
                      no momento. Enquanto preparamos o lançamento, queremos ouvir você para montar
                      planos que realmente façam sentido.
                    </p>
                  </div>
                </div>

                <div className={styles.introContent}>
                  <h2 className={styles.sectionTitle}>Como funciona esta pesquisa rápida</h2>
                  <p className={styles.bodyText}>
                    Queremos descobrir qual plano se encaixa melhor na sua rotina sem influenciar sua
                    escolha pelo preço logo de início. Leva menos de 1 minuto:
                  </p>

                  <ol className={styles.howItWorks}>
                    <li className={styles.howItem}>
                      <span className={styles.howBadge}>1</span>
                      <div>
                        <strong>Compare os benefícios sem ver preços</strong>
                        <p>
                          Na próxima etapa você acessa a tabela de planos e recursos para escolher a
                          opção que melhor atende suas aulas ou processos.
                        </p>
                      </div>
                    </li>
                    <li className={styles.howItem}>
                      <span className={styles.howBadge}>2</span>
                      <div>
                        <strong>Conheça o valor sugerido</strong>
                        <p>
                          Depois da escolha, revelamos o preço estipulado inicialmente para aquele
                          plano.
                        </p>
                      </div>
                    </li>
                    <li className={styles.howItem}>
                      <span className={styles.howBadge}>3</span>
                      <div>
                        <strong>Valide se o valor faz sentido</strong>
                        <p>
                          Conte se você manteria a intenção de assinar sabendo do preço e se esperava
                          um valor menor, justo ou maior.
                        </p>
                      </div>
                    </li>
                  </ol>
                </div>

                <div className={styles.currentPlanBar}>
                  <span>Plano atual da sua conta</span>
                  <Tag tone="neutral">{currentUserPlan.name}</Tag>
                </div>

                <div className={styles.stepActions}>
                  {savedIntent ? (
                    <Button variant="ghost" onClick={handleCancelEdit}>
                      Cancelar
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button
                    icon={<Icon.ChevronRight size={16} />}
                    iconPosition="right"
                    onClick={() => setStep(2)}
                  >
                    Ir para a tabela de benefícios
                  </Button>
                </div>
              </Card>
            )}

            {step === 2 && (
              <Card className={styles.card}>
                <div className={styles.stepTwoHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      Escolha o plano pelos benefícios (sem preço)
                    </h2>
                    <p className={styles.sectionHint}>
                      Clique em uma das colunas abaixo para selecionar o plano que melhor se encaixa
                      no seu uso. O valor sugerido só será mostrado no próximo passo.
                    </p>
                  </div>
                  <Link
                    href="/#precos"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.landingLink}
                  >
                    Ver na página inicial
                    <Icon.ChevronRight size={14} />
                  </Link>
                </div>

                <div
                  className={styles.tableWrapper}
                  role="radiogroup"
                  aria-label="Selecione o plano ideal pelos benefícios"
                >
                  <div className={styles.comparisonGrid}>
                    <div className={styles.cornerCell}>
                      <span>Recursos e limites</span>
                    </div>

                    {PRICING_PLANS.map((plan) => {
                      const isSelected = selectedPlan === plan.id;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          className={cx(
                            styles.planHeaderCell,
                            plan.highlighted && styles.planHeaderPopular,
                            isSelected && styles.planHeaderSelected,
                          )}
                          onClick={() => handleSelectPlan(plan.id)}
                        >
                          <div className={styles.planHeaderTop}>
                            <span
                              className={cx(
                                styles.radioDot,
                                isSelected && styles.radioDotSelected,
                              )}
                              aria-hidden="true"
                            >
                              {isSelected && <Icon.Check size={11} />}
                            </span>
                            {plan.badge && <Tag tone="blue">{plan.badge}</Tag>}
                          </div>
                          <span className={styles.planHeaderName}>{plan.name}</span>
                          <span className={styles.planHeaderDesc}>{plan.description}</span>
                          <span
                            className={cx(
                              styles.selectPill,
                              isSelected && styles.selectPillActive,
                            )}
                          >
                            {isSelected ? 'Selecionado' : 'Selecionar'}
                          </span>
                        </button>
                      );
                    })}

                    {PRICING_ROWS.map((row, index) => {
                      const zebra = index % 2 === 1;
                      return (
                        <div key={row.label} className={styles.tableRowContents}>
                          <div className={cx(styles.featureLabelCell, zebra && styles.rowZebra)}>
                            {row.label}
                          </div>
                          {PRICING_PLANS.map((plan) => {
                            const value = row[plan.id];
                            const isSelected = selectedPlan === plan.id;
                            return (
                              <div
                                key={`${row.label}-${plan.id}`}
                                className={cx(
                                  styles.featureValueCell,
                                  zebra && styles.rowZebra,
                                  isSelected && styles.colSelected,
                                )}
                                onClick={() => handleSelectPlan(plan.id)}
                              >
                                {typeof value === 'string' ? (
                                  <span className={styles.cellText}>{value}</span>
                                ) : value ? (
                                  <>
                                    <Icon.Check size={16} className={styles.iconYes} />
                                    <span className="visuallyHidden">Incluído</span>
                                  </>
                                ) : (
                                  <>
                                    <Icon.Dash size={15} className={styles.iconNo} />
                                    <span className="visuallyHidden">Não incluído</span>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.selectionBar}>
                  {activePlan ? (
                    <span>
                      Plano selecionado: <strong>{activePlan.name}</strong> — na próxima etapa você
                      verá o valor sugerido.
                    </span>
                  ) : (
                    <span>Selecione uma coluna de plano acima para continuar.</span>
                  )}
                </div>

                <div className={styles.stepActions}>
                  <Button
                    variant="secondary"
                    icon={<Icon.ChevronLeft size={16} />}
                    onClick={() => setStep(1)}
                  >
                    Voltar
                  </Button>
                  <Button
                    icon={<Icon.ChevronRight size={16} />}
                    iconPosition="right"
                    disabled={!selectedPlan}
                    onClick={() => setStep(3)}
                  >
                    Revelar valor sugerido
                  </Button>
                </div>
              </Card>
            )}

            {step === 3 && activePlan && selectedPlan && (
              <Card className={styles.card}>
                <div className={styles.priceReveal}>
                  <div className={styles.priceRevealMeta}>
                    <Tag tone="blue">Valor sugerido</Tag>
                    <h2 className={styles.priceRevealTitle}>Plano {activePlan.name}</h2>
                    <p className={styles.priceRevealDesc}>{activePlan.description}</p>
                  </div>
                  <div className={styles.priceRevealAmount}>
                    <span className={styles.priceNumber}>
                      {formatPriceBrl(activePlan.suggestedPriceBrl)}
                    </span>
                    {activePlan.priceSuffix && (
                      <span className={styles.priceSuffix}>{activePlan.priceSuffix}</span>
                    )}
                  </div>
                </div>

                <div className={styles.benefitsRecap}>
                  <span className={styles.recapLabel}>Principais benefícios incluídos:</span>
                  <ul className={styles.recapChips}>
                    {getPlanHighlights(selectedPlan).map((item) => (
                      <li key={item} className={styles.recapChip}>
                        <Icon.Check size={13} className={styles.iconYes} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <hr className={styles.divider} />

                <fieldset className={styles.questionGroup}>
                  <legend className={styles.questionLegend}>
                    1. O que você achou desse valor estipulado para os benefícios do plano{' '}
                    {activePlan.name}?
                  </legend>
                  <div className={styles.optionStack} role="radiogroup">
                    {perceptionOptions.map((option) => {
                      const checked = pricePerception === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          className={cx(styles.choiceCard, checked && styles.choiceCardSelected)}
                          onClick={() => {
                            setPricePerception(option.value);
                            if (option.value === 'fair') {
                              setExpectedPriceInput('');
                              setExpectedPriceError(null);
                            }
                          }}
                        >
                          <span
                            className={cx(styles.radioDot, checked && styles.radioDotSelected)}
                            aria-hidden="true"
                          >
                            {checked && <Icon.Check size={11} />}
                          </span>
                          <span className={styles.choiceText}>
                            <span className={styles.choiceTitle}>{option.title}</span>
                            <span className={styles.choiceDesc}>{option.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                {(pricePerception === 'expectedLower' || pricePerception === 'expectedHigher') && (
                  <div className={styles.expectedPriceField}>
                    <Input
                      type="number"
                      min={0}
                      max={100000}
                      step={1}
                      inputMode="numeric"
                      label="Qual valor mensal (em R$) você esperava? (opcional)"
                      placeholder={selectedPlan === 'pro' ? 'Ex.: 25' : 'Ex.: 8'}
                      value={expectedPriceInput}
                      error={expectedPriceError}
                      onChange={(e) => {
                        setExpectedPriceInput(e.target.value);
                        if (expectedPriceError) setExpectedPriceError(null);
                      }}
                    />
                  </div>
                )}

                <fieldset className={styles.questionGroup}>
                  <legend className={styles.questionLegend}>
                    {selectedPlan === 'free'
                      ? '2. Sabendo das condições e dos benefícios, você manteria a escolha pelo plano Grátis?'
                      : `2. Sabendo do valor sugerido (${formatPriceBrl(activePlan.suggestedPriceBrl)}${activePlan.priceSuffix ?? ''}) e dos benefícios, você assinaria o plano ${activePlan.name}?`}
                  </legend>
                  <div className={styles.optionStack} role="radiogroup">
                    {intentOptions.map((option) => {
                      const checked = subscriptionIntent === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          className={cx(styles.choiceCard, checked && styles.choiceCardSelected)}
                          onClick={() => setSubscriptionIntent(option.value)}
                        >
                          <span
                            className={cx(styles.radioDot, checked && styles.radioDotSelected)}
                            aria-hidden="true"
                          >
                            {checked && <Icon.Check size={11} />}
                          </span>
                          <span className={styles.choiceText}>
                            <span className={styles.choiceTitle}>{option.title}</span>
                            <span className={styles.choiceDesc}>{option.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className={styles.commentField}>
                  <TextArea
                    compact
                    maxLength={500}
                    label="Alguma sugestão sobre o preço ou benefícios? (opcional)"
                    placeholder="Conte o que mais pesou na sua decisão ou que recurso gostaria de ver incluído..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <span className={styles.charCount}>{comment.length}/500</span>
                </div>

                <div className={styles.stepActions}>
                  <Button
                    variant="secondary"
                    icon={<Icon.ChevronLeft size={16} />}
                    onClick={() => setStep(2)}
                    disabled={submitting}
                  >
                    Escolher outro plano
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={!pricePerception || !subscriptionIntent || submitting}
                  >
                    {submitting
                      ? 'Enviando...'
                      : savedIntent
                        ? 'Salvar atualização'
                        : 'Enviar resposta'}
                  </Button>
                </div>
              </Card>
            )}
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
