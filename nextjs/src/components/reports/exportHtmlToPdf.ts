'use client';

export interface ExportHtmlToPdfOptions {
  /** Nome do arquivo final (ex.: relatorio-AB12CD.pdf) */
  filename: string;
  /** Título exibido no rodapé de paginação */
  footerTitle?: string;
  /** Texto personalizado adicional para o rodapé de todas as páginas */
  footerText?: string;
  /** Data URL PNG opcional do logo da instituição para o rodapé */
  footerLogoDataUrl?: string | null;
  /** Se verdadeiro, respeita quebras de página explícitas em `[data-pdf-page-break-before]` */
  honorForcedBreaks?: boolean;
}

interface BlockBounds {
  top: number;
  bottom: number;
}

/**
 * Calcula as faixas verticais (em pixels do elemento original) para cada página A4,
 * evitando cortar ao meio elementos marcados com `[data-pdf-keep-together]` e
 * respeitando quebras de seção forçadas em `[data-pdf-page-break-before]`.
 */
function computePageSlices(
  totalHeightPx: number,
  maxPageHeightPx: number,
  blocks: BlockBounds[],
  forcedBreakYs: number[],
): Array<{ startY: number; endY: number }> {
  const slices: Array<{ startY: number; endY: number }> = [];
  const minSliceRatio = 0.35;
  let currentY = 0;

  while (currentY < totalHeightPx - 2) {
    const idealEndY = currentY + maxPageHeightPx;

    // 1. Verifica se há uma quebra de página explícita (ex.: Uma seção por página) dentro desta folha
    const nextForcedBreak = forcedBreakYs.find(
      (y) => y > currentY + 32 && y <= idealEndY - 4,
    );
    if (nextForcedBreak !== undefined) {
      const forcedCut = Math.max(currentY + 16, Math.floor(nextForcedBreak - 6));
      slices.push({ startY: currentY, endY: forcedCut });
      currentY = forcedCut;
      continue;
    }

    if (idealEndY >= totalHeightPx - 2) {
      slices.push({ startY: currentY, endY: totalHeightPx });
      break;
    }

    let cutY = idealEndY;

    // 2. Procura o primeiro bloco indivisível que é atravessado pela linha de corte ideal
    for (const block of blocks) {
      const straddlesCut = block.top < idealEndY - 2 && block.bottom > idealEndY + 2;
      if (!straddlesCut) continue;

      const blockHeight = block.bottom - block.top;
      const candidateCut = Math.floor(block.top - 6);

      // Só antecipa a quebra se o bloco couber inteiro na próxima página
      // e a página atual já tiver pelo menos 35% de altura preenchida
      if (
        blockHeight <= maxPageHeightPx &&
        candidateCut > currentY + maxPageHeightPx * minSliceRatio
      ) {
        cutY = Math.min(cutY, candidateCut);
      }
    }

    if (cutY <= currentY) {
      cutY = idealEndY;
    }

    slices.push({ startY: currentY, endY: cutY });
    currentY = cutY;
  }

  return slices;
}

/**
 * Exporta um elemento HTML renderizado na página para um documento PDF A4 multipágina
 * utilizando `html2canvas` + `jsPDF`, preservando o layout da página web com paginação
 * inteligente (sem cortar cards ou linhas de tabela ao meio).
 */
