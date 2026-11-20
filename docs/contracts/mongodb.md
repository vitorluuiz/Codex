# Contrato de Banco Orientado a Documentos (MongoDB) — Codex

Este documento define o contrato e a modelagem do banco orientado a documentos (MongoDB 7+) do Codex. O MongoDB atua como repositório para **Partidas Finalizadas (`matches`)**, **Espaço de Trabalho da Biblioteca do Usuário (`user_workspaces`)**, **Conjuntos Privados do Usuário (`private_phase_sets`)**, **Conjuntos Publicados na Comunidade (`community_phase_sets`)** e **Intenções de Contratação de Planos (`plan_intents`)**.

---

## 1. Princípios e Estratégia de Modelagem

1. **Snapshots Imutáveis:** Uma partida finalizada é um documento autossuficiente e somente-leitura (*append-only*). O histórico nunca faz joins em tabelas relacionais voláteis de salas ou filas.
2. **Participantes Embutidos (um documento por partida):** A coleção `matches` armazena, em um único documento, o cabeçalho da partida, as fases congeladas, as métricas agregadas da turma **e** a lista `participants[]` — cada participante com suas submissões embutidas. Não existe mais a coleção `match_participants`.
   * O commit de fim de partida é a escrita de um único documento, atômica por definição no MongoDB: nenhuma leitura enxerga participantes órfãos ou partida incompleta.
   * O relatório da partida (participantes × fases) sai de uma única leitura.
   * **Limite de 16 MB aceito conscientemente:** com todas as submissões dentro do documento da partida, o pior caso teórico permitido pelo sistema (400 fases × 500 participantes = 200.000 submissões) excede o teto rígido de 16 MB por documento do MongoDB. Essa limitação foi assumida como decisão de projeto em troca da simplicidade e da atomicidade do modelo de documento único.
3. **Ponteiro Interno de Fase:** As submissões do aluno apontam para o identificador `phaseId` presente no array `phases[]` do próprio documento da partida, garantindo integridade contra qualquer alteração futura em conjuntos ou no catálogo relacional.
4. **Isolamento por Cópia nos Conjuntos Privados (`private_phase_sets`):** Cada conjunto privado é um documento independente (evitando o limite de 16 MB que ocorreria se todos os conjuntos ficassem aninhados em um único documento do usuário) e armazena a **cópia completa e embutida** de suas fases (`phases[]`). Quando um usuário adiciona um desafio da comunidade ao seu conjunto privado, o conteúdo do desafio é copiado para dentro do documento privado (registrando `originCommunityPhaseId` e `contentHash`), garantindo que alterações futuras jamais afetem o conjunto do usuário.
5. **Conjuntos da Comunidade por Ponteiros Imutáveis (`community_phase_sets`):** Um conjunto publicado na comunidade armazena seus metadados, um subdocumento `summary` pré-calculado e o array ordenado `phaseIds[]` (máximo 50 UUIDs) apontando para os registros imutáveis da tabela `community_phases` no PostgreSQL. A posição no array define a ordem (`orderIndex`) do desafio no conjunto.
6. **Leitura de Biblioteca sem Joins Cross-DB:** Tanto `private_phase_sets` quanto `community_phase_sets` mantêm o objeto `summary` (`phaseCount`, `phaseKindCounts`, `totalTimeSeconds`, `useCount`, `accuracyRate`). Assim, `GET /phase-sets/owned`, `GET /phase-sets/community` e `GET /phase-sets` leem exclusivamente do MongoDB (projetando `{ phases: 0 }` nos conjuntos privados), com **zero consultas ao PostgreSQL**.

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

### 2.3 Coleção `user_workspaces` (Organização Pessoal da Biblioteca)
Armazena os metadados pessoais de organização da biblioteca de cada usuário (1 documento por `userId`). Pastas vazias e disciplinas personalizadas ficam aqui para permanecerem selecionáveis mesmo quando nenhum conjunto privado ainda está vinculado a elas.

```jsonc
{
  "_id": "01a069ee-9029-76e7-b874-9508fa1a2f13", // userId (UUID do usuário no PostgreSQL)
  "folders": ["Matemática 2º ano", "Programação", "Provas"],
  "subjects": ["Matemática", "Programação", "Estatística"],
  "coverUrl": null,
  "savedCommunitySetIds": ["01a07000-1111-7000-8000-000000000001"],
  "updatedAt": ISODate("2026-11-13T14:00:00Z")
}
```

