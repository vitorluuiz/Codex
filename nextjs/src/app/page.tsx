import Link from 'next/link';

import { PhaseCarousel } from '@/components/landing/PhaseCarousel';
import { Button, Card, Tag } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { ImageSlot } from '@/components/media/ImageSlot';
import {
  FEATURES,
  PHASE_SLIDES,
  PRICING_PLANS,
  PRICING_ROWS,
  USE_CASES,
  type PricingPlan,
  type PricingRow,
} from '@/content/landing';
import { cx } from '@/lib/cx';
import styles from './page.module.css';

/**
 * Landing page — Server Component puro. O único trecho interativo é o
 * carrossel de tipos de fase, isolado num Client Component.
 */

const USE_CASE_ICONS = {
  students: { Component: Icon.Students, className: styles.iconStudents },
  teachers: { Component: Icon.Teachers, className: styles.iconTeachers },
  recruiters: { Component: Icon.Recruiters, className: styles.iconRecruiters },
} as const;

const FEATURE_ICONS = {
  templates: Icon.Templates,
  phaseTypes: Icon.PhaseTypes,
  reports: Icon.Reports,
  ai: Icon.Ai,
  feedback: Icon.Trophy,
} as const;

function PlanColumn({ plan }: { plan: PricingPlan }) {
  return (
    <div className={cx(styles.planCell, plan.highlighted && styles.planHighlighted)}>
      {plan.badge && <Tag tone="blue">{plan.badge}</Tag>}
      <div className={styles.planName}>{plan.name}</div>
      <div>
        <span className={styles.planPrice}>{plan.price}</span>
        {plan.priceSuffix && <span className={styles.planSuffix}> {plan.priceSuffix}</span>}
      </div>
      <p className={styles.planDescription}>{plan.description}</p>
      <Link href="/entrar" className={styles.planCta}>
        <Button variant={plan.highlighted ? 'primary' : 'secondary'} block>
          {plan.ctaLabel}
        </Button>
      </Link>
    </div>
  );
}

function PricingCell({
  value,
  highlighted,
  zebra,
}: {
  value: string | boolean;
  highlighted: boolean;
  zebra: boolean;
}) {
  return (
    <div
      className={cx(
        styles.rowValue,
        highlighted ? styles.rowHighlighted : zebra && styles.rowZebra,
      )}
    >
      {typeof value === 'string' ? (
        value
      ) : value ? (
        <>
          <Icon.Check size={18} className={styles.yes} />
          <span className="visuallyHidden">Incluído</span>
        </>
      ) : (
        <>
          <Icon.Dash size={16} className={styles.no} />
          <span className="visuallyHidden">Não incluído</span>
        </>
      )}
    </div>
  );
}

