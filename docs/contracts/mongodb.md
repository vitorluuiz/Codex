# Contrato de Banco Orientado a Documentos (MongoDB) — Codex

Este documento define o contrato e a modelagem do banco orientado a documentos (MongoDB 7+) do Codex. O MongoDB atua como repositório para **Partidas Finalizadas**, **Histórico Detalhado de Submissões por Participante**, **Métricas Analíticas Congeladas** e **Rascunhos de Autoria**.

---

## 1. Princípios e Estratégia de Modelagem

1. **Snapshots Imutáveis:** Uma partida finalizada é um documento autossuficiente e somente-leitura (*append-only*). O histórico nunca faz joins em tabelas relacionais voláteis de salas ou filas.
2. **Participantes Embutidos (um documento por partida):** A coleção `matches` armazena, em um único documento, o cabeçalho da partida, as fases congeladas, as métricas agregadas da turma **e** a lista `participants[]` — cada participante com suas submissões embutidas. Não existe mais a coleção `match_participants`.
   * O commit de fim de partida é a escrita de um único documento, atômica por definição no MongoDB: nenhuma leitura enxerga participantes órfãos ou partida incompleta.
   * O relatório da partida (participantes × fases) sai de uma única leitura.
   * **Limite de 16 MB aceito conscientemente:** com todas as submissões dentro do documento da partida, o pior caso teórico permitido pelo sistema (400 fases × 500 participantes = 200.000 submissões) excede o teto rígido de 16 MB por documento do MongoDB. Essa limitação foi assumida como decisão de projeto em troca da simplicidade e da atomicidade do modelo de documento único.
3. **Ponteiro Interno de Fase:** As submissões do aluno apontam para o identificador `phaseId` presente no array `phases[]` do próprio documento da partida, garantindo integridade contra qualquer alteração futura em conjuntos ou no catálogo relacional.

---

## 2. Coleções e Esquemas de Documentos

### 2.1 Coleção `matches`
Armazena os dados consolidados da partida, o roteiro executado, os agregados de desempenho e a lista de participantes com suas submissões — tudo em um único documento.

```jsonc
{
  "_id": "01a06cc4-cf85-7f92-b5c1-f099545b0268",     // UUID v7 em formato string
  "schemaVersion": 2,                                // 2 = participantes embutidos (1 = coleção match_participants)
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
  },

  // Gravado na ordem do pódio: totalScore desc, totalElapsedSeconds asc, joinedAt asc.
  // Esquema de cada item na seção 2.2.
  "participants": [
    {
      "participantId": "01a06cc4-a5bc-74a1-8a5d-3a443f5f3e59",
      "userId": "01a069f6-56b0-764c-852e-ec5787df5837",
      "displayName": "Maria Silva",
      "avatarIndex": 1,
      "joinedAt": ISODate("2026-09-25T14:10:00Z"),
      "totalScore": 137,
      "gradedCount": 4,
      "correctCount": 3,
      "pendingCount": 0,
      "totalElapsedSeconds": 41,
      "submissions": [ /* ... */ ]
    }
  ]
}
```

#### Índices da Coleção `matches`
```javascript
db.matches.createIndex({ leaderUserId: 1, finishedAt: -1 });           // Consulta rápida de histórico do líder
db.matches.createIndex({ finishedAt: -1 });                             // Auditoria e varredura cronológica
db.matches.createIndex({ roomCode: 1, finishedAt: -1 });                // Partidas associadas ao código da sala
db.matches.createIndex({ "participants.userId": 1, finishedAt: -1 });  // Histórico do jogador (multikey)
```

> O histórico do líder projeta `participants` para fora (`{ participants: 0 }`): a tela usa apenas cabeçalho, fases e `stats`, e não precisa trazer do disco a folha de respostas da turma.

---

### 2.2 Subdocumento `matches.participants[]`
Folha individual de respostas de cada jogador, embutida no documento da partida. Não possui `_id`, `schemaVersion` nem `matchId` próprios — os três pertencem ao documento pai.

```jsonc
{
  "participantId": "01a06cc4-a5bc-74a1-8a5d-3a443f5f3e59",
  "userId": "01a069f6-56b0-764c-852e-ec5787df5837",  // UUID do usuário (omitido para convidado anônimo)
  "displayName": "Maria Silva",
  "avatarIndex": 1,
  "joinedAt": ISODate("2026-09-25T14:10:00Z"),

  "totalScore": 137,
  "gradedCount": 4,
  "correctCount": 3,
  "pendingCount": 0,
  "totalElapsedSeconds": 41,                          // Critério de desempate do pódio

  "submissions": [
    {
      "phaseId": "01a06cc4-7b82-7cfb-b7b8-a7520c076f7b", // Ponteiro para matches.phases[].phaseId (mesmo documento)
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

#### Unicidade de `participantId`
Um índice único não impede elementos repetidos dentro de um mesmo array. A regra "uma entrada por participante em cada partida" — antes garantida pelo índice único `{ matchId, participantId }` de `match_participants` — é verificada pela API antes da gravação (`MatchDocument.EnsureParticipantsAreUnique`).

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
1. **Montagem do Snapshot:** Os dados da partida, fases, participantes e submissões são consolidados a partir do estado vivo no Redis em uma carga idempotente, já com `participants[]` na ordem do pódio.
2. **Validação:** A API confere que nenhum `participantId` se repete em `participants[]`.
3. **Escrita da Partida (Marcador de Commit):** Uma única operação de *upsert* (`replaceOne` com `upsert: true`) na coleção `matches` com `_id = matchId`. Por ser a escrita de um só documento, ela é atômica: ou a partida inteira (com todos os participantes) fica visível, ou nada fica.
4. **Confirmação:** Apenas após o passo 3 o histórico do líder passa a enxergar a partida finalizada. Não existe estado intermediário com submissões órfãs ou partida incompleta.
5. **Retentativa:** Em caso de falha de conexão no passo 3, o `matchId` permanece em fila de pendência (`commit:pending`) e é retentado de maneira idêntica — o *upsert* substitui o documento pela mesma chave.

### 3.2 Migração de Dados da Versão 1
Partidas gravadas no layout antigo (`schemaVersion: 1`, participantes em `match_participants`) são convertidas uma única vez pelo script idempotente [`mongo/migrations/001-embed-participants.js`](../../mongo/migrations/001-embed-participants.js), que embute os participantes via `$lookup` + `$merge` e, opcionalmente, apaga a coleção antiga.

---

## 4. Invariantes de Dados

1. **Cálculo Único de Estatísticas:** Os valores de `matches.stats` (`avgScore`, `accuracyRate`, `phaseAccuracy`) são calculados estritamente uma única vez durante a gravação inicial do encerramento da partida, utilizando arredondamento `MidpointRounding.AwayFromZero`. O documento nunca é recalculado dinamicamente para impedir divergência entre o placar ao vivo e o histórico gravado.
2. **Desacoplamento de Contas Anônimas:** Participantes convidados não possuem `userId` (o campo é omitido). Seus dados de pontuação e apelido são preservados no item de `participants[]` da partida, porém não são alcançados por consultas por usuário no índice `{ "participants.userId": 1, finishedAt: -1 }`.
3. **Ordem do Pódio Gravada:** `participants[]` é gravado ordenado por `totalScore` decrescente, `totalElapsedSeconds` crescente e `joinedAt` crescente. Como o MongoDB preserva a ordem dos arrays, toda leitura devolve o pódio sem reordenação.
