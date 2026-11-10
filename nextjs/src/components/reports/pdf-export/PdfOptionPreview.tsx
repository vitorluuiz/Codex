'use client';

import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import {
  INK_SAVER_MODE_OPTIONS,
  LAYOUT_SWITCH_META,
  SECTION_SWITCH_META,
  type InkSaverMode,
  type PdfExportOptions,
  type PdfPreviewKey,
} from './pdfExportOptions';
import styles from './PdfOptionPreview.module.css';

export interface PdfOptionPreviewProps {
  activeKey: PdfPreviewKey;
  options: PdfExportOptions;
  estimatedPages: number;
}

const ALL_META = [...SECTION_SWITCH_META, ...LAYOUT_SWITCH_META];

export function PdfOptionPreview({
  activeKey,
  options,
  estimatedPages,
}: PdfOptionPreviewProps) {
  const meta = ALL_META.find((m) => m.key === activeKey) ?? SECTION_SWITCH_META[0];
  const inkMeta =
    INK_SAVER_MODE_OPTIONS.find((m) => m.value === options.inkSaverMode) ??
    INK_SAVER_MODE_OPTIONS[0];

  const isEnabled =
    activeKey === 'inkSaver'
      ? true
      : activeKey === 'sectionPerPage'
        ? options.sectionPerPage
        : options.sections[activeKey];

  const statusText =
    activeKey === 'inkSaver'
      ? inkMeta.shortLabel
      : isEnabled
        ? 'Ativado no PDF'
        : 'Oculto no PDF';

  return (
    <div className={styles.previewStage}>
      <div className={styles.stageHeader}>
        <span className={styles.stageBadge}>
          <Icon.Eye size={12} /> Prévia Interativa
        </span>
        <span className={styles.stagePagesTag}>~{estimatedPages} pág. A4</span>
      </div>

      <div className={styles.canvasArea} aria-hidden="true">
        {activeKey === 'sectionPerPage' ? (
          <div className={styles.dualSheets}>
            <div className={styles.miniSplitSheet}>
              <div className={styles.a4TitleBar} style={{ width: '55%', background: '#2563eb' }} />
              <div className={styles.animRankList}>
                <div className={styles.animRankRow} />
                <div className={styles.animRankRow} />
              </div>
              <div className={styles.breakDivider} title="Quebra de página forçada" />
              <span style={{ fontSize: 8, color: '#dc2626', fontWeight: 700 }}>
                ✂ Fim da Seção 1
              </span>
            </div>

            <div className={styles.miniSplitSheet}>
              <div className={styles.a4TitleBar} style={{ width: '60%', background: '#16a34a' }} />
              <span style={{ fontSize: 8, color: '#15803d', fontWeight: 700 }}>
                Topo da Pág. 2 → Seção 2
              </span>
              <div className={styles.animMatrixGrid}>
                <span className={styles.animMatrixCell} style={{ background: '#86efac' }} />
                <span className={styles.animMatrixCell} style={{ background: '#86efac' }} />
                <span className={styles.animMatrixCell} style={{ background: '#fca5a5' }} />
                <span className={styles.animMatrixCell} style={{ background: '#86efac' }} />
                <span className={styles.animMatrixCell} style={{ background: '#86efac' }} />
              </div>
            </div>
          </div>
        ) : (
          <div
            className={cx(
              styles.a4Sheet,
              options.inkSaverMode !== 'original' && styles.a4SheetInkSaver,
            )}
            style={{ opacity: isEnabled ? 1 : 0.55 }}
          >
            <div className={styles.a4TopHeader}>
              <div className={styles.a4TitleLines}>
                <div className={styles.a4TitleBar} />
                <div className={styles.a4SubBar} />
              </div>
              {options.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={options.logoDataUrl}
                  alt="Logo da escola"
                  className={styles.a4LogoThumb}
                />
              ) : (
                <span className={styles.a4BrandDot}>Codex</span>
              )}
            </div>

            <div className={styles.a4Body}>
              {renderBodyIllustration(activeKey, options.inkSaverMode)}
            </div>

            <div className={styles.a4Footer}>
              <span>{options.footerText.trim() || 'Relatório Codex · Sala'}</span>
              <span>Pág. 1 / {estimatedPages}</span>
            </div>
          </div>
        )}
      </div>

      <div className={styles.stageCaption}>
        <h4 className={styles.stageCaptionTitle}>
          {meta.label}{' '}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: isEnabled ? '#15803d' : '#64748b',
              marginLeft: 6,
            }}
          >
            ({statusText})
          </span>
        </h4>
        <p className={styles.stageCaptionText}>
          {activeKey === 'inkSaver' ? inkMeta.description : meta.description}
        </p>
      </div>
    </div>
  );
}

