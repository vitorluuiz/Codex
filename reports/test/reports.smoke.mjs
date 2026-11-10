import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { loadConfig } from '../dist/config.js';
import { createLogger } from '../dist/logger.js';
import { createReportsServer } from '../dist/server.js';
import { HybridReportStore } from '../dist/store.js';
import { ReportWorker } from '../dist/worker.js';

const config = loadConfig({
  PORT: '0',
  API_SERVICE_TOKEN: 'smoke-test-token',
  REPORT_TOKEN_SECRET: 'smoke-secret-key',
  MONGO_URL: '',
  REDIS_URL: '',
  LOG_LEVEL: 'error',
});

const logger = createLogger('error');
const store = new HybridReportStore(config, logger);
const worker = new ReportWorker(config, store, logger);
const server = createReportsServer(config, store, worker, logger);

await worker.start();
const port = await server.listen();
const baseUrl = `http://127.0.0.1:${port}`;
const headers = {
  'content-type': 'application/json',
  'x-service-token': 'smoke-test-token',
};

const sampleMatch = {
  id: '01a06cc4-cf85-7f92-b5c1-f099545b0268',
  roomCode: '969180',
  roomId: '01a06cc4-7b7f-7025-ba5d-98a2c92dfbb6',
  leaderUserId: '01a069ee-9029-76e7-b874-9508fa1a2f13',
  mode: 'live',
  startedAt: '2026-10-24T14:00:00Z',
  finishedAt: '2026-10-24T14:15:00Z',
  phaseSets: [
    {
      queueSetId: '01a06a04-380f-737c-b7c7-9f5363bed6ef',
      sourcePhaseSetId: '01a069f5-8351-7c3f-aa88-50364832e5c1',
      title: 'Frações e Funções',
      color: 'var(--blue-500)',
      orderIndex: 0,
    },
  ],
  phases: [
    {
      phaseId: '01a06cc4-7b82-7cfb-b7b8-a7520c076f7b',
      queueSetId: '01a06a04-380f-737c-b7c7-9f5363bed6ef',
      sourcePhaseId: '01a069f5-835e-73d4-9f5d-b86c84c20733',
      orderIndex: 0,
      kind: 'quiz',
      name: 'Soma Básica',
      basePoints: 50,
      pointsMultiplier: 1.0,
      timeSeconds: 15,
      maxScore: 50,
      content: {
        question: 'Quanto é 1 + 2?',
        options: ['3', '2', '1', '4'],
        correctIndexes: [0],
      },
    },
    {
      phaseId: '01a06cc4-7b82-7cfb-b7b8-a7520c076f7c',
      queueSetId: '01a06a04-380f-737c-b7c7-9f5363bed6ef',
      sourcePhaseId: '01a069f5-835e-73d4-9f5d-b86c84c20734',
      orderIndex: 1,
      kind: 'fill',
      name: 'Completar Lacuna',
      basePoints: 100,
      pointsMultiplier: 1.0,
      timeSeconds: 20,
      maxScore: 100,
      content: {
        question: 'O dobro de 5 é ___',
        words: ['10', '15', '20'],
        blanks: ['10'],
      },
    },
  ],
  stats: {
    participantCount: 2,
    avgScore: 95,
    maxScore: 150,
    accuracyRate: 75,
    phaseAccuracy: [100, 50],
    phaseAvgScore: [45, 50],
  },
  participants: [
    {
      participantId: '01a06cc4-a5bc-74a1-8a5d-3a443f5f3e59',
      userId: '01a069f6-56b0-764c-852e-ec5787df5837',
      displayName: 'Maria Silva',
      avatarIndex: 1,
      joinedAt: '2026-10-24T13:58:00Z',
      totalScore: 145,
      gradedCount: 2,
      correctCount: 2,
      pendingCount: 0,
      totalElapsedSeconds: 9,
      submissions: [
        {
          phaseId: '01a06cc4-7b82-7cfb-b7b8-a7520c076f7b',
          phaseOrderIndex: 0,
          maxScore: 50,
          answer: { kind: 'quiz', optionId: 'o1' },
          submittedAt: '2026-10-24T14:01:04Z',
          elapsedSeconds: 4,
          grading: 'graded',
          correct: true,
          score: 45,
        },
        {
          phaseId: '01a06cc4-7b82-7cfb-b7b8-a7520c076f7c',
          phaseOrderIndex: 1,
          maxScore: 100,
          answer: { kind: 'fill', blanks: ['10'] },
          submittedAt: '2026-10-24T14:02:05Z',
          elapsedSeconds: 5,
          grading: 'graded',
          correct: true,
          score: 100,
        },
      ],
    },
    {
      participantId: '01a06cc4-a5bc-74a1-8a5d-3a443f5f3e60',
      userId: null,
      displayName: 'João Convidado',
      avatarIndex: 3,
      joinedAt: '2026-10-24T13:59:00Z',
      totalScore: 45,
      gradedCount: 2,
      correctCount: 1,
      pendingCount: 0,
      totalElapsedSeconds: 12,
      submissions: [
        {
          phaseId: '01a06cc4-7b82-7cfb-b7b8-a7520c076f7b',
          phaseOrderIndex: 0,
          maxScore: 50,
          answer: { kind: 'quiz', optionId: 'o1' },
          submittedAt: '2026-10-24T14:01:05Z',
          elapsedSeconds: 5,
          grading: 'graded',
          correct: true,
          score: 45,
        },
        {
          phaseId: '01a06cc4-7b82-7cfb-b7b8-a7520c076f7c',
          phaseOrderIndex: 1,
          maxScore: 100,
          answer: { kind: 'fill', blanks: ['15'] },
          submittedAt: '2026-10-24T14:02:07Z',
          elapsedSeconds: 7,
          grading: 'graded',
          correct: false,
          score: 0,
        },
      ],
    },
  ],
};

