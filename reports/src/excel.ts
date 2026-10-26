import ExcelJS from 'exceljs';

import type { MatchReportDocument, PhaseKind } from './types.js';

const KIND_LABELS: Record<PhaseKind, string> = {
  quiz: 'Quiz (Múltipla Escolha)',
  fill: 'Completar Lacunas',
  text: 'Dissertativa',
  code: 'Desafio de Código',
};

function formatDateBr(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF334155' } },
      bottom: { style: 'thin', color: { argb: 'FF334155' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
  });
}

function styleDataRow(row: ExcelJS.Row, isEven: boolean): void {
  row.height = 20;
  const bg = isEven ? 'FFF8FAFC' : 'FFFFFFFF';
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { size: 10, color: { argb: 'FF0F172A' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bg },
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
  });
}

export async function generateMatchReportExcel(report: MatchReportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Codex Platform';
  workbook.created = new Date();

  /* ======================================================================== */
  /* ABA 1: Resumo da Partida                                                 */
  /* ======================================================================== */
  const summarySheet = workbook.addWorksheet('Resumo da Partida', {
    views: [{ showGridLines: true }],
  });

  summarySheet.columns = [
    { header: 'Indicador', key: 'metric', width: 36 },
    { header: 'Valor', key: 'value', width: 48 },
  ];
  styleHeaderRow(summarySheet.getRow(1));

  const summaryRows: Array<[string, string | number]> = [
    ['Título da Partida', report.title],
    ['ID da Partida', report.matchId],
    ['Código da Sala', report.roomCode],
    ['Modo de Jogo', report.mode === 'live' ? 'Ao vivo (Guiado pelo líder)' : 'Próprio ritmo'],
    ['Início da Partida', formatDateBr(report.startedAt)],
    ['Término da Partida', formatDateBr(report.finishedAt)],
    ['Duração Total', formatDuration(report.durationSeconds)],
    ['Total de Participantes', report.overview.participantCount],
    ['Total de Fases', report.overview.phaseCount],
    [
      'Pontuação Média da Turma',
      `${report.overview.avgScore} / ${report.overview.maxPossibleScore} pts`,
    ],
    ['Maior Pontuação Alcançada', `${report.overview.maxAchievedScore} pts`],
    ['Menor Pontuação Alcançada', `${report.overview.minAchievedScore} pts`],
    ['Mediana de Pontuação', `${report.overview.medianScore} pts`],
    ['Taxa de Acerto Global', `${report.overview.accuracyRate}%`],
    ['Total de Respostas Enviadas', report.overview.totalSubmissions],
    ['Total de Respostas Corretas', report.overview.totalCorrect],
    ['Tempo Médio de Resposta por Fase', `${report.overview.avgResponseSeconds}s`],
    [
      'Conjuntos Utilizados',
      report.phaseSets.map((s) => s.title).join(', ') || report.title,
    ],
  ];

  summaryRows.forEach(([metric, value], idx) => {
    const row = summarySheet.addRow({ metric, value });
    styleDataRow(row, idx % 2 === 1);
    row.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF1E293B' } };
  });

  /* ======================================================================== */
  /* ABA 2: Classificação Geral                                               */
  /* ======================================================================== */
  const rankSheet = workbook.addWorksheet('Classificação Geral', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  rankSheet.columns = [
    { header: 'Posição', key: 'rank', width: 10 },
    { header: 'Participante', key: 'displayName', width: 28 },
    { header: 'Tipo', key: 'accountType', width: 15 },
    { header: 'Pontuação Total', key: 'totalScore', width: 16 },
    { header: 'Pontuação Máx.', key: 'maxScore', width: 15 },
    { header: 'Aproveitamento (%)', key: 'scorePct', width: 18 },
    { header: 'Taxa de Acerto (%)', key: 'accuracy', width: 18 },
    { header: 'Acertos', key: 'correct', width: 11 },
    { header: 'Erros', key: 'incorrect', width: 11 },
    { header: 'Em Branco', key: 'unanswered', width: 12 },
    { header: 'Pendentes', key: 'pending', width: 12 },
    { header: 'Tempo Total (s)', key: 'totalTime', width: 16 },
    { header: 'Tempo Médio (s)', key: 'avgTime', width: 16 },
    { header: 'Percentil', key: 'percentile', width: 12 },
  ];
  styleHeaderRow(rankSheet.getRow(1));

  report.participants.forEach((p, idx) => {
    const row = rankSheet.addRow({
      rank: `#${p.rank}`,
      displayName: p.displayName,
      accountType: p.userId ? 'Conta' : 'Convidado',
      totalScore: p.totalScore,
      maxScore: p.maxPossibleScore,
      scorePct: `${p.scorePercentage}%`,
      accuracy: `${p.accuracyRate}%`,
      correct: p.correctCount,
      incorrect: p.incorrectCount,
      unanswered: p.unansweredCount,
      pending: p.pendingCount,
      totalTime: p.totalElapsedSeconds,
      avgTime: p.avgElapsedSeconds,
      percentile: `Top ${Math.max(1, 100 - p.percentile)}%`,
    });
    styleDataRow(row, idx % 2 === 1);
    row.getCell('rank').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('rank').font = { bold: true, size: 10 };
    row.getCell('totalScore').alignment = { vertical: 'middle', horizontal: 'right' };
    row.getCell('totalScore').font = { bold: true, size: 10, color: { argb: 'FF0F766E' } };
  });

  /* ======================================================================== */
  /* ABA 3: Análise por Fase                                                  */
  /* ======================================================================== */
  const phaseSheet = workbook.addWorksheet('Análise por Fase', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  phaseSheet.columns = [
    { header: 'Fase', key: 'phaseNumber', width: 8 },
    { header: 'Título da Fase', key: 'name', width: 24 },
    { header: 'Conjunto', key: 'setTitle', width: 22 },
    { header: 'Tipo', key: 'kind', width: 22 },
    { header: 'Enunciado', key: 'question', width: 42 },
    { header: 'Gabarito Esperado', key: 'correctAnswer', width: 30 },
    { header: 'Taxa de Acerto (%)', key: 'accuracy', width: 18 },
    { header: 'Pontuação Média', key: 'avgScore', width: 16 },
    { header: 'Pontuação Máx.', key: 'maxScore', width: 15 },
    { header: 'Envios', key: 'submitted', width: 10 },
    { header: 'Acertos', key: 'correct', width: 10 },
    { header: 'Erros', key: 'incorrect', width: 10 },
    { header: 'Em Branco', key: 'unanswered', width: 12 },
    { header: 'Tempo Médio (s)', key: 'avgTime', width: 16 },
    { header: 'Resposta Mais Frequente', key: 'mostCommon', width: 30 },
  ];
  styleHeaderRow(phaseSheet.getRow(1));

  report.phases.forEach((ph, idx) => {
    const row = phaseSheet.addRow({
      phaseNumber: `F${ph.phaseNumber}`,
      name: ph.name,
      setTitle: ph.setTitle,
      kind: KIND_LABELS[ph.kind] ?? ph.kind,
      question: ph.question,
      correctAnswer: ph.correctAnswerText,
      accuracy: `${ph.accuracyRate}%`,
      avgScore: ph.avgScore,
      maxScore: ph.maxScore,
      submitted: ph.submittedCount,
      correct: ph.correctCount,
      incorrect: ph.incorrectCount,
      unanswered: ph.unansweredCount,
      avgTime: ph.avgElapsedSeconds,
      mostCommon: ph.mostCommonAnswerText ?? '—',
    });
    styleDataRow(row, idx % 2 === 1);
    row.getCell('phaseNumber').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('phaseNumber').font = { bold: true, size: 10 };
  });

  /* ======================================================================== */
  /* ABA 4: Matriz Aluno x Fase                                               */
  /* ======================================================================== */
  const matrixSheet = workbook.addWorksheet('Matriz Aluno x Fase', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }],
  });

  const matrixCols: Partial<ExcelJS.Column>[] = [
    { header: '#', key: 'rank', width: 7 },
    { header: 'Participante', key: 'displayName', width: 26 },
    { header: 'Total (pts)', key: 'totalScore', width: 13 },
    { header: '% Acerto', key: 'accuracy', width: 12 },
  ];

  for (const ph of report.phases) {
    matrixCols.push({
      header: `F${ph.phaseNumber}: ${ph.name}`,
      key: `phase_${ph.phaseId}`,
      width: 26,
    });
  }

  matrixSheet.columns = matrixCols;
  styleHeaderRow(matrixSheet.getRow(1));

  report.participants.forEach((p, idx) => {
    const rowData: Record<string, string | number> = {
      rank: p.rank,
      displayName: p.displayName,
      totalScore: p.totalScore,
      accuracy: `${p.accuracyRate}%`,
    };

    const answerByPhaseId = new Map(p.answers.map((a) => [a.phaseId, a]));

    for (const ph of report.phases) {
      const ans = answerByPhaseId.get(ph.phaseId);
      if (!ans || !ans.submitted) {
        rowData[`phase_${ph.phaseId}`] = '— (Não respondeu)';
      } else if (ans.grading === 'pending') {
        rowData[`phase_${ph.phaseId}`] = `⏳ Pendente (${ans.givenAnswerText})`;
      } else if (ans.correct) {
        rowData[`phase_${ph.phaseId}`] =
          `✓ ${ans.score} pts · ${ans.elapsedSeconds ?? 0}s (${ans.givenAnswerText})`;
      } else {
        rowData[`phase_${ph.phaseId}`] =
          `✗ 0 pts · ${ans.elapsedSeconds ?? 0}s (${ans.givenAnswerText})`;
      }
    }

    const row = matrixSheet.addRow(rowData);
    styleDataRow(row, idx % 2 === 1);

    // Colorir celulas de cada fase conforme acerto/erro
    report.phases.forEach((ph, pIdx) => {
      const cell = row.getCell(5 + pIdx);
      const ans = answerByPhaseId.get(ph.phaseId);
      if (!ans || !ans.submitted) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF1F5F9' },
        };
        cell.font = { size: 9, color: { argb: 'FF64748B' } };
      } else if (ans.grading === 'pending') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEF9C3' },
        };
        cell.font = { size: 9, color: { argb: 'FF854D0E' } };
      } else if (ans.correct) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCFCE7' },
        };
        cell.font = { size: 9, bold: true, color: { argb: 'FF166534' } };
      } else {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEE2E2' },
        };
        cell.font = { size: 9, color: { argb: 'FF991B1B' } };
      }
    });
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
