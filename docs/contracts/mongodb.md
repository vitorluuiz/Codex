# Contrato de Banco Orientado a Documentos (MongoDB) — Codex

Este documento define o contrato e a modelagem do banco orientado a documentos (MongoDB 7+) do Codex. O MongoDB atua como repositório para **Partidas Finalizadas**, **Histórico Detalhado de Submissões por Participante**, **Métricas Analíticas Congeladas** e **Rascunhos de Autoria**.

---

## 1. Princípios e Estratégia de Modelagem

1. **Snapshots Imutáveis:** Uma partida finalizada é um documento autossuficiente e somente-leitura (*append-only*). O histórico nunca faz joins em tabelas relacionais voláteis de salas ou filas.
2. **Padrão Bucket por Participante:** O limite rígido do MongoDB de 16 MB por documento inviabiliza guardar todas as submissões dentro do documento da partida (o pior caso permitido pelo sistema — 400 fases × 500 participantes = 200.000 submissões — excederia a cota de 84 bytes por resposta). Portanto:
   * A coleção `matches` armazena o cabeçalho da partida, as fases congeladas e as métricas agregadas da turma.
   * A coleção `match_participants` armazena um documento por participante, embutindo até 400 submissões daquela pessoa (~41 KB), com limite estrutural seguro.
3. **Ponteiro Interno de Fase:** As submissões do aluno apontam para o identificador `phaseId` presente no array `phases[]` do próprio documento da partida, garantindo integridade contra qualquer alteração futura em conjuntos ou no catálogo relacional.

---

## 2. Coleções e Esquemas de Documentos

### 2.1 Coleção `matches`
Armazena os dados consolidados da partida, o roteiro executado e os agregados de desempenho.

```jsonc
{
  "_id": "01a06cc4-cf85-7f92-b5c1-f099545b0268",     // UUID v7 em formato string
  "schemaVersion": 1,
  "roomCode": "969180",
  "roomId": "01a06cc4-7b7f-7025-ba5d-98a2c92dfbb6",  // Linhagem da sala
  "leaderUserId": "01a069ee-9029-76e7-b874-9508fa1a2f13", // Referência ao líder no PostgreSQL
  "mode": "live",                                   // "live" | "self-paced"
  "startedAt": ISODate("2026-09-25T14:13:52Z"),
  "finishedAt": ISODate("2026-09-25T14:28:08Z"),
  
  "phaseSets": [
    {
      "queueSetId": "01a06a04-380f-737c-b7c7-9f5363bed6ef",
      "sourcePhaseSetId": "01a069f5-8351-7c3f-aa88-50364832e5c1",
      "title": "Frações e Funções",
      "color": "var(--blue-500)",
      "orderIndex": 0
    }
  ],

  "phases": [
    {
      "phaseId": "01a06cc4-7b82-7cfb-b7b8-a7520c076f7b",
      "queueSetId": "01a06a04-380f-737c-b7c7-9f5363bed6ef",
      "sourcePhaseId": "01a069f5-835e-73d4-9f5d-b86c84c20733",
      "orderIndex": 0,
      "kind": "quiz",
      "name": "Pergunta fácil de soma",
      "basePoints": 50,
      "pointsMultiplier": 1.0,
      "timeSeconds": 15,
      "maxScore": 50,
      "content": {
        "question": "Quanto é 1 + 2?",
        "fromAI": false,
        "options": ["3", "2", "1", "4"],
        "correctIndexes": [0]
      }
    }
  ],

  "stats": {
    "participantCount": 24,
    "avgScore": 137,
    "maxScore": 325,
    "accuracyRate": 78,
    "phaseAccuracy": [85, 70, 65, 90],
    "phaseAvgScore": [45, 32, 28, 48]
  }
}
```

#### Índices da Coleção `matches`
```javascript
db.matches.createIndex({ leaderUserId: 1, finishedAt: -1 }); // Consulta rápida de histórico do líder
db.matches.createIndex({ finishedAt: -1 });                   // Auditoria e varredura cronológica
db.matches.createIndex({ roomCode: 1, finishedAt: -1 });      // Partidas associadas ao código da sala
```

---

### 2.2 Coleção `match_participants`
Armazena a folha individual de respostas de cada jogador em uma determinada partida.