// 1. Dispara job em segundo plano
const jobRes = await fetch(`${baseUrl}/internal/jobs`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    matchId: sampleMatch.id,
    roomCode: sampleMatch.roomCode,
    matchSnapshot: sampleMatch,
  }),
});
assert.equal(jobRes.status, 202);

// 2. Consulta o relatorio completo do lider
const reportRes = await fetch(`${baseUrl}/reports/matches/${sampleMatch.id}`, { headers });
assert.equal(reportRes.status, 200);
const report = await reportRes.json();

assert.equal(report.matchId, sampleMatch.id);
assert.equal(report.title, 'Frações e Funções');
assert.equal(report.overview.participantCount, 2);
assert.equal(report.overview.avgScore, 95);
assert.equal(report.overview.accuracyRate, 75);
assert.ok(report.shareToken.length >= 40, 'shareToken deve ter alta entropia');
assert.equal(report.participants.length, 2);
assert.ok(report.participants[0].accessToken.length >= 40, 'accessToken deve ter alta entropia');

// 3. Consulta via shareToken
const shareRes = await fetch(`${baseUrl}/reports/share/${report.shareToken}`, { headers });
assert.equal(shareRes.status, 200);

// 4. Consulta relatorio individual de convidado via accessToken
const guestToken = report.participants[1].accessToken;
const indivRes = await fetch(`${baseUrl}/reports/individual/${guestToken}`, { headers });
assert.equal(indivRes.status, 200);
const indiv = await indivRes.json();
assert.equal(indiv.participant.displayName, 'João Convidado');
assert.equal(indiv.participant.rank, 2);
assert.equal(indiv.participant.answers.length, 2);
assert.equal(indiv.insights, undefined, 'Relatório individual NUNCA deve expor insights de integridade');
assert.equal(indiv.aiReview, undefined, 'Relatório individual NUNCA deve expor revisão de IA do professor');

// 5. Exporta Excel (.xlsx) e verifica as 8 abas
const xlsxRes = await fetch(`${baseUrl}/reports/matches/${sampleMatch.id}/export/xlsx`, { headers });
assert.equal(xlsxRes.status, 200);
const xlsxBuf = Buffer.from(await xlsxRes.arrayBuffer());
assert.ok(xlsxBuf.length > 1000, 'Arquivo Excel gerado deve ter tamanho valido');
assert.equal(xlsxBuf.subarray(0, 2).toString('utf8'), 'PK', 'XLSX deve comecar com assinatura ZIP PK');

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(xlsxBuf);
const sheetNames = wb.worksheets.map((ws) => ws.name);
assert.deepEqual(sheetNames, [
  'Resumo da Partida',
  'Classificação Geral',
  'Análise por Fase',
  'Matriz Aluno x Fase',
  'Diagnóstico das Questões',
  'Revisão por IA',
  'Indícios de Chute',
  'Indícios de Cola',
]);