function renderBodyIllustration(key: PdfPreviewKey, inkMode: InkSaverMode) {
  const isOriginal = inkMode === 'original';
  const isEco = inkMode === 'eco';

  switch (key) {
    case 'overview':
      return (
        <div className={styles.animKpiGrid}>
          {[
            '#2563eb',
            '#16a34a',
            '#d97706',
            '#2563eb',
          ].map((color, idx) => (
            <div
              key={idx}
              className={styles.animKpiCard}
              style={{
                background: isOriginal ? '#eff6ff' : '#ffffff',
                borderColor: isOriginal ? '#bfdbfe' : '#94a3b8',
              }}
            >
              <span
                className={styles.animKpiValue}
                style={{ background: inkMode === 'max' ? '#0f172a' : color }}
              />
              <span className={styles.animKpiSub} />
            </div>
          ))}
        </div>
      );

    case 'phases':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            className={styles.animBarChart}
            style={{
              background: isOriginal ? '#f8fafc' : '#ffffff',
              height: 44,
            }}
          >
            {[
              { h: '82%', c: '#16a34a', d: '0s' },
              { h: '48%', c: '#f59e0b', d: '0.2s' },
              { h: '92%', c: '#16a34a', d: '0.4s' },
              { h: '35%', c: '#dc2626', d: '0.6s' },
            ].map((b, idx) => (
              <div
                key={idx}
                className={styles.animBar}
                style={{
                  height: b.h,
                  animationDelay: b.d,
                  background: isOriginal ? b.c : 'transparent',
                  border: isOriginal
                    ? 'none'
                    : `1.5px solid ${inkMode === 'max' ? '#0f172a' : b.c}`,
                }}
              />
            ))}
          </div>

          {/* Linha de distribuição de alternativa com marcador vertical no fim */}
          <div
            style={{
              height: 8,
              borderRadius: 4,
              background: isOriginal ? '#e2e8f0' : 'transparent',
              borderBottom: isOriginal ? 'none' : '1px dashed #94a3b8',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: '68%',
                height: '100%',
                background: isOriginal ? '#16a34a' : 'transparent',
                borderRight: isOriginal
                  ? 'none'
                  : `2.5px solid ${inkMode === 'max' ? '#0f172a' : '#16a34a'}`,
              }}
            />
          </div>
        </div>
      );

    case 'ranking':
      return (
        <div className={styles.animRankList}>
          {[
            { c: '#eab308', w: '55%' },
            { c: '#94a3b8', w: '48%' },
            { c: '#d97706', w: '40%' },
          ].map((row, idx) => (
            <div
              key={idx}
              className={styles.animRankRow}
              style={{ background: isOriginal ? '#f8fafc' : '#ffffff' }}
            >
              <span
                className={styles.animRankMedal}
                style={{
                  background: isOriginal ? row.c : 'transparent',
                  border: isOriginal
                    ? 'none'
                    : `1.5px solid ${inkMode === 'max' ? '#334155' : row.c}`,
                }}
              />
              <span className={styles.a4TitleBar} style={{ width: row.w }} />
            </div>
          ))}
        </div>
      );

    case 'matrix':
      return (
        <div
          className={styles.animMatrixGrid}
          style={{ background: isOriginal ? '#f8fafc' : '#ffffff' }}
        >
          {[
            true,
            true,
            false,
            true,
            true,
            true,
            false,
            true,
            true,
            true,
            false,
            true,
            false,
            true,
            true,
          ].map((ok, i) => (
            <span
              key={i}
              className={styles.animMatrixCell}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 6.5,
                fontWeight: 800,
                background: isOriginal ? (ok ? '#dcfce7' : '#fee2e2') : '#ffffff',
                border: isOriginal
                  ? 'none'
                  : isEco
                    ? `1.5px solid ${ok ? '#16a34a' : '#dc2626'}`
                    : '1px solid #94a3b8',
                color:
                  inkMode === 'max'
                    ? '#0f172a'
                    : ok
                      ? '#15803d'
                      : '#dc2626',
              }}
            >
              {ok ? '✓10' : '✗0'}
            </span>
          ))}
        </div>
      );

    case 'questionQuality':
      return (
        <div className={styles.animRankList}>
          <div
            className={styles.animRankRow}
            style={{ background: isOriginal ? '#fef2f2' : '#ffffff', borderColor: '#fecaca' }}
          >
            <span style={{ fontSize: 8, fontWeight: 800, color: '#dc2626' }}>F2 · Difícil</span>
            <span style={{ fontSize: 7, color: '#991b1b' }}>D = -0.18 · Tempo curto</span>
          </div>
          <div
            className={styles.animRankRow}
            style={{ background: isOriginal ? '#fffbeb' : '#ffffff', borderColor: '#fde68a' }}
          >
            <span style={{ fontSize: 8, fontWeight: 800, color: '#b45309' }}>F4 · Texto longo</span>
            <span style={{ fontSize: 7, color: '#92400e' }}>Leitura &gt; 50% timer</span>
          </div>
          <div
            className={styles.animRankRow}
            style={{ background: isOriginal ? '#f0fdf4' : '#ffffff', borderColor: '#bbf7d0' }}
          >
            <span style={{ fontSize: 8, fontWeight: 800, color: '#15803d' }}>F1 · Fácil</span>
            <span style={{ fontSize: 7, color: '#166534' }}>D = +0.52 · Calibrada</span>
          </div>
        </div>
      );

    case 'aiReview':
      return (
        <div
          className={styles.animAiBox}
          style={{ background: isOriginal ? '#eff6ff' : '#ffffff' }}
        >
          <div className={styles.animAiShimmer} />
          <span style={{ fontSize: 8, fontWeight: 800, color: '#1d4ed8' }}>
            ✦ Revisão Pedagógica IA
          </span>
          <span className={styles.a4TitleBar} style={{ width: '85%', background: '#3b82f6' }} />
          <span className={styles.a4SubBar} style={{ width: '70%', background: '#60a5fa' }} />
          <span style={{ fontSize: 7, color: '#1e40af' }}>
            ✓ Ortografia · ✓ Conceito · ✓ Gabarito
          </span>
        </div>
      );

    case 'guessing':
      return (
        <div className={styles.animRankList}>
          <div
            className={styles.animRankRow}
            style={{ background: isOriginal ? '#fff7ed' : '#ffffff', borderColor: '#fed7aa' }}
          >
            <span style={{ fontSize: 8, fontWeight: 800, color: '#c2410c' }}>⚡ 1,2s (Erro)</span>
            <span style={{ fontSize: 7, color: '#9a3412' }}>Chute antes da leitura</span>
          </div>
          <div
            className={styles.animRankRow}
            style={{ background: isOriginal ? '#fefce8' : '#ffffff', borderColor: '#fef08a' }}
          >
            <span style={{ fontSize: 8, fontWeight: 800, color: '#a16207' }}>⏱ 29s / 30s</span>
            <span style={{ fontSize: 7, color: '#854d0e' }}>Erro no estouro final</span>
          </div>
        </div>
      );

    case 'collusion':
      return (
        <div className={styles.animRankList}>
          <div
            className={styles.animRankRow}
            style={{ background: isOriginal ? '#fef2f2' : '#ffffff', borderColor: '#fecaca' }}
          >
            <span style={{ fontSize: 8, fontWeight: 800, color: '#b91c1c' }}>
              Aluno A ↔ Aluno B
            </span>
          </div>
          <div className={styles.animRankRow}>
            <span style={{ fontSize: 7, color: '#475569' }}>
              4 erros raros idênticos · Δt = 1,4s
            </span>
          </div>
        </div>
      );

    case 'inkSaver':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {/* 1. Mini barras vazadas vs preenchidas */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 4,
              height: 28,
              padding: '2px 4px',
              borderBottom: '1px solid #cbd5e1',
            }}
          >
            {[
              { h: '90%', c: '#16a34a' },
              { h: '55%', c: '#d97706' },
              { h: '75%', c: '#2563eb' },
            ].map((b, idx) => (
              <div
                key={idx}
                style={{
                  flex: 1,
                  height: b.h,
                  borderRadius: '2px 2px 0 0',
                  background: isOriginal ? b.c : 'transparent',
                  border: isOriginal
                    ? 'none'
                    : `1.5px solid ${inkMode === 'max' ? '#0f172a' : b.c}`,
                }}
              />
            ))}
          </div>

          {/* 2. Linha de distribuição com marcador vertical */}
          <div
            style={{
              height: 6,
              background: isOriginal ? '#e2e8f0' : 'transparent',
              borderBottom: isOriginal ? 'none' : '1px dashed #94a3b8',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: '72%',
                height: isOriginal ? '100%' : 9,
                marginTop: isOriginal ? 0 : -2,
                background: isOriginal ? '#16a34a' : 'transparent',
                borderRight: isOriginal
                  ? 'none'
                  : `2.5px solid ${inkMode === 'max' ? '#0f172a' : '#16a34a'}`,
              }}
            />
          </div>

          {/* 3. Avatar sem fundo + Matriz com bordas coloridas (eco) ou P&B (max) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: isOriginal ? '#3b82f6' : 'transparent',
                border: isOriginal ? 'none' : '1.5px solid #475569',
                display: 'inline-block',
              }}
              title="Avatar sem fundo"
            />
            <div style={{ display: 'flex', gap: 3 }}>
              <span
                style={{
                  padding: '1px 5px',
                  fontSize: 7,
                  fontWeight: 800,
                  borderRadius: 3,
                  background: isOriginal ? '#dcfce7' : '#ffffff',
                  border: isOriginal
                    ? 'none'
                    : isEco
                      ? '1.5px solid #16a34a'
                      : '1px solid #475569',
                  color: inkMode === 'max' ? '#0f172a' : '#15803d',
                }}
              >
                ✓ 100
              </span>
              <span
                style={{
                  padding: '1px 5px',
                  fontSize: 7,
                  fontWeight: 800,
                  borderRadius: 3,
                  background: isOriginal ? '#fee2e2' : '#ffffff',
                  border: isOriginal
                    ? 'none'
                    : isEco
                      ? '1.5px solid #dc2626'
                      : '1px solid #475569',
                  color: inkMode === 'max' ? '#0f172a' : '#b91c1c',
                }}
              >
                ✗ 0
              </span>
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}