```jsonc
{
  "_id": "01a06cc4-a5bc-74a1-8a5d-3a443f5f3e59",     // UUID v7
  "schemaVersion": 1,
  "matchId": "01a06cc4-cf85-7f92-b5c1-f099545b0268", // Referência à partida em matches
  "participantId": "01a06cc4-a5bc-74a1-8a5d-3a443f5f3e59",
  "userId": "01a069f6-56b0-764c-852e-ec5787df5837",  // UUID do usuário (null para convidado anônimo)
  "displayName": "Maria Silva",
  "avatarIndex": 1,
  "joinedAt": ISODate("2026-09-25T14:10:00Z"),

  "totalScore": 137,
  "gradedCount": 4,
  "correctCount": 3,
  "pendingCount": 0,

  "submissions": [
    {
      "phaseId": "01a06cc4-7b82-7cfb-b7b8-a7520c076f7b", // Ponteiro para matches.phases[].phaseId
      "phaseOrderIndex": 0,
      "maxScore": 50,
      "answer": {
        "kind": "quiz",
        "optionId": "o1"
      },
      "submittedAt": ISODate("2026-09-25T14:14:02Z"),
      "elapsedSeconds": 5,
      "readyAt": ISODate("2026-09-25T14:14:08Z"),
      "grading": "graded",                            // "graded" | "pending"
      "correct": true,
      "score": 45,
      "explanation": null,
      "aiSuggestions": null,
      "testsPassed": null
    }
  ]
}
```

#### Índices da Coleção `match_participants`
```javascript
db.match_participants.createIndex({ matchId: 1, participantId: 1 }, { unique: true }); // Unicidade
db.match_participants.createIndex({ matchId: 1 });                                     // Relatório da partida
db.match_participants.createIndex({ userId: 1, matchId: -1 });                         // Histórico do jogador
```

---

### 2.3 Coleção `draft_phase_sets` (Autoria)
Repositório flexível para rascunhos de autores.

```jsonc
{
  "_id": "01a069f5-8351-7c3f-aa88-50364832e5c1",
  "ownerId": "01a069ee-9029-76e7-b874-9508fa1a2f13",
  "title": "Conjunto de Introdução",
  "createdAt": ISODate("2026-09-20T10:00:00Z"),
  "updatedAt": ISODate("2026-09-25T11:30:00Z"),
  "publishedVersion": null,
  "phases": [
    {
      "id": "01a069f5-835e-73d4-9f5d-b86c84c20733",
      "kind": "quiz",
      "name": "Soma Simples",
      "basePoints": 50,
      "pointsMultiplier": 1.0,
      "timeSeconds": 15,
      "orderIndex": 0,
      "content": {
        "question": "Quanto é 1 + 2?",
        "fromAI": false,
        "options": ["3", "2", "1", "4"],
        "correctIndexes": [0]
      }
    }
  ]
}
```

---

## 3. Protocolo de Commit de Fim de Partida

A persistência do encerramento de partida é realizada com idempotência estrita através do endpoint interno `POST /internal/matches`.

### 3.1 Sequência de Commit
1. **Montagem do Snapshot:** Os dados da partida, fases e submissões são consolidados a partir do estado vivo no Redis em uma carga idempotente.
2. **Escrita dos Participantes (Passo 1):** Operação de *bulk upsert* na coleção `match_participants`, com chave composta `{ matchId, participantId }`.
3. **Escrita da Partida (Passo 2 - Marcador de Commit):** Operação de *upsert* na coleção `matches` com `_id = matchId`.
4. **Confirmação:** Apenas após o passo 3 o histórico do líder passa a enxergar a partida finalizada. Nenhuma leitura intermediária visualiza submissões órfãs ou partida incompleta.
5. **Retentativa:** Em caso de falha de conexão no passo 2 ou 3, o `matchId` permanece em fila de pendência (`commit:pending`) e é retentado de maneira idêntica.

---

## 4. Invariantes de Dados

1. **Cálculo Único de Estatísticas:** Os valores de `matches.stats` (`avgScore`, `accuracyRate`, `phaseAccuracy`) são calculados estritamente uma única vez durante a gravação inicial do encerramento da partida, utilizando arredondamento `MidpointRounding.AwayFromZero`. O documento nunca é recalculado dinamicamente para impedir divergência entre o placar ao vivo e o histórico gravado.
2. **Desacoplamento de Contas Anônimas:** Participantes convidados possuem `userId: null`. Seus dados de pontuação e apelido são preservados no documento do participante da partida, porém não aparecem no índice secundário `{ userId: 1, matchId: -1 }`.