// 5.1. Consulta histórico de relatórios do usuário diretamente via MongoDB
const historyRes = await fetch(`${baseUrl}/reports/users/${sampleMatch.leaderUserId}/history`, { headers });
assert.equal(historyRes.status, 200);
const history = await historyRes.json();
assert.ok(Array.isArray(history.leaderReports), 'leaderReports deve ser um array');
assert.ok(history.leaderReports.length >= 1, 'Deve conter ao menos 1 relatorio como lider');
assert.equal(history.leaderReports[0].matchId, sampleMatch.id);
assert.equal(history.leaderReports[0].shareToken, report.shareToken);

// 6. Partida sintetica completa para validar heuristicas psicometricas, chute, cola e IA
const longQuestionText = Array.from(
  { length: 75 },
  (_, i) => `palavra${i + 1}`,
).join(' ');

const analyticsMatch = {
  id: '01a06cc4-cf85-7f92-b5c1-999999999999',
  roomCode: 'ANL999',
  roomId: '01a06cc4-7b7f-7025-ba5d-98a2c92dfbb6',
  leaderUserId: '01a069ee-9029-76e7-b874-9508fa1a2f13',
  mode: 'live',
  startedAt: '2026-10-25T14:00:00Z',
  finishedAt: '2026-10-25T14:25:00Z',
  phaseSets: [
    {
      queueSetId: 'set-1',
      sourcePhaseSetId: 'src-set-1',
      title: 'Avaliação Diagnóstica',
      color: 'var(--blue-500)',
      orderIndex: 0,
    },
  ],
  phases: [
    {
      phaseId: 'ph-1-easy',
      queueSetId: 'set-1',
      sourcePhaseId: 'sph-1',
      orderIndex: 0,
      kind: 'quiz',
      name: 'Questão Muito Fácil',
      basePoints: 100,
      pointsMultiplier: 1,
      timeSeconds: 40,
      maxScore: 100,
      content: {
        question: 'Quanto é 1 + 1?',
        options: ['2', '3', '4', '5'],
        correctIndexes: [0],
      },
    },
    {
      phaseId: 'ph-2-hard',
      queueSetId: 'set-1',
      sourcePhaseId: 'sph-2',
      orderIndex: 1,
      kind: 'quiz',
      name: 'Questão Muito Difícil',
      basePoints: 100,
      pointsMultiplier: 1,
      timeSeconds: 30,
      maxScore: 100,
      content: {
        question: 'Qual o resultado desta integral complexa?',
        options: ['Zero', 'Pi', 'Euler', 'Infinito'],
        correctIndexes: [0],
      },
    },
    {
      phaseId: 'ph-3-short-time',
      queueSetId: 'set-1',
      sourcePhaseId: 'sph-3',
      orderIndex: 2,
      kind: 'quiz',
      name: 'Tempo Curto',
      basePoints: 100,
      pointsMultiplier: 1,
      timeSeconds: 20,
      maxScore: 100,
      content: {
        question: 'Resolva o sistema linear rapidamente.',
        options: ['x=1', 'x=2', 'x=3', 'x=4'],
        correctIndexes: [0],
      },
    },
    {
      phaseId: 'ph-4-long-text',
      queueSetId: 'set-1',
      sourcePhaseId: 'sph-4',
      orderIndex: 3,
      kind: 'quiz',
      name: 'Enunciado Longo',
      basePoints: 100,
      pointsMultiplier: 1,
      timeSeconds: 15,
      maxScore: 100,
      content: {
        question: longQuestionText,
        options: ['A', 'B', 'C', 'D'],
        correctIndexes: [0],
      },
    },
    {
      phaseId: 'ph-5-bad-key',
      queueSetId: 'set-1',
      sourcePhaseId: 'sph-5',
      orderIndex: 4,
      kind: 'quiz',
      name: 'Gabarito Invertido',
      basePoints: 100,
      pointsMultiplier: 1,
      timeSeconds: 30,
      maxScore: 100,
      content: {
        question: 'Qual planeta é conhecido como Planeta Vermelho?',
        options: ['Vênus (Gabarito Errado)', 'Marte', 'Júpiter', 'Saturno'],
        correctIndexes: [0],
      },
    },
  ],
  stats: {
    participantCount: 8,
    avgScore: 300,
    maxScore: 500,
    accuracyRate: 50,
    phaseAccuracy: [100, 12, 50, 75, 25],
    phaseAvgScore: [100, 12, 25, 75, 25],
  },
  participants: [
    // P1, P2, P3: Alunos de alto desempenho (acertam F1..F4, mas em F5 escolhem o2 'Marte' que está marcado como errado no gabarito!)
    ...['p1', 'p2', 'p3'].map((id, idx) => ({
      participantId: id,
      userId: null,
      displayName: `Top Aluno ${idx + 1}`,
      avatarIndex: idx,
      joinedAt: '2026-10-25T14:00:00Z',
      totalScore: 400,
      gradedCount: 5,
      correctCount: 4,
      pendingCount: 0,
      totalElapsedSeconds: 40,
      submissions: [
        {
          phaseId: 'ph-1-easy',
          phaseOrderIndex: 0,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o1' },
          submittedAt: `2026-10-25T14:01:0${idx + 3}Z`,
          elapsedSeconds: 5,
          grading: 'graded',
          correct: true,
          score: 100,
        },
        {
          phaseId: 'ph-2-hard',
          phaseOrderIndex: 1,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: idx === 0 ? 'o1' : 'o2' },
          submittedAt: `2026-10-25T14:02:1${idx}Z`,
          elapsedSeconds: 10,
          grading: 'graded',
          correct: idx === 0,
          score: idx === 0 ? 100 : 0,
        },
        {
          phaseId: 'ph-3-short-time',
          phaseOrderIndex: 2,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o1' },
          submittedAt: `2026-10-25T14:03:1${idx}Z`,
          elapsedSeconds: 10,
          grading: 'graded',
          correct: true,
          score: 100,
        },
        {
          phaseId: 'ph-4-long-text',
          phaseOrderIndex: 3,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o1' },
          submittedAt: `2026-10-25T14:04:0${idx + 5}Z`,
          elapsedSeconds: 8,
          grading: 'graded',
          correct: true,
          score: 100,
        },
        {
          phaseId: 'ph-5-bad-key',
          phaseOrderIndex: 4,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o2' }, // Escolhem Marte (errado segundo gabarito defeituoso)
          submittedAt: `2026-10-25T14:05:1${idx}Z`,
          elapsedSeconds: 8,
          grading: 'graded',
          correct: false,
          score: 0,
        },
      ],
    })),
    // P4, P5: Alunos intermediários (não respondem F3 a tempo)
    ...['p4', 'p5'].map((id, idx) => ({
      participantId: id,
      userId: null,
      displayName: `Aluno Médio ${idx + 1}`,
      avatarIndex: idx + 3,
      joinedAt: '2026-10-25T14:00:00Z',
      totalScore: 200,
      gradedCount: 4,
      correctCount: 2,
      pendingCount: 0,
      totalElapsedSeconds: 35,
      submissions: [
        {
          phaseId: 'ph-1-easy',
          phaseOrderIndex: 0,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o1' },
          submittedAt: `2026-10-25T14:01:1${idx}Z`,
          elapsedSeconds: 6,
          grading: 'graded',
          correct: true,
          score: 100,
        },
        {
          phaseId: 'ph-2-hard',
          phaseOrderIndex: 1,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o2' },
          submittedAt: `2026-10-25T14:02:2${idx}Z`,
          elapsedSeconds: 12,
          grading: 'graded',
          correct: false,
          score: 0,
        },
        // F3 não respondida (tempo curto)
        {
          phaseId: 'ph-4-long-text',
          phaseOrderIndex: 3,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o1' },
          submittedAt: `2026-10-25T14:04:1${idx}Z`,
          elapsedSeconds: 9,
          grading: 'graded',
          correct: true,
          score: 100,
        },
        {
          phaseId: 'ph-5-bad-key',
          phaseOrderIndex: 4,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o2' },
          submittedAt: `2026-10-25T14:05:2${idx}Z`,
          elapsedSeconds: 8,
          grading: 'graded',
          correct: false,
          score: 0,
        },
      ],
    })),
    // P6: Aluno que chuta tudo rapido (1s) ou no ultimo segundo (29s)
    {
      participantId: 'p6-guesser',
      userId: null,
      displayName: 'Pedro Chutador',
      avatarIndex: 5,
      joinedAt: '2026-10-25T14:00:00Z',
      totalScore: 200,
      gradedCount: 4,
      correctCount: 2,
      pendingCount: 0,
      totalElapsedSeconds: 36,
      submissions: [
        {
          phaseId: 'ph-1-easy',
          phaseOrderIndex: 0,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o1' },
          submittedAt: '2026-10-25T14:01:02Z',
          elapsedSeconds: 4,
          grading: 'graded',
          correct: true,
          score: 100,
        },
        {
          phaseId: 'ph-2-hard',
          phaseOrderIndex: 1,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o3' },
          submittedAt: '2026-10-25T14:02:01Z',
          elapsedSeconds: 1, // Chute rápido!
          grading: 'graded',
          correct: false,
          score: 0,
        },
        {
          phaseId: 'ph-4-long-text',
          phaseOrderIndex: 3,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o3' },
          submittedAt: '2026-10-25T14:04:15Z',
          elapsedSeconds: 15, // Chute no último segundo!
          grading: 'graded',
          correct: false,
          score: 0,
        },
        {
          phaseId: 'ph-5-bad-key',
          phaseOrderIndex: 4,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o1' }, // Acertou o gabarito defeituoso no chute
          submittedAt: '2026-10-25T14:05:02Z',
          elapsedSeconds: 2,
          grading: 'graded',
          correct: true,
          score: 100,
        },
      ],
    },
    // P7 e P8: Dupla que passa cola (mesmos erros raros o4 e timestamps separados por 1s)
    {
      participantId: 'p7-source',
      userId: null,
      displayName: 'Lucas Fonte',
      avatarIndex: 6,
      joinedAt: '2026-10-25T14:00:00Z',
      totalScore: 200,
      gradedCount: 4,
      correctCount: 2,
      pendingCount: 0,
      totalElapsedSeconds: 32,
      submissions: [
        {
          phaseId: 'ph-1-easy',
          phaseOrderIndex: 0,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o1' },
          submittedAt: '2026-10-25T14:01:10.000Z',
          elapsedSeconds: 6,
          grading: 'graded',
          correct: true,
          score: 100,
        },
        {
          phaseId: 'ph-2-hard',
          phaseOrderIndex: 1,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o4' }, // Erro raro o4
          submittedAt: '2026-10-25T14:02:10.000Z',
          elapsedSeconds: 8,
          grading: 'graded',
          correct: false,
          score: 0,
        },
        {
          phaseId: 'ph-4-long-text',
          phaseOrderIndex: 3,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o4' }, // Erro raro o4
          submittedAt: '2026-10-25T14:04:10.000Z',
          elapsedSeconds: 8,
          grading: 'graded',
          correct: false,
          score: 0,
        },
        {
          phaseId: 'ph-5-bad-key',
          phaseOrderIndex: 4,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o1' },
          submittedAt: '2026-10-25T14:05:10.000Z',
          elapsedSeconds: 10,
          grading: 'graded',
          correct: true,
          score: 100,
        },
      ],
    },
    {
      participantId: 'p8-follower',
      userId: null,
      displayName: 'Marcos Seguidor',
      avatarIndex: 7,
      joinedAt: '2026-10-25T14:00:00Z',
      totalScore: 200,
      gradedCount: 4,
      correctCount: 2,
      pendingCount: 0,
      totalElapsedSeconds: 36,
      submissions: [
        {
          phaseId: 'ph-1-easy',
          phaseOrderIndex: 0,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o1' },
          submittedAt: '2026-10-25T14:01:11.200Z', // 1.2s depois de P7
          elapsedSeconds: 7,
          grading: 'graded',
          correct: true,
          score: 100,
        },
        {
          phaseId: 'ph-2-hard',
          phaseOrderIndex: 1,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o4' }, // Mesmo erro raro o4, 1.1s depois
          submittedAt: '2026-10-25T14:02:11.100Z',
          elapsedSeconds: 9,
          grading: 'graded',
          correct: false,
          score: 0,
        },
        {
          phaseId: 'ph-4-long-text',
          phaseOrderIndex: 3,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o4' }, // Mesmo erro raro o4, 0.9s depois
          submittedAt: '2026-10-25T14:04:10.900Z',
          elapsedSeconds: 9,
          grading: 'graded',
          correct: false,
          score: 0,
        },
        {
          phaseId: 'ph-5-bad-key',
          phaseOrderIndex: 4,
          maxScore: 100,
          answer: { kind: 'quiz', optionId: 'o1' }, // 1.5s depois
          submittedAt: '2026-10-25T14:05:11.500Z',
          elapsedSeconds: 11,
          grading: 'graded',
          correct: true,
          score: 100,
        },
      ],
    },
  ],
};

