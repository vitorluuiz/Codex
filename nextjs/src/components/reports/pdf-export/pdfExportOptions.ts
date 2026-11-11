import type { MatchReport } from '@/lib/types';

export type ReportSectionId =
  | 'overview'
  | 'phases'
  | 'ranking'
  | 'matrix'
  | 'questionQuality'
  | 'aiReview'
  | 'guessing'
  | 'collusion';

export type PdfTemplateId = 'complete' | 'summary' | 'pedagogical';

export type InkSaverMode = 'original' | 'eco' | 'max';

export type PdfPreviewKey = ReportSectionId | 'inkSaver' | 'sectionPerPage';

export interface PdfExportOptions {
  templateId: PdfTemplateId | 'custom';
  sections: Record<ReportSectionId, boolean>;
  questionQualityMode: 'full' | 'highlights';
  inkSaverMode: InkSaverMode;
  sectionPerPage: boolean;
  density: 'comfortable' | 'compact';
  footerText: string;
  logoDataUrl: string | null;
}

export interface InkSaverModeOption {
  value: InkSaverMode;
  label: string;
  shortLabel: string;
  description: string;
}

export const INK_SAVER_MODE_OPTIONS: readonly InkSaverModeOption[] = [
  {
    value: 'original',
    label: 'Versão original (cores e fundos completos)',
    shortLabel: 'Versão original',
    description:
      'Mantém todos os preenchimentos de barras, avatares coloridos e fundos semânticos da matriz.',
  },
  {
    value: 'eco',
    label: 'Economia de tinta (bordas coloridas, sem fundos)',
    shortLabel: 'Economia de tinta',
    description:
      'Remove o fundo das barras e dos avatares, usa marcador vertical nas alternativas e preserva cores apenas nas bordas da matriz.',
  },
  {
    value: 'max',
    label: 'Economia máxima (preto e branco, sem fundos)',
    shortLabel: 'Economia máxima',
    description:
      'Modo monocromático de alto contraste: sem fundos e sem tinta colorida em barras, avatares ou matriz.',
  },
];

export interface PdfTemplateDefinition {
  id: PdfTemplateId;
  label: string;
  subtitle: string;
  badge: string;
  preset: Omit<PdfExportOptions, 'footerText' | 'logoDataUrl' | 'templateId'>;
}

export const PDF_TEMPLATES: readonly PdfTemplateDefinition[] = [
  {
    id: 'complete',
    label: 'Completo',
    subtitle: 'KPIs, análise por fase, diagnóstico de questões, ranking e matriz cruzada.',
    badge: 'Padrão',
    preset: {
      sections: {
        overview: true,
        phases: true,
        ranking: true,
        matrix: true,
        questionQuality: true,
        aiReview: true,
        guessing: false,
        collusion: false,
      },
      questionQualityMode: 'full',
      inkSaverMode: 'original',
      sectionPerPage: true,
      density: 'comfortable',
    },
  },
  {
    id: 'summary',
    label: 'Resumo para coordenação',
    subtitle: 'Enxuto (1–2 págs): KPIs gerais, ranking da turma e destaques de questões.',
    badge: 'Compacto',
    preset: {
      sections: {
        overview: true,
        phases: false,
        ranking: true,
        matrix: true,
        questionQuality: false,
        aiReview: false,
        guessing: false,
        collusion: false,
      },
      questionQualityMode: 'highlights',
      inkSaverMode: 'original',
      sectionPerPage: true,
      density: 'compact',
    },
  },
  {
    id: 'pedagogical',
    label: 'Diagnóstico pedagógico',
    subtitle: 'Foco em revisão docente: KPIs, fases, qualidade psicométrica e revisão IA.',
    badge: 'Docente',
    preset: {
      sections: {
        overview: true,
        phases: true,
        ranking: false,
        matrix: false,
        questionQuality: true,
        aiReview: true,
        guessing: false,
        collusion: false,
      },
      questionQualityMode: 'full',
      inkSaverMode: 'original',
      sectionPerPage: true,
      density: 'comfortable',
    },
  },
];

export const DEFAULT_PDF_EXPORT_OPTIONS: PdfExportOptions = {
  templateId: 'complete',
  ...PDF_TEMPLATES[0].preset,
  sections: { ...PDF_TEMPLATES[0].preset.sections },
  footerText: '',
  logoDataUrl: null,
};

export interface SwitchOptionMeta {
  key: PdfPreviewKey;
  label: string;
  description: string;
  category: 'content' | 'pedagogical' | 'integrity' | 'layout';
}

