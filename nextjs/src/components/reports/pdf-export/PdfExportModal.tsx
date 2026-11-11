'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { MatchReport } from '@/lib/types';
import { processLogoImageFile } from './logoImage';
import {
  applyTemplate,
  detectMatchingTemplate,
  estimatePageCount,
  INK_SAVER_MODE_OPTIONS,
  PDF_TEMPLATES,
  SECTION_SWITCH_META,
  type InkSaverMode,
  type PdfExportOptions,
  type PdfPreviewKey,
  type PdfTemplateId,
  type ReportSectionId,
} from './pdfExportOptions';
import { resetPdfExportOptionsStorage, savePdfExportOptions } from './pdfExportStorage';
import { PdfOptionPreview } from './PdfOptionPreview';
import { PdfTemplateThumb } from './PdfTemplateThumb';
import styles from './PdfExportModal.module.css';

export interface PdfExportModalProps {
  open: boolean;
  report: MatchReport;
  initialOptions: PdfExportOptions;
  isExporting?: boolean;
  onClose: () => void;
  onConfirmExport: (options: PdfExportOptions) => void;
  onOptionsChange?: (options: PdfExportOptions) => void;
}

export function PdfExportModal({
  open,
  report,
  initialOptions,
  isExporting = false,
  onClose,
  onConfirmExport,
  onOptionsChange,
}: PdfExportModalProps) {
  const [options, setOptions] = useState<PdfExportOptions>(initialOptions);
  const [activePreviewKey, setActivePreviewKey] = useState<PdfPreviewKey>('overview');
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setOptions(initialOptions);
      setLogoError(null);
    }
  }, [open, initialOptions]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isExporting) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isExporting, onClose]);

  const estimatedPages = useMemo(() => estimatePageCount(report, options), [report, options]);

  const hasAnySectionSelected = useMemo(
    () => Object.values(options.sections).some(Boolean),
    [options.sections],
  );

  const selectedInkSaverMeta = useMemo(
    () =>
      INK_SAVER_MODE_OPTIONS.find((opt) => opt.value === options.inkSaverMode) ??
      INK_SAVER_MODE_OPTIONS[0],
    [options.inkSaverMode],
  );

  if (!open) return null;

  function updateOptions(updater: (prev: PdfExportOptions) => PdfExportOptions) {
    setOptions((prev) => {
      const next = updater(prev);
      const matched = detectMatchingTemplate({
        sections: next.sections,
        questionQualityMode: next.questionQualityMode,
        inkSaverMode: next.inkSaverMode,
        sectionPerPage: next.sectionPerPage,
        density: next.density,
      });
      const finalOptions: PdfExportOptions = {
        ...next,
        templateId: matched,
      };
      savePdfExportOptions(finalOptions);
      onOptionsChange?.(finalOptions);
      return finalOptions;
    });
  }

  function handleSelectTemplate(templateId: PdfTemplateId) {
    setOptions((prev) => {
      const next = applyTemplate(prev, templateId);
      savePdfExportOptions(next);
      onOptionsChange?.(next);
      return next;
    });
  }

  function handleToggleSection(sectionId: ReportSectionId) {
    setActivePreviewKey(sectionId);
    updateOptions((prev) => ({
      ...prev,
      sections: {
        ...prev.sections,
        [sectionId]: !prev.sections[sectionId],
      },
    }));
  }

  function handleChangeInkSaverMode(mode: InkSaverMode) {
    setActivePreviewKey('inkSaver');
    updateOptions((prev) => ({
      ...prev,
      inkSaverMode: mode,
    }));
  }

  function handleToggleSectionPerPage() {
    setActivePreviewKey('sectionPerPage');
    updateOptions((prev) => ({
      ...prev,
      sectionPerPage: !prev.sectionPerPage,
    }));
  }

  async function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setLogoError(null);
    try {
      const pngDataUrl = await processLogoImageFile(file);
      updateOptions((prev) => ({
        ...prev,
        logoDataUrl: pngDataUrl,
      }));
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Erro ao processar logo.');
    }
  }

  function handleResetDefaults() {
    const defaults = resetPdfExportOptionsStorage();
    setOptions(defaults);
    onOptionsChange?.(defaults);
    setLogoError(null);
  }

  function handleConfirm() {
    if (!hasAnySectionSelected || isExporting) return;
    savePdfExportOptions(options);
    onConfirmExport(options);
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isExporting) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-export-modal-title"
      >
        <header className={styles.header}>
          <div className={styles.headerTitles}>
            <h2 id="pdf-export-modal-title" className={styles.title}>
              Personalizar Exportação para PDF
            </h2>
            <p className={styles.subtitle}>
              Escolha um modelo pré-definido ou personalize seções, nível de economia de tinta,
              quebras de página, logo da instituição e rodapé.
            </p>
          </div>

          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={isExporting}
            aria-label="Fechar modal"
          >
            <Icon.Close size={16} />
          </button>
        </header>

        <div className={styles.scrollBody}>
          {/* 3 Modelos Templates no estilo preview de fase */}
          <section className={styles.templatesBlock} aria-label="Modelos pré-definidos">
            <div className={styles.blockHeadingRow}>
              <h3 className={styles.blockHeading}>Modelos Pré-Definidos (Templates)</h3>
              {options.templateId === 'custom' && (
                <span className={styles.customIndicator}>✦ Modo Personalizado Ativo</span>
              )}
            </div>

            <div className={styles.templatesGrid}>
              {PDF_TEMPLATES.map((tpl) => {
                const isActive = options.templateId === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    className={cx(styles.templateCard, isActive && styles.templateCardActive)}
                    onClick={() => handleSelectTemplate(tpl.id)}
                  >
                    <PdfTemplateThumb templateId={tpl.id} active={isActive} />
                    <div className={styles.templateMeta}>
                      <div className={styles.templateTitleRow}>
                        <span className={styles.templateName}>{tpl.label}</span>
                        <span className={styles.templateBadge}>{tpl.badge}</span>
                      </div>
                      <p className={styles.templateDesc}>{tpl.subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Corpo 2 Colunas: Switches à esquerda + Preview animado e Identidade Visual à direita */}
          <div className={styles.mainGrid}>
            <div className={styles.switchesCol}>
              <div className={styles.switchGroup}>
                <h3 className={styles.blockHeading}>Seções do Relatório</h3>
                {SECTION_SWITCH_META.map((item) => {
                  const sectionKey = item.key as ReportSectionId;
                  const checked = options.sections[sectionKey];
                  const isFocused = activePreviewKey === item.key;

                  return (
                    <div key={item.key}>
                      <div
                        className={cx(styles.switchRow, isFocused && styles.switchRowActive)}
                        onMouseEnter={() => setActivePreviewKey(item.key)}
                        onFocus={() => setActivePreviewKey(item.key)}
                        onClick={() => handleToggleSection(sectionKey)}
                      >
                        <div className={styles.switchTextCol}>
                          <span className={styles.switchLabel}>{item.label}</span>
                          <span className={styles.switchHint}>{item.description}</span>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          aria-label={item.label}
                          className={cx(styles.toggleTrack, checked && styles.toggleTrackOn)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSection(sectionKey);
                          }}
                        >
                          <span className={styles.toggleThumb} />
                        </button>
                      </div>

                      {sectionKey === 'questionQuality' && checked && (
                        <div className={styles.subModeRow}>
                          <span>Detalhamento das questões no PDF:</span>
                          <div className={styles.segmented}>
                            <button
                              type="button"
                              className={cx(
                                styles.segmentBtn,
                                options.questionQualityMode === 'full' && styles.segmentBtnActive,
                              )}
                              onClick={() =>
                                updateOptions((prev) => ({
                                  ...prev,
                                  questionQualityMode: 'full',
                                }))
                              }
                            >
                              Todas ({report.phases.length})
                            </button>
                            <button
                              type="button"
                              className={cx(
                                styles.segmentBtn,
                                options.questionQualityMode === 'highlights' &&
                                  styles.segmentBtnActive,
                              )}
                              onClick={() =>
                                updateOptions((prev) => ({
                                  ...prev,
                                  questionQualityMode: 'highlights',
                                }))
                              }
                            >
                              Apenas alertas
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className={styles.switchGroup}>
                <h3 className={styles.blockHeading}>Impressão & Paginação</h3>

                {/* Dropdown de Modo de Economia de Tinta */}
                <div
                  className={cx(
                    styles.switchRow,
                    activePreviewKey === 'inkSaver' && styles.switchRowActive,
                  )}
                  onMouseEnter={() => setActivePreviewKey('inkSaver')}
                  onFocus={() => setActivePreviewKey('inkSaver')}
                >
                  <div className={styles.switchTextCol}>
                    <label htmlFor="pdf-ink-saver-select" className={styles.switchLabel}>
                      Modo de economia de tinta
                    </label>
                    <span className={styles.switchHint}>{selectedInkSaverMeta.description}</span>
                  </div>

                  <select
                    id="pdf-ink-saver-select"
                    className={styles.selectControl}
                    value={options.inkSaverMode}
                    onChange={(e) => handleChangeInkSaverMode(e.target.value as InkSaverMode)}
                  >
                    {INK_SAVER_MODE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.shortLabel}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Switch: Uma seção por página */}
                <div
                  className={cx(
                    styles.switchRow,
                    activePreviewKey === 'sectionPerPage' && styles.switchRowActive,
                  )}
                  onMouseEnter={() => setActivePreviewKey('sectionPerPage')}
                  onFocus={() => setActivePreviewKey('sectionPerPage')}
                  onClick={handleToggleSectionPerPage}
                >
                  <div className={styles.switchTextCol}>
                    <span className={styles.switchLabel}>Uma seção por página</span>
                    <span className={styles.switchHint}>
                      Força quebra de página ao encerrar cada seção principal, iniciando a próxima
                      no topo da folha seguinte.
                    </span>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={options.sectionPerPage}
                    aria-label="Uma seção por página"
                    className={cx(
                      styles.toggleTrack,
                      options.sectionPerPage && styles.toggleTrackOn,
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleSectionPerPage();
                    }}
                  >
                    <span className={styles.toggleThumb} />
                  </button>
                </div>
              </div>
            </div>

            {/* Coluna Direita: Stage Animado + Logo da Escola + Rodapé Personalizado */}
            <div className={styles.rightCol}>
              <PdfOptionPreview
                activeKey={activePreviewKey}
                options={options}
                estimatedPages={estimatedPages}
              />

              <div className={styles.brandingCard}>
                <h3 className={styles.blockHeading}>Identidade Institucional & Rodapé</h3>

                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Logo da Escola / Instituição (opcional)</span>
                  <div className={styles.logoUploadRow}>
                    <div className={styles.logoPreviewBox}>
                      {options.logoDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={options.logoDataUrl}
                          alt="Logo da instituição"
                          className={styles.logoPreviewImg}
                        />
                      ) : (
                        <span className={styles.logoPlaceholder}>Sem logo</span>
                      )}
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className={styles.fileInputHidden}
                      onChange={(e) => void handleLogoFileChange(e)}
                    />

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {options.logoDataUrl ? 'Trocar logo' : 'Enviar logo'}
                    </Button>

                    {options.logoDataUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateOptions((prev) => ({
                            ...prev,
                            logoDataUrl: null,
                          }))
                        }
                      >
                        Remover
                      </Button>
                    )}
                  </div>
                  {logoError && <span className={styles.logoError}>{logoError}</span>}
                </div>

                <div className={styles.fieldGroup}>
                  <label htmlFor="pdf-custom-footer-input" className={styles.fieldLabel}>
                    Rodapé personalizado (todas as páginas)
                  </label>
                  <input
                    id="pdf-custom-footer-input"
                    type="text"
                    maxLength={140}
                    className={styles.textInput}
                    placeholder="Ex.: Colégio São Bento — Prof. Marcos — 3º Bimestre"
                    value={options.footerText}
                    onChange={(e) =>
                      updateOptions((prev) => ({
                        ...prev,
                        footerText: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className={styles.footer}>
          <div className={styles.footerLeft}>
            <span className={styles.estimateText}>
              Volume estimado: <strong>~{estimatedPages} página(s) A4</strong>
              {!hasAnySectionSelected && (
                <strong style={{ color: '#dc2626', marginLeft: 8 }}>
                  · Selecione ao menos 1 seção
                </strong>
              )}
            </span>
            <button type="button" className={styles.resetBtn} onClick={handleResetDefaults}>
              Restaurar padrão
            </button>
          </div>

          <div className={styles.footerActions}>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={isExporting}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={!hasAnySectionSelected || isExporting}
              onClick={handleConfirm}
            >
              <Icon.Download size={15} />
              {isExporting ? 'Gerando PDF...' : 'Exportar PDF'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