await fetch(`${baseUrl}/internal/jobs`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    matchId: analyticsMatch.id,
    roomCode: analyticsMatch.roomCode,
    matchSnapshot: analyticsMatch,
  }),
});

const anlRes = await fetch(`${baseUrl}/reports/matches/${analyticsMatch.id}`, { headers });
assert.equal(anlRes.status, 200);
const anlReport = await anlRes.json();

assert.equal(anlReport.schemaVersion, 2);
assert.ok(anlReport.insights, 'Relatório deve conter objeto insights');

const qInsights = anlReport.insights.questions;
assert.equal(qInsights[0].difficulty, 'very_easy');
assert.ok(qInsights[0].flags.includes('time_too_long'), 'F1 deve ter flag time_too_long');
assert.equal(qInsights[1].difficulty, 'very_hard');
assert.ok(qInsights[2].flags.includes('time_too_short'), 'F3 deve ter flag time_too_short');
assert.equal(
  anlReport.phases[2].avgElapsedSeconds,
  16.3,
  'F3 deve contabilizar os 5 nao envios como 100% do tempo (20s): (3*10 + 5*20)/8 = 16.3s',
);
assert.equal(
  qInsights[2].avgTimeUsageRate,
  81,
  'F3 deve ter avgTimeUsageRate = 81% considerando nao envios como 100% do tempo',
);
assert.ok(qInsights[3].flags.includes('long_question'), 'F4 deve ter flag long_question');
assert.ok(qInsights[3].flags.includes('reading_exceeds_time'), 'F4 deve ter flag reading_exceeds_time');
assert.ok(qInsights[4].flags.includes('negative_discrimination'), 'F5 deve ter discriminacao negativa');
assert.ok(qInsights[4].flags.includes('suspect_answer_key'), 'F5 deve ter gabarito suspeito');