export const SECTION_SWITCH_META: readonly SwitchOptionMeta[] = [
  {
    key: 'overview',
    label: 'Indicadores gerais (KPIs)',
    description: 'Quadro com participantes, média da turma, taxa global de acerto e tempo médio.',
    category: 'content',
  },
  {
    key: 'phases',
    label: 'Análise detalhada por fase',
    description:
      'Gráfico de barras de desempenho + enunciado, gabarito e distribuição de alternativas.',
    category: 'content',
  },
  {
    key: 'ranking',
    label: 'Classificação geral dos participantes',
    description: 'Tabela ordenada por pontuação com taxa de acerto, acertos/erros e tempo total.',
    category: 'content',
  },
  {
    key: 'matrix',
    label: 'Matriz cruzada (Aluno × Fase)',
    description: 'Grade compacta exibindo o resultado e pontos de cada aluno em todas as fases.',
    category: 'content',
  },
  {
    key: 'questionQuality',
    label: 'Diagnóstico de qualidade das questões',
    description:
      'Classificação fácil/difícil, índice de discriminação (D), tempo curto e tamanho de texto.',
    category: 'pedagogical',
  },
  {
    key: 'aiReview',
    label: 'Parecer pedagógico por IA',
    description:
      'Inclui apontamentos de ortografia, precisão conceitual, clareza e auditoria de gabarito.',
    category: 'pedagogical',
  },
  {
    key: 'guessing',
    label: 'Indícios de chute (confidencial docente)',
    description:
      'Lista respostas erradas muito rápidas (≤ 2s) ou marcadas no estouro do cronômetro.',
    category: 'integrity',
  },
  {
    key: 'collusion',
    label: 'Indícios de repasse / cola (confidencial docente)',
    description: 'Pares e agrupamentos com coincidência de erros raros e envios sequenciais (≤ 3s).',
    category: 'integrity',
  },
];

export const LAYOUT_SWITCH_META: readonly SwitchOptionMeta[] = [
  {
    key: 'inkSaver',
    label: 'Modo de economia de tinta',
    description:
      'Ajusta preenchimentos de barras, avatares e cores da matriz para impressão econômica ou monocromática.',
    category: 'layout',
  },
  {
    key: 'sectionPerPage',
    label: 'Uma seção por página',
    description:
      'Força quebra de página ao encerrar cada seção principal, iniciando a próxima no topo da folha seguinte.',
    category: 'layout',
  },
];

export function detectMatchingTemplate(
  options: Omit<PdfExportOptions, 'templateId' | 'footerText' | 'logoDataUrl'>,
): PdfTemplateId | 'custom' {
  for (const tpl of PDF_TEMPLATES) {
    const p = tpl.preset;
    if (
      p.inkSaverMode === options.inkSaverMode &&
      p.sectionPerPage === options.sectionPerPage &&
      p.density === options.density &&
      p.questionQualityMode === options.questionQualityMode &&
      p.sections.overview === options.sections.overview &&
      p.sections.phases === options.sections.phases &&
      p.sections.ranking === options.sections.ranking &&
      p.sections.matrix === options.sections.matrix &&
      p.sections.questionQuality === options.sections.questionQuality &&
      p.sections.aiReview === options.sections.aiReview &&
      p.sections.guessing === options.sections.guessing &&
      p.sections.collusion === options.sections.collusion
    ) {
      return tpl.id;
    }
  }
  return 'custom';
}

export function applyTemplate(
  current: PdfExportOptions,
  templateId: PdfTemplateId,
): PdfExportOptions {
  const found = PDF_TEMPLATES.find((t) => t.id === templateId) ?? PDF_TEMPLATES[0];
  return {
    ...current,
    templateId: found.id,
    sections: { ...found.preset.sections },
    questionQualityMode: found.preset.questionQualityMode,
    inkSaverMode: found.preset.inkSaverMode,
    sectionPerPage: found.preset.sectionPerPage,
    density: found.preset.density,
  };
}

export function estimatePageCount(report: MatchReport, options: PdfExportOptions): number {
  const s = options.sections;
  let pages = 0.35; // Cabeçalho
  if (s.overview) pages += 0.25;
  if (s.phases) {
    pages += 0.35 + report.phases.length * (options.density === 'compact' ? 0.24 : 0.32);
  }
  if (s.questionQuality) {
    const count =
      options.questionQualityMode === 'highlights'
        ? Math.max(1, Math.ceil(report.phases.length * 0.5))
        : report.phases.length;
    pages += 0.4 + count * (s.aiReview && report.aiReview ? 0.36 : 0.24);
  }
  if (s.ranking) {
    pages += 0.25 + report.participants.length * 0.055;
  }
  if (s.matrix) {
    pages += 0.25 + report.participants.length * 0.045;
  }
  if (s.guessing) pages += 0.45;
  if (s.collusion) pages += 0.45;

  if (options.sectionPerPage) {
    const activeMajorSections = [
      s.phases,
      s.questionQuality,
      s.ranking,
      s.matrix,
      s.guessing || s.collusion,
    ].filter(Boolean).length;
    pages = Math.max(pages, activeMajorSections + (s.overview ? 0.5 : 0));
  }

  return Math.max(1, Math.ceil(pages));
}