function PricingTableRow({ row, zebra }: { row: PricingRow; zebra: boolean }) {
  return (
    <>
      <div className={cx(styles.rowLabel, zebra && styles.rowZebra)}>{row.label}</div>
      <PricingCell value={row.free} highlighted={false} zebra={zebra} />
      <PricingCell value={row.intermediate} highlighted zebra={zebra} />
      <PricingCell value={row.pro} highlighted={false} zebra={zebra} />
    </>
  );
}

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <header className={cx(styles.nav)}>
        <div className={cx(styles.shell, styles.navInner)}>

          <div className={styles.brand}>Codex</div>
          <nav className={styles.navLinks} aria-label="Seções da página">
            <a className={styles.navLink} href="#casos">
              Casos de uso
            </a>
            <a className={styles.navLink} href="#recursos">
              Recursos
            </a>
            <a className={styles.navLink} href="#precos">
              Preços
            </a>
          </nav>
          <div className={styles.navActions}>
            <Link href="/entrar">
              <Button variant="ghost">Entrar</Button>
            </Link>
            <Link href="/entrar?modo=criar">
              <Button>Começar gratuitamente</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className={cx(styles.shell, styles.hero)}>
        <div>
          <span className={styles.eyebrow}>Aprender, ensinar e avaliar em uma só plataforma</span>
          <h1 className={styles.heroTitle}>
            Transforme desafios em resultados — para quem aprende, ensina e recruta.
          </h1>
          <p className={styles.heroLead}>
            Codex é uma plataforma de partidas e desafios gamificados para salas de aula e processos
            seletivos, com relatórios em tempo real e desafios criados pela comunidade ou por IA.
          </p>
          <div className={styles.heroActions}>
            <Link href="/entrar?modo=criar">
              <Button size="lg">Começar gratuitamente</Button>
            </Link>
            <a href="#casos">
              <Button size="lg" variant="secondary">
                Ver casos de uso
              </Button>
            </a>
          </div>
        </div>
        <ImageSlot
          placeholder="Screenshot da sala de desafio em andamento"
          width={640}
          height={440}
          priority
          className={styles.heroImage}
        />
      </section>

      <section id="casos" className={cx(styles.shell, styles.section)}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Feito para cada papel da sala</h2>
          <p className={styles.sectionLead}>
            Um mesmo motor de desafios, adaptado para quem pratica, quem ensina e quem seleciona.
          </p>
        </div>
        <div className={styles.useCases}>
          {USE_CASES.map((useCase) => {
            const { Component, className } = USE_CASE_ICONS[useCase.icon];
            return (
              <article key={useCase.id} className={styles.useCase}>
                <div className={cx(styles.useCaseIcon, className)}>
                  <Component />
                </div>
                <h3 className={styles.useCaseTitle}>{useCase.title}</h3>
                <p className={styles.useCaseBody}>{useCase.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="fases" className={cx(styles.shell, styles.section)}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Conheça os tipos de fase</h2>
          <p className={styles.sectionLead}>
            Quiz, código, dissertativa ou completar frase — combine o que fizer sentido para cada
            turma ou vaga.
          </p>
        </div>
        <PhaseCarousel slides={PHASE_SLIDES} />
      </section>

      <section id="recursos" className={styles.featuresBand}>
        <div className={styles.shell}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Tudo que você precisa para conduzir desafios</h2>
            <p className={styles.sectionLead}>Das primeiras perguntas até o relatório final.</p>
          </div>
          <div className={styles.featureGrid}>
            {FEATURES.map((feature) => {
              const FeatureIcon = FEATURE_ICONS[feature.icon];
              return (
                <article key={feature.id} className={styles.feature}>
                  <FeatureIcon className={styles.featureIcon} />
                  <h3 className={styles.featureTitle}>{feature.title}</h3>
                  <p className={styles.featureBody}>{feature.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="precos" className={cx(styles.shell, styles.pricing)}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Planos para cada tamanho de turma</h2>
          <p className={styles.sectionLead}>
            Comece de graça e evolua quando precisar de mais salas, relatórios e IA.
          </p>
        </div>

        <div className={styles.pricingTable}>
          <div className={styles.pricingGrid}>
            <div className={styles.planCellSpacer} />
            {PRICING_PLANS.map((plan) => (
              <PlanColumn key={plan.id} plan={plan} />
            ))}

            {PRICING_ROWS.map((row, i) => (
              <PricingTableRow key={row.label} row={row} zebra={i % 2 === 1} />
            ))}
          </div>
        </div>
      </section>

      <Card inverse large className={styles.cta}>
        <h2 className={styles.ctaTitle}>
          Pronto para transformar suas aulas ou seleções em desafios?
        </h2>
        <p className={styles.ctaLead}>Grátis para começar. Sem cartão de crédito.</p>
        <Link href="/entrar?modo=criar">
          <Button size="lg">Criar minha conta grátis</Button>
        </Link>
      </Card>

      <footer className={styles.footer}>
        Codex — plataforma de desafios gamificados para estudo, ensino e seleção.
      </footer>
    </main>
  );
}