// Verifica detecção de chute (Pedro Chutador)
const guessers = anlReport.insights.guessing.participants;
assert.ok(guessers.some((g) => g.participantId === 'p6-guesser'), 'Deve detectar Pedro Chutador');

// Verifica detecção de cola (Lucas Fonte e Marcos Seguidor)
const pairs = anlReport.insights.collusion.pairs;
const targetPair = pairs.find(
  (p) =>
    (p.participantAId === 'p7-source' && p.participantBId === 'p8-follower') ||
    (p.participantAId === 'p8-follower' && p.participantBId === 'p7-source'),
);
assert.ok(targetPair, 'Deve detectar par em colusão P7-P8');
assert.equal(targetPair.dominantFollowerId, 'p8-follower', 'Deve identificar Marcos como seguidor');

// 7. Testa PUT /internal/reports/matches/:id/ai-review
const sampleAiReview = {
  generatedAt: '2026-10-25T15:00:00Z',
  requestedByUserId: analyticsMatch.leaderUserId,
  provider: 'local',
  model: 'qwen2.5',
  phases: [
    {
      phaseId: 'ph-5-bad-key',
      phaseNumber: 5,
      verdict: 'problem',
      spelling: [],
      conceptual: [{ description: 'Marte é o Planeta Vermelho, não Vênus.', severity: 'high' }],
      clarity: [],
      answerKey: 'wrong',
      answerKeyNote: 'A alternativa correta deveria ser Marte.',
      suggestedRewrite: null,
    },
  ],
};

const putAiRes = await fetch(
  `${baseUrl}/internal/reports/matches/${analyticsMatch.id}/ai-review`,
  {
    method: 'PUT',
    headers,
    body: JSON.stringify(sampleAiReview),
  },
);
assert.equal(putAiRes.status, 200);

const afterAiRes = await fetch(`${baseUrl}/reports/matches/${analyticsMatch.id}`, { headers });
const afterAiReport = await afterAiRes.json();
assert.equal(afterAiReport.aiReview.phases.length, 1);
assert.equal(afterAiReport.aiReview.phases[0].answerKey, 'wrong');

await server.close();
await worker.close();
await store.close();
console.log('✓ Todos os testes de fumaca do servico de relatorios passaram!');
