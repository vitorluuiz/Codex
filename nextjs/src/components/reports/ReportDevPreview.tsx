'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Button, Toast, ToastViewport } from '@/components/ds';
import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import type { IndividualReport, MatchReport } from '@/lib/types';
import { exportHtmlElementToPdf } from './exportHtmlToPdf';
import { IndividualReportExportDocument } from './IndividualReportExportDocument';
import { MatchReportExportDocument } from './MatchReportExportDocument';
import { PdfExportModal } from './pdf-export/PdfExportModal';
import {
  DEFAULT_PDF_EXPORT_OPTIONS,
  type PdfExportOptions,
} from './pdf-export/pdfExportOptions';
import { loadPdfExportOptions } from './pdf-export/pdfExportStorage';
import { MOCK_DEV_INDIVIDUAL_REPORT, MOCK_DEV_MATCH_REPORT } from './reportMockData';
import styles from './ReportDevPreview.module.css';

type DocumentKind = 'match' | 'individual';
type ViewMode = 'continuous' | 'pages';

interface ReportDevPreviewProps {
  initialReport?: MatchReport | null;
  initialIndividualReport?: IndividualReport | null;
  backHref?: string;
}

export function ReportDevPreview({
  initialReport,
  initialIndividualReport,
  backHref,
}: ReportDevPreviewProps) {
  const [docKind, setDocKind] = useState<DocumentKind>('match');
  const [viewMode, setViewMode] = useState<ViewMode>('continuous');
  const [pdfOptions, setPdfOptions] = useState<PdfExportOptions>(DEFAULT_PDF_EXPORT_OPTIONS);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const documentRef = useRef<HTMLDivElement | null>(null);

  const matchReport = initialReport ?? MOCK_DEV_MATCH_REPORT;
  const individualReport = initialIndividualReport ?? MOCK_DEV_INDIVIDUAL_REPORT;

  useEffect(() => {
    setPdfOptions(loadPdfExportOptions());
  }, []);

  async function handleDownloadPdf(optionsOverride?: PdfExportOptions) {
    if (!documentRef.current || isDownloading) return;
    const activeOpts = optionsOverride ?? pdfOptions;
    if (optionsOverride) {
      setPdfOptions(optionsOverride);
      setIsModalOpen(false);
    }

    setIsDownloading(true);
    setToast('Capturando documento e gerando PDF A4...');

    try {
      await new Promise((r) => setTimeout(r, 80));
      if (docKind === 'match') {
        await exportHtmlElementToPdf(documentRef.current, {
          filename: `relatorio-${matchReport.roomCode}-dev-preview.pdf`,
          footerTitle: `${matchReport.title} (Sala ${matchReport.roomCode})`,
          footerText: activeOpts.footerText,
          footerLogoDataUrl: activeOpts.logoDataUrl,
          honorForcedBreaks: activeOpts.sectionPerPage,
        });
      } else {
        await exportHtmlElementToPdf(documentRef.current, {
          filename: `meu-relatorio-${individualReport.roomCode}-${individualReport.participant.displayName}.pdf`,
          footerTitle: `${individualReport.participant.displayName} · ${individualReport.title}`,
        });
      }
      setToast('PDF exportado com sucesso!');
    } catch (err) {
      console.error('Falha ao exportar PDF:', err);
      setToast('Erro ao exportar PDF. Verifique o console.');
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className={styles.previewCanvas}>
      {/* Barra de Ferramentas Fixa no Topo */}
      <header className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {backHref ? (
            <Link href={backHref} className={styles.backButton}>
              <Icon.ArrowLeft size={16} />
              Voltar ao relatório
            </Link>
          ) : (
            <div className={styles.brandGroup}>
              <span className={styles.badgeDev}>Dev Preview</span>
              <span className={styles.docTitle}>Visualizador de Exportação A4</span>
            </div>
          )}

          {/* Alternador de Documento */}
          <div className={styles.segmentedControl} role="tablist">
            <button
              type="button"
              className={cx(
                styles.segmentBtn,
                docKind === 'match' && styles.segmentBtnActive,
              )}
              onClick={() => setDocKind('match')}
            >
              Relatório da Partida (Líder)
            </button>
            <button
              type="button"
              className={cx(
                styles.segmentBtn,
                docKind === 'individual' && styles.segmentBtnActive,
              )}
              onClick={() => setDocKind('individual')}
            >
              Relatório Individual (Aluno)
            </button>
          </div>
        </div>

        <div className={styles.toolbarRight}>
          {/* Alternador de Modo de Exibição */}
          <div className={styles.segmentedControl}>
            <button
              type="button"
              className={cx(
                styles.segmentBtn,
                viewMode === 'continuous' && styles.segmentBtnActive,
              )}
              onClick={() => setViewMode('continuous')}
              title="Exibe o documento em fluxo contínuo"
            >
              Fluxo Contínuo
            </button>
            <button
              type="button"
              className={cx(
                styles.segmentBtn,
                viewMode === 'pages' && styles.segmentBtnActive,
              )}
              onClick={() => setViewMode('pages')}
              title="Simula as quebras aproximadas de folha A4"
            >
              Guias A4
            </button>
          </div>

          {docKind === 'match' && (
            <>
              <div className={styles.segmentedControl} title="Alternar modo de economia de tinta">
                <button
                  type="button"
                  className={cx(
                    styles.segmentBtn,
                    pdfOptions.inkSaverMode === 'original' && styles.segmentBtnActive,
                  )}
                  onClick={() =>
                    setPdfOptions((prev) => ({ ...prev, inkSaverMode: 'original' }))
                  }
                >
                  Original
                </button>
                <button
                  type="button"
                  className={cx(
                    styles.segmentBtn,
                    pdfOptions.inkSaverMode === 'eco' && styles.segmentBtnActive,
                  )}
                  onClick={() => setPdfOptions((prev) => ({ ...prev, inkSaverMode: 'eco' }))}
                >
                  Economia de tinta
                </button>
                <button
                  type="button"
                  className={cx(
                    styles.segmentBtn,
                    pdfOptions.inkSaverMode === 'max' && styles.segmentBtnActive,
                  )}
                  onClick={() => setPdfOptions((prev) => ({ ...prev, inkSaverMode: 'max' }))}
                >
                  Economia máx.
                </button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsModalOpen(true)}
              >
                <Icon.Settings size={15} />
                Personalizar PDF
              </Button>
            </>
          )}

          <Button
            size="sm"
            disabled={isDownloading}
            onClick={() => void handleDownloadPdf()}
          >
            <Icon.Download size={15} />
            {isDownloading ? 'Gerando...' : 'Testar Download PDF'}
          </Button>
        </div>
      </header>

      {/* Dica de Hot-Reload */}
      <div className={styles.devNotice}>
        <span className={styles.noticeIcon}>⚡</span>
        <span>
          <strong>Hot-Reload Ativo:</strong> Edite{' '}
          <code>MatchReportExportDocument.tsx</code> ou{' '}
          <code>MatchReportExportDocument.module.css</code> no seu editor de código e
          veja o resultado atualizar nesta tela em tempo real sem recarregar!
        </span>
      </div>

      {/* Área da Prancheta / Papel */}
      <main className={styles.paperStage}>
        <div
          ref={documentRef}
          className={cx(
            styles.paperContainer,
            viewMode === 'pages' && styles.paperWithA4Guides,
          )}
        >
          {docKind === 'match' ? (
            <MatchReportExportDocument report={matchReport} options={pdfOptions} />
          ) : (
            <IndividualReportExportDocument report={individualReport} />
          )}
        </div>
      </main>

      <PdfExportModal
        open={isModalOpen}
        report={matchReport}
        initialOptions={pdfOptions}
        isExporting={isDownloading}
        onClose={() => setIsModalOpen(false)}
        onOptionsChange={setPdfOptions}
        onConfirmExport={(opts) => void handleDownloadPdf(opts)}
      />

      {toast && (
        <ToastViewport>
          <Toast
            tone="success"
            title="Exportação PDF"
            message={toast}
            onClose={() => setToast(null)}
          />
        </ToastViewport>
      )}
    </div>
  );
}