---

### 2.4 Coleção `private_phase_sets` (Conjuntos Privados com Fases Embutidas)
Repositório dos conjuntos privados de cada autor. Cada conjunto é um documento independente (evitando o limite de 16 MB por documento caso todos os conjuntos ficassem aninhados no documento do usuário) e contém a **cópia completa e isolada** das fases em `phases[]`.

```jsonc
{
  "_id": "01a069f5-8351-7c3f-aa88-50364832e5c1", // setId (UUID v7)
  "ownerId": "01a069ee-9029-76e7-b874-9508fa1a2f13",
  "title": "Revisão para o simulado",
  "subject": "Matemática",
  "folder": "Provas",
  "coverUrl": null,
  "createdAt": ISODate("2026-11-10T10:00:00Z"),
  "updatedAt": ISODate("2026-11-12T15:30:00Z"),

  "publishedSetId": null,
  "publishedVersion": null,

  // Resumo pré-calculado ao salvar (permite montar os cards da biblioteca projetando { phases: 0 })
  "summary": {
    "phaseCount": 14,
    "phaseKindCounts": { "quiz": 9, "fill": 3, "text": 2 },
    "totalTimeSeconds": 4200,
    "useCount": 3,
    "submissionsCount": 90,
    "correctSubmissionsCount": 64,
    "accuracyRate": 71
  },

  // Cópia completa e isolada das fases (seja criada do zero ou copiada de community_phases)
  "phases": [
    {
      "id": "01a069f5-835e-73d4-9f5d-b86c84c20733",
      "originCommunityPhaseId": "01a05555-2222-7000-8000-999999999999",
      "contentHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "kind": "quiz",
      "name": "Soma de Frações",
      "basePoints": 100,
      "pointsMultiplier": 1.0,
      "timeSeconds": 30,
      "orderIndex": 0,
      "content": {
        "question": "Quanto é 1/2 + 1/4?",
        "fromAI": false,
        "options": ["3/4", "2/6", "1/6", "2/4"],
        "correctIndexes": [0]
      }
    }
  ]
}
```

#### Índices da Coleção `private_phase_sets`
```javascript
db.private_phase_sets.createIndex({ ownerId: 1, updatedAt: -1 });
db.private_phase_sets.createIndex({ ownerId: 1, folder: 1, updatedAt: -1 });
```

---

### 2.5 Coleção `community_phase_sets` (Catálogo de Conjuntos da Comunidade)
Armazena conjuntos imutáveis publicados na comunidade. Em vez de duplicar o conteúdo completo das fases, aponta ordenadamente via `phaseIds[]` para a tabela imutável `community_phases` no PostgreSQL.

```jsonc
{
  "_id": "01a07000-1111-7000-8000-000000000001", // UUID v7
  "sourcePrivateSetId": "01a069f5-8351-7c3f-aa88-50364832e5c1",
  "version": 1,
  "authorId": "01a069ee-9029-76e7-b874-9508fa1a2f13",
  "authorName": "Marina Duarte",
  "title": "Big-O sem sofrimento",
  "subject": "Programação",
  "coverUrl": "/mock/cover-5.svg",
  "status": "published", // "published" | "delisted"
  "publishedAt": ISODate("2026-11-01T18:00:00Z"),

  // Vetor ordenado com os IDs dos desafios em `community_phases` (PostgreSQL).
  // A posição no array (0..N-1) define a ordem de execução das fases no conjunto.
  "phaseIds": [
    "01a05555-2222-7000-8000-999999999999",
    "01a05555-3333-7000-8000-888888888888"
  ],

  // Resumo pré-calculado na publicação para listagem e filtros instantâneos da aba Comunidade
  "summary": {
    "phaseCount": 10,
    "phaseKindCounts": { "code": 6, "quiz": 4 },
    "kinds": ["code", "quiz"],
    "totalTimeSeconds": 2700,
    "useCount": 1840,
    "submissionsCount": 18400,
    "correctSubmissionsCount": 11776,
    "accuracyRate": 64
  }
}
```

#### Índices da Coleção `community_phase_sets`
```javascript
db.community_phase_sets.createIndex({ status: 1, subject: 1, "summary.useCount": -1 });
db.community_phase_sets.createIndex({ status: 1, publishedAt: -1 });
db.community_phase_sets.createIndex({ authorId: 1, status: 1, publishedAt: -1 });
db.community_phase_sets.createIndex({ phaseIds: 1 }); // Multikey: localiza conjuntos que contêm um desafio
db.community_phase_sets.createIndex({ title: "text" }, { default_language: "portuguese" });
```

