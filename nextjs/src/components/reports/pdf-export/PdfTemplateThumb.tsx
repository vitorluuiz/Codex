'use client';

import { cx } from '@/lib/cx';
import type { PdfTemplateId } from './pdfExportOptions';
import styles from './PdfOptionPreview.module.css';

export interface PdfTemplateThumbProps {
  templateId: PdfTemplateId;
  active?: boolean;
}

/**
 * Miniatura esquemática em estilo wireframe (inspirada no PhaseThumb do editor de conjuntos)
 * representando visualmente as folhas A4 geradas por cada modelo pré-definido.
 */
export function PdfTemplateThumb({ templateId, active = false }: PdfTemplateThumbProps) {
  if (templateId === 'complete') {
    return (
      <div className={cx(styles.templateThumb, active && styles.templateThumbActive)} aria-hidden="true">
        {/* Página 1: KPIs + Gráfico de Fases */}
        <div className={styles.miniPage}>
          <div className={styles.miniBarHeader} />
          <div className={styles.miniKpiGrid}>
            <span className={styles.miniKpiCell} />
            <span className={styles.miniKpiCell} />
            <span className={styles.miniKpiCell} />
            <span className={styles.miniKpiCell} />
          </div>
          <div className={styles.miniChart}>
            <span className={styles.miniChartCol} style={{ height: '80%' }} />
            <span className={styles.miniChartCol} style={{ height: '55%' }} />
            <span className={styles.miniChartCol} style={{ height: '90%' }} />
            <span className={styles.miniChartCol} style={{ height: '40%' }} />
          </div>
        </div>

        {/* Página 2: Diagnóstico + IA */}
        <div className={styles.miniPage}>
          <div className={styles.miniBadgeRow}>
            <span className={styles.miniBadgeAmber} />
            <span className={styles.miniBadgeBlue} />
          </div>
          <div className={styles.miniLines}>
            <span className={styles.miniLine} />
            <span className={cx(styles.miniLine, styles.miniLineShort)} />
            <span className={styles.miniLine} />
            <span className={cx(styles.miniLine, styles.miniLineShort)} />
          </div>
        </div>

        {/* Página 3: Ranking + Matriz */}
        <div className={styles.miniPage}>
          <div className={styles.miniLines}>
            <span className={styles.miniLine} />
            <span className={styles.miniLine} />
          </div>
          <div className={styles.miniMatrix}>
            <span className={styles.miniMatrixCellOk} />
            <span className={styles.miniMatrixCellOk} />
            <span className={styles.miniMatrixCellErr} />
            <span className={styles.miniMatrixCellOk} />
            <span className={styles.miniMatrixCellErr} />
            <span className={styles.miniMatrixCellOk} />
            <span className={styles.miniMatrixCellOk} />
            <span className={styles.miniMatrixCellErr} />
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'summary') {
    return (
      <div className={cx(styles.templateThumb, active && styles.templateThumbActive)} aria-hidden="true">
        {/* Página 1 Compacta + Economia de Tinta */}
        <div className={cx(styles.miniPage, styles.miniPageInkSaver)}>
          <div className={styles.miniBarHeader} />
          <div className={styles.miniKpiGrid}>
            <span className={styles.miniKpiCell} style={{ background: '#f8fafc' }} />
            <span className={styles.miniKpiCell} style={{ background: '#f8fafc' }} />
            <span className={styles.miniKpiCell} style={{ background: '#f8fafc' }} />
            <span className={styles.miniKpiCell} style={{ background: '#f8fafc' }} />
          </div>
          <div className={styles.miniLines}>
            <span className={styles.miniLine} />
            <span className={styles.miniLine} />
            <span className={cx(styles.miniLine, styles.miniLineShort)} />
          </div>
        </div>

        {/* Página 2: Destaques curtos */}
        <div className={cx(styles.miniPage, styles.miniPageInkSaver)}>
          <div className={styles.miniBadgeRow}>
            <span className={styles.miniBadgeAmber} />
            <span className={styles.miniBadgeBlue} />
          </div>
          <div className={styles.miniLines}>
            <span className={styles.miniLine} />
            <span className={cx(styles.miniLine, styles.miniLineShort)} />
          </div>
        </div>

        {/* Página 3 economizada */}
        <div className={cx(styles.miniPage, styles.miniPageDim)} />
      </div>
    );
  }

  // pedagogical
  return (
    <div className={cx(styles.templateThumb, active && styles.templateThumbActive)} aria-hidden="true">
      {/* Página 1: Fases */}
      <div className={styles.miniPage}>
        <div className={styles.miniBarHeader} />
        <div className={styles.miniChart}>
          <span className={styles.miniChartCol} style={{ height: '85%' }} />
          <span className={styles.miniChartCol} style={{ height: '35%', background: '#ef4444' }} />
          <span className={styles.miniChartCol} style={{ height: '75%' }} />
        </div>
        <div className={styles.miniLines}>
          <span className={styles.miniLine} />
        </div>
      </div>

      {/* Página 2 (Nova folha): Diagnóstico Psicométrico */}
      <div className={styles.miniPage}>
        <div className={styles.miniBadgeRow}>
          <span className={styles.miniBadgeAmber} />
          <span className={styles.miniBadgeBlue} />
        </div>
        <div className={styles.miniLines}>
          <span className={styles.miniLine} />
          <span className={cx(styles.miniLine, styles.miniLineShort)} />
          <span className={styles.miniLine} />
        </div>
      </div>

      {/* Página 3 (Nova folha): Revisão IA */}
      <div className={styles.miniPage}>
        <div className={styles.miniBadgeRow}>
          <span className={styles.miniBadgeBlue} />
        </div>
        <div className={styles.miniLines}>
          <span className={styles.miniLine} style={{ background: '#93c5fd' }} />
          <span className={styles.miniLine} />
          <span className={cx(styles.miniLine, styles.miniLineShort)} />
        </div>
      </div>
    </div>
  );
}
