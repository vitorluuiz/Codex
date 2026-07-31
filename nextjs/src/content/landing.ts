import type { TagTone } from '@/components/ds';

/**
 * Conteúdo editorial da landing page.
 *
 * Não é dado de domínio (nada disso vive no banco), então fica versionado com o
 * código. Se um dia virar CMS, a rota sugerida está em `docs/api-rest.md`
 * (`GET /marketing/landing`) e este módulo passa a ser o fallback.
 */

export interface UseCase {
  id: string;
  title: string;
  description: string;
  icon: 'students' | 'teachers' | 'recruiters';
}

export const USE_CASES: UseCase[] = [
  {
    id: 'alunos',
    title: 'Alunos',
    icon: 'students',
    description:
      'Praticam com desafios criados pela própria comunidade — quizzes, problemas de código, redações curtas e mais — e recebem feedback melhor durante cada tentativa.',
  },
  {
    id: 'professores',
    title: 'Professores',
    icon: 'teachers',
    description:
      'Criam aulas mais interativas e observáveis, com relatórios coletivos e individuais em tempo real e controle total sobre os desafios propostos em cada fase.',
  },
  {
    id: 'selecao',
    title: 'Líderes de seleção',
    icon: 'recruiters',
    description:
      'Avaliam vários candidatos ao mesmo tempo, ao vivo ou sob medida, comparando desempenho lado a lado com relatórios exportáveis.',
  },
];

export interface PhaseSlide {
  id: string;
  tone: TagTone;
  tagLabel: string;
  title: string;
  description: string;
  imagePlaceholder: string;
}

export const PHASE_SLIDES: PhaseSlide[] = [
  {
    id: 'quiz',
    tone: 'blue',
    tagLabel: 'Quiz',
    title: 'Múltipla escolha rápida',
    description:
      'Perguntas de múltipla escolha com correção instantânea — ideal para revisão e aquecimento.',
    imagePlaceholder: 'Print da fase de quiz',
  },
  {
    id: 'code',
    tone: 'green',
    tagLabel: 'Código',
    title: 'Desafios de programação',
    description:
      'Editor com execução de testes e IA avaliando a solução — como um problema de entrevista técnica.',
    imagePlaceholder: 'Print da fase de código',
  },
  {
    id: 'text',
    tone: 'pink',
    tagLabel: 'Dissertativa',
    title: 'Respostas em texto livre',
    description: 'Explicações abertas avaliadas por IA, com feedback sobre o raciocínio do aluno.',
    imagePlaceholder: 'Print da fase dissertativa',
  },
  {
    id: 'fill',
    tone: 'amber',
    tagLabel: 'Completar frase',
    title: 'Complete a frase',
    description:
      'Preencha lacunas arrastando os termos certos — reforça conceitos e vocabulário técnico.',
    imagePlaceholder: 'Print da fase de completar frase',
  },
];

export interface Feature {
  id: string;
  title: string;
  description: string;
  icon: 'templates' | 'phaseTypes' | 'reports' | 'ai' | 'feedback';
}

export const FEATURES: Feature[] = [
  {
    id: 'modelos',
    icon: 'templates',
    title: 'Modelos de partida reutilizáveis',
    description:
      'Monte um conjunto de fases uma vez e reaplique entre turmas ou processos diferentes sem recomeçar do zero.',
  },
  {
    id: 'tipos',
    icon: 'phaseTypes',
    title: 'Vários tipos de fase',
    description:
      'Combine quizzes, desafios de código, respostas dissertativas e completar frases numa mesma partida.',
  },
  {
    id: 'relatorios',
    icon: 'reports',
    title: 'Relatórios em tempo real e exportáveis',
    description:
      'Acompanhe a turma ou os candidatos ao vivo e exporte relatórios coletivos e individuais em PDF ou Excel.',
  },
  {
    id: 'ia',
    icon: 'ai',
    title: 'IA integrada de ponta a ponta',
    description:
      'Crie desafios e variações automaticamente, avalie respostas dos alunos e identifique o uso indevido de IA nas submissões.',
  },
  {
    id: 'feedback',
    icon: 'feedback',
    title: 'Melhor feedback ao aluno',
    description:
      'Retornos claros durante o próprio desafio, para quem pratica entender o erro e evoluir na hora — não só no final.',
  },
];

export interface PricingPlan {
  id: 'free' | 'intermediate' | 'pro';
  name: string;
  price: string;
  priceSuffix: string | null;
  description: string;
  ctaLabel: string;
  highlighted: boolean;
  badge: string | null;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Grátis',
    price: 'R$0',
    priceSuffix: '/sempre',
    description: 'Para começar a praticar e testar a plataforma.',
    ctaLabel: 'Começar de graça',
    highlighted: false,
    badge: null,
  },
  {
    id: 'intermediate',
    name: 'Intermediário',
    price: 'R$79',
    priceSuffix: '/mês por educador',
    description: 'Para professores com turmas ativas o ano todo.',
    ctaLabel: 'Assinar Intermediário',
    highlighted: true,
    badge: 'Mais popular',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 'Sob consulta',
    priceSuffix: null,
    description: 'Para recrutadores e instituições com operações maiores.',
    ctaLabel: 'Falar com vendas',
    highlighted: false,
    badge: null,
  },
];

export interface PricingRow {
  label: string;
  free: string | boolean;
  intermediate: string | boolean;
  pro: string | boolean;
}

export const PRICING_ROWS: PricingRow[] = [
  { label: 'Salas simultâneas', free: '1', intermediate: '10', pro: 'Ilimitadas' },
  {
    label: 'Modelos de partida salvos',
    free: '2',
    intermediate: 'Ilimitados',
    pro: 'Ilimitados',
  },
  {
    label: 'Suporte',
    free: 'Comunidade',
    intermediate: 'E-mail',
    pro: 'Prioritário + gerente de conta',
  },
  {
    label: 'Todos os tipos de fase (quiz, código, texto, completar)',
    free: true,
    intermediate: true,
    pro: true,
  },
  { label: 'Relatórios em tempo real', free: true, intermediate: true, pro: true },
  {
    label: 'Feedback aprimorado ao aluno durante o desafio',
    free: true,
    intermediate: true,
    pro: true,
  },
  {
    label: 'Exportação de relatórios em PDF ou Excel',
    free: false,
    intermediate: true,
    pro: true,
  },
  { label: 'Criação de desafios com IA', free: false, intermediate: true, pro: true },
  {
    label: 'Variações automáticas de desafios existentes',
    free: false,
    intermediate: true,
    pro: true,
  },
  { label: 'Avaliação de respostas com IA', free: false, intermediate: true, pro: true },
  { label: 'Detecção de uso indevido de IA', free: false, intermediate: false, pro: true },
];