---

### 2.6 Coleção `plan_intents` (Pesquisa Provisória de Intenção de Planos)
Armazena a resposta mais recente de cada usuário no formulário provisório da seção **Pagamentos e plano** (1 documento por `userId`, atualizado via *upsert*).

```jsonc
{
  "_id": "01a069ee-9029-76e7-b874-9508fa1a2f13", // userId (UUID do usuário no PostgreSQL)
  "userEmail": "marina@escola.br",
  "userName": "Marina Duarte",
  "audience": "teacher",                         // "teacher" | "recruiter"
  "currentPlan": "free",                         // "free" | "intermediate" | "pro"
  "selectedPlan": "intermediate",                // "free" | "intermediate" | "pro"
  "suggestedPriceBrl": 11,                       // 0 (free), 11 (intermediate), 35 (pro)
  "pricePerception": "fair",                     // "expectedLower" | "fair" | "expectedHigher"
  "subscriptionIntent": "yes",                   // "yes" | "maybe" | "no"
  "expectedPriceBrl": null,                      // opcional quando pricePerception != "fair"
  "comment": "Ótimo custo-benefício",            // opcional (máx. 500 caracteres)
  "submissionCount": 1,
  "createdAt": ISODate("2026-11-19T23:00:00Z"),
  "updatedAt": ISODate("2026-11-19T23:00:00Z")
}
```

#### Índices da Coleção `plan_intents`
```javascript
db.plan_intents.createIndex({ selectedPlan: 1, updatedAt: -1 });
db.plan_intents.createIndex({ subscriptionIntent: 1, pricePerception: 1 });
db.plan_intents.createIndex({ updatedAt: -1 });
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

## 4. Protocolo de Publicação e Reuso entre MongoDB e PostgreSQL

1. **Importação de desafio avulso da comunidade para conjunto privado:** Ao escolher um desafio em `community_phases` (PostgreSQL), o conteúdo completo é copiado para dentro de `private_phase_sets.phases[]` (MongoDB) registrando `originCommunityPhaseId` e `contentHash`. O conjunto privado permanece isolado de quaisquer versões futuras na comunidade.
2. **Publicação de conjunto privado na comunidade:**
   * Para cada item em `private_phase_sets.phases[]`:
     * Se `originCommunityPhaseId != null` e o `contentHash` canônico atual for idêntico ao registro original em `community_phases`, reutiliza-se o mesmo UUID em `phaseIds[]` (sem duplicar linhas no PostgreSQL).
     * Caso contrário (fase inédita do autor ou cópia modificada), insere-se um novo registro imutável em `community_phases` no PostgreSQL (mantendo `OriginPhaseId = originCommunityPhaseId` se derivado) e adiciona-se o novo UUID em `phaseIds[]`.
   * Somente após o `COMMIT` no PostgreSQL o documento imutável em `community_phase_sets` é gravado no MongoDB, evitando referências órfãs a desafios inexistentes.

---

## 5. Invariantes de Dados

1. **Cálculo Único de Estatísticas:** Os valores de `matches.stats` (`avgScore`, `accuracyRate`, `phaseAccuracy`) são calculados estritamente uma única vez durante a gravação inicial do encerramento da partida, utilizando arredondamento `MidpointRounding.AwayFromZero`. O documento nunca é recalculado dinamicamente para impedir divergência entre o placar ao vivo e o histórico gravado.
2. **Desacoplamento de Contas Anônimas:** Participantes convidados não possuem `userId` (o campo é omitido). Seus dados de pontuação e apelido são preservados no item de `participants[]` da partida, porém não são alcançados por consultas por usuário no índice `{ "participants.userId": 1, finishedAt: -1 }`.
3. **Ordem do Pódio Gravada:** `participants[]` é gravado ordenado por `totalScore` decrescente, `totalElapsedSeconds` crescente e `joinedAt` crescente. Como o MongoDB preserva a ordem dos arrays, toda leitura devolve o pódio sem reordenação.
4. **Imutabilidade do Conteúdo Publicado:** Documentos em `community_phase_sets` nunca têm `phaseIds[]`, `title` ou `version` alterados após publicação; atualizações em `summary` afetam exclusivamente métricas de uso e acerto (`useCount`, `submissionsCount`, `correctSubmissionsCount`, `accuracyRate`).