export async function exportHtmlElementToPdf(
  element: HTMLElement,
  options: ExportHtmlToPdfOptions,
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  // Aguarda fontes e próximo frame de pintura para garantir que o DOM offscreen esteja estabilizado
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await document.fonts.ready;
    } catch {
      // ignora se a API de fontes falhar
    }
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

  const containerRect = element.getBoundingClientRect();
  // Usa a largura de layout real do container (ex: 1040px no líder, 860px no individual)
  // em vez de scrollWidth irrestrito para evitar distorção de proporção A4 por tabelas largas
  const containerWidthPx = Math.max(
    1,
    Math.round(containerRect.width || element.clientWidth || 1040),
  );
  const containerHeightPx = Math.max(1, Math.round(element.scrollHeight || containerRect.height));

  // Coleta as coordenadas de todos os blocos marcados para não quebrarem ao meio entre páginas
  const keepNodes = element.querySelectorAll<HTMLElement>('[data-pdf-keep-together]');
  const blocks: BlockBounds[] = [];
  keepNodes.forEach((node) => {
    const rect = node.getBoundingClientRect();
    const top = rect.top - containerRect.top;
    const bottom = rect.bottom - containerRect.top;
    if (bottom > top + 4) {
      blocks.push({ top, bottom });
    }
  });
  blocks.sort((a, b) => a.top - b.top);

  // Coleta as coordenadas das quebras de página explícitas por seção
  const forcedBreakYs: number[] = [];
  if (options.honorForcedBreaks !== false) {
    const breakNodes = element.querySelectorAll<HTMLElement>('[data-pdf-page-break-before]');
    breakNodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
      const top = rect.top - containerRect.top;
      if (top > 40) {
        forcedBreakYs.push(top);
      }
    });
    forcedBreakYs.sort((a, b) => a - b);
  }

  // Dimensões da folha A4 retrato em milímetros
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidthMm = pdf.internal.pageSize.getWidth(); // 210mm
  const pageHeightMm = pdf.internal.pageSize.getHeight(); // 297mm
  const marginXMm = 10;
  const marginTopMm = 10;
  const marginBottomMm = 12;

  const usableWidthMm = pageWidthMm - marginXMm * 2; // 190mm
  const usableHeightMm = pageHeightMm - marginTopMm - marginBottomMm; // 275mm

  // Quantos pixels verticais do container original cabem em uma página A4 útil
  const pxPerMm = containerWidthPx / usableWidthMm;
  const maxPageHeightPx = Math.floor(usableHeightMm * pxPerMm);

  const slices = computePageSlices(containerHeightPx, maxPageHeightPx, blocks, forcedBreakYs);
  const scale = 2;

  // Renderiza cada página (slice) de forma independente com html2canvas
  // para NUNCA estourar o limite de altura/área máxima de canvas do navegador (16.384px / 32.767px)
  for (let idx = 0; idx < slices.length; idx++) {
    const slice = slices[idx]!;
    if (idx > 0) {
      pdf.addPage();
    }

    const sliceHeightPx = Math.max(1, slice.endY - slice.startY);
    const sliceHeightMm = sliceHeightPx / pxPerMm;

    const pageCanvas = await html2canvas(element, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      x: 0,
      y: slice.startY,
      width: containerWidthPx,
      height: sliceHeightPx,
      windowWidth: containerWidthPx,
      windowHeight: containerHeightPx,
    });

    const imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData, 'JPEG', marginXMm, marginTopMm, usableWidthMm, sliceHeightMm);

    // Rodapé com suporte a texto personalizado e paginação
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);

    let textStartX = marginXMm;
    if (options.footerLogoDataUrl && options.footerLogoDataUrl.startsWith('data:image/png')) {
      try {
        pdf.addImage(options.footerLogoDataUrl, 'PNG', marginXMm, pageHeightMm - 8.5, 8, 4.5);
        textStartX = marginXMm + 10;
      } catch {
        textStartX = marginXMm;
      }
    }

    const customFooter = options.footerText?.trim();
    const baseFooter = options.footerTitle
      ? `Codex · ${options.footerTitle}`
      : 'Codex · Relatório de Partida';
    const footerLeft = customFooter ? `${customFooter}  |  ${baseFooter}` : baseFooter;
    const footerRight = `Página ${idx + 1} de ${slices.length}`;

    pdf.text(footerLeft.slice(0, 135), textStartX, pageHeightMm - 5);
    pdf.text(footerRight, pageWidthMm - marginXMm, pageHeightMm - 5, { align: 'right' });
  }

  const safeFilename = options.filename
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_');

  pdf.save(safeFilename.endsWith('.pdf') ? safeFilename : `${safeFilename}.pdf`);
}
