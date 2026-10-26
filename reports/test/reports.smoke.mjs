import assert from 'node:assert/strict';

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

// 5. Exporta Excel (.xlsx)
const xlsxRes = await fetch(`${baseUrl}/reports/matches/${sampleMatch.id}/export/xlsx`, { headers });
assert.equal(xlsxRes.status, 200);
const xlsxBuf = Buffer.from(await xlsxRes.arrayBuffer());
assert.ok(xlsxBuf.length > 1000, 'Arquivo Excel gerado deve ter tamanho valido');
assert.equal(xlsxBuf.subarray(0, 2).toString('utf8'), 'PK', 'XLSX deve comecar com assinatura ZIP PK');

await server.close();
await worker.close();
await store.close();
console.log('✓ Todos os testes de fumaca do servico de relatorios passaram!');
