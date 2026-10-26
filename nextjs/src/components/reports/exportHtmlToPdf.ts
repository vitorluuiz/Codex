'use client';

export interface ExportHtmlToPdfOptions {
  /** Nome do arquivo final (ex.: relatorio-AB12CD.pdf) */
  filename: string;
  /** Título exibido no rodapé de paginação */
  footerTitle?: string;
}

interface BlockBounds {
  top: number;
  bottom: number;
}

/**
 * Calcula as faixas verticais (em pixels do elemento original) para cada página A4,
 * evitando cortar ao meio elementos marcados com `[data-pdf-keep-together]`.
 */
function computePageSlices(
  totalHeightPx: number,
  maxPageHeightPx: number,
  blocks: BlockBounds[],
): Array<{ startY: number; endY: number }> {
  const slices: Array<{ startY: number; endY: number }> = [];
  const minSliceRatio = 0.35;
  let currentY = 0;

  while (currentY < totalHeightPx - 2) {
    const idealEndY = currentY + maxPageHeightPx;
    if (idealEndY >= totalHeightPx - 2) {
      slices.push({ startY: currentY, endY: totalHeightPx });
      break;
    }

    let cutY = idealEndY;

    // Procura o primeiro bloco indivisível que é atravessado pela linha de corte ideal
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
  const containerWidthPx = Math.max(1, Math.round(element.scrollWidth || containerRect.width));
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

  const scale = 2;
  const fullCanvas = await html2canvas(element, {
    scale,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false,
    width: containerWidthPx,
    height: containerHeightPx,
    windowWidth: containerWidthPx,
    windowHeight: containerHeightPx,
  });

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

  const slices = computePageSlices(containerHeightPx, maxPageHeightPx, blocks);

  slices.forEach((slice, idx) => {
    if (idx > 0) {
      pdf.addPage();
    }

    const sliceHeightPx = Math.max(1, slice.endY - slice.startY);
    const sliceHeightMm = sliceHeightPx / pxPerMm;

    const srcY = Math.max(0, Math.round(slice.startY * scale));
    const srcH = Math.min(fullCanvas.height - srcY, Math.round(sliceHeightPx * scale));

    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = fullCanvas.width;
    pageCanvas.height = Math.max(1, srcH);

    const ctx = pageCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(
        fullCanvas,
        0,
        srcY,
        fullCanvas.width,
        srcH,
        0,
        0,
        fullCanvas.width,
        srcH,
      );
    }

    const imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData, 'JPEG', marginXMm, marginTopMm, usableWidthMm, sliceHeightMm);

    // Rodapé discreto com paginação
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    const footerLeft = options.footerTitle
      ? `Codex · ${options.footerTitle}`
      : 'Codex · Relatório de Partida';
    const footerRight = `Página ${idx + 1} de ${slices.length}`;
    pdf.text(footerLeft, marginXMm, pageHeightMm - 5);
    pdf.text(footerRight, pageWidthMm - marginXMm, pageHeightMm - 5, { align: 'right' });
  });

  const safeFilename = options.filename
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_');

  pdf.save(safeFilename.endsWith('.pdf') ? safeFilename : `${safeFilename}.pdf`);
}
