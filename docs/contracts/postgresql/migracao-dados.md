# Migração de dados — etapa 1

Terceiro documento da série. O [`sql.md`](./sql.md) mostra **como os dados estão guardados hoje**; o
[`arquitetura-dados.md`](./arquitetura-dados.md) responde **para onde vão e o que cada escolha cobra**.
Este aqui fecha a **modelagem alvo desta etapa** e registra as decisões tomadas agora, com a forma
exata de cada store e a fronteira entre os três serviços.

> **Por que este arquivo mora em `postgresql/`** se §4 é Redis e §5 é Mongo: ele é o terceiro de
> uma conversa que começou aqui, e separá-lo dos dois documentos que ele responde custaria mais do
> que a pasta com nome estreito. A pasta é o histórico, não o assunto.

Escopo desta etapa, nas palavras do pedido:

- `room_queue_sets` e `room_queue_phases` **saem do SQL** e viram estado do servidor de realtime.
- `rooms` **sai do SQL** pelo mesmo caminho. `LeaderUserId` continua sendo um `uuid` que aponta para
  `users` no Postgres.
- `matches` **deixa de ter relação com sala** no banco. Cada partida é cadastrada **ao terminar**,
  com os dados vindos do realtime.
- A nova estrutura de partida vive num **banco orientado a documentos**.

---

## 1. As quatro decisões desta etapa

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Quem executa a lógica de sala e fila? | **O servidor de realtime (Node).** O Redis é o store; o processo Node é o dono das regras. |
| 2 | Como as submissões ficam no documento? | **Bucket por participante**: `matches` + `match_participants`, com as submissões embutidas no participante. |
| 3 | Cada submissão carrega cópia da fase? | **Não.** A fase é congelada uma vez em `matches.phases[]`; a submissão guarda um ponteiro. |
| 4 | O que esta etapa entrega? | Modelagem + este documento + a implementação. |

Premissas herdadas do `arquitetura-dados.md` (não se re-decidem aqui): o motor da migração é
aprendizado/portfólio, persistência poliglota é o objetivo em si; publicação de conjunto é versão
imutável; revogação de reuso fica adiada.

---

## 2. O desenho alvo

| Store | Guarda depois desta etapa |
|---|---|
| **Postgres** | `users`, `phase_sets`, `phases`, `DataProtectionKeys`. Identidade e o material didático do autor. |
| **Redis** | Sala, participantes vivos, fila de conjuntos, fila de fases, partida em andamento e suas submissões. Tudo efêmero, com TTL. |
| **Mongo** | `matches` e `match_participants`. Partida finalizada, snapshot autossuficiente, append-only. |

O que **sai** do Postgres nesta etapa: `rooms`, `participants`, `room_queue_sets`,
`room_queue_phases`, `matches`, `submissions`. Seis das nove tabelas de domínio.

O que **não** muda: `users`, `phase_sets`, `phases`. O catálogo publicado
(`published_phase_sets` / `published_phases`) do §3.1 do `arquitetura-dados.md` continua fora do
escopo — é o passo 5 daquele documento e não depende deste.

---

## 3. Postgres depois da etapa

```
users            Id, Name, Email (UNIQUE), PasswordHash?, AvatarIndex, Plan, Audience, CreatedAt
phase_sets       Id, Title, OwnerId -> users CASCADE, Visibility, CreatedAt, UpdatedAt
phases           Id, PhaseSetId -> phase_sets CASCADE, Kind, Name, BasePoints,
                 PointsMultiplier numeric(5,2), TimeSeconds, OrderIndex, ContentJson jsonb
DataProtectionKeys
```

Três consequências de tirar `rooms` daqui:

1. **`FK_rooms_users_LeaderUserId` era `RESTRICT`** (`RoomConfiguration.cs:17-20`) — a única
   constraint que impedia apagar um usuário que já liderou sala. Ela desaparece. Apagar um `User`
   passa a deixar `leaderUserId` pendurado no Redis e nos documentos de partida já gravados. É
   aceitável (o documento da partida é imutável por desenho e guarda `displayName` de quem jogou),
   mas precisa ser uma escolha registrada, não um efeito colateral.
2. **`participants.UserId` era `SET NULL`.** Some junto. O vínculo pessoa↔partida passa a ser
   `match_participants.userId`, que é um `uuid` solto — linhagem, não referência, pelo mesmo motivo
   que `SourcePhaseSetId` nunca foi FK.
3. **`submissions.RoomQueuePhaseId` era o único caminho relacional de uma resposta até a pergunta
   que ela respondeu** (`sql.md` §5). Some. O substituto é o ponteiro para `matches.phases[]` — §5.4.

---

## 4. Redis — sala, fila e partida viva

### 4.1 Mapa de chaves

Namespace novo `codex:room:`, separado do `codex:rt:` que já existe para pub/sub e tickets.

| Chave | Tipo | Conteúdo |
|---|---|---|
| `code:{code}` | STRING | `roomId`. Reserva do código de 6 dígitos. `SET NX EX` |
| `room:{roomId}` | HASH | `code, status, matchMode, capacity, locked, requireAccount, leaderUserId, createdAt, expiresAt, queueRevision` |
| `room:{roomId}:names` | SET | `lower(displayName)` de quem não está `Rejected` |
| `room:{roomId}:parts` | HASH | `participantId` → JSON do participante |
| `room:{roomId}:parts:idx` | ZSET | score = `joinedAt` — reproduz a ordenação `(RoomId, Status, JoinedAt)` |
| `room:{roomId}:queue:sets` | ZSET | score = `orderIndex` → `queueSetId` |
| `room:{roomId}:qset:{id}` | HASH | `sourcePhaseSetId, title, color, orderIndex` |
| `room:{roomId}:queue:phases` | ZSET | score = `orderIndex` → `queuePhaseId` |
| `room:{roomId}:qphase:{id}` | HASH | `queueSetId, sourcePhaseId, kind, name, basePoints, pointsMultiplier, timeSeconds, orderIndex, contentJson, openJson, closedJson` |
| `match:{matchId}` | HASH | `roomId, mode, status, currentPhaseIndex, startedAt, currentPhaseStartedAt, currentPhaseEndsAt, currentPhaseEndedAt, pausedSecondsLeft` |
| `match:{matchId}:subs` | HASH | `{queuePhaseId}:{participantId}` → JSON da submissão, **`readyAt` incluído** |
| `match:{matchId}:agg:{queuePhaseId}` | HASH | contadores da fase: `submitted, graded, correct, scoreSum` |
| `user:{userId}:led` | SET | `roomId` das salas que a pessoa lidera |
| `user:{userId}:joined` | SET | `roomId` das salas em que a pessoa entrou |
| `commit:pending` | SET | `matchId` de partidas encerradas ainda não confirmadas no Mongo |

As duas chaves de usuário existem porque `GET /rooms/active` hoje é um `OR` entre "sou líder" e "sou
participante não-rejeitado" numa query só (`RoomService.cs:164-221`). Sem índice secundário, o Redis
não responde isso — o índice reverso tem que ser mantido à mão, nas mesmas operações que criam a
sala e o participante.

### 4.2 As três garantias que hoje são do Postgres

| Garantia hoje | Onde está | No Redis |
|---|---|---|
| 1 envio por pessoa/fase/partida | índice único `(MatchId, RoomQueuePhaseId, ParticipantId)` (`SubmissionConfiguration.cs:41`) | `HSETNX match:{id}:subs {phase}:{participant}` — equivalência limpa |
| Código de sala livre entre ativas | `GenerateCodeAsync` com retry e janela de corrida (`RoomService.cs:115-139`) | `SET code:{code} {roomId} NX EX` — **melhor** que hoje: fecha a janela |
| Apelido único por sala | índice único **parcial** `(RoomId, DisplayNameNormalized) WHERE "Status" <> 'Rejected'` (`ParticipantConfiguration.cs:38-41`) | **não é equivalência limpa** — ver abaixo |

O `WHERE` do índice parcial significa que **recusar alguém devolve o apelido para a sala**. Um
`SADD` sozinho nunca devolve. As duas operações — entrar (reservar apelido + conferir capacidade +
criar participante) e recusar (liberar apelido + mudar status) — precisam ser atômicas, e são:

**Scripts Lua obrigatórios** (a seção crítica não pode viver no código de aplicação):

| Script | Substitui |
|---|---|
| `room_claim_code` | `GenerateCodeAsync` + INSERT da sala |
| `participant_join` | `EnsureDisplayNameFreeAsync` + `CountOccupancyAsync` + INSERT, hoje três passos separados |
| `participant_reject` | UPDATE de status + devolução do apelido (`SREM`) |
| `participant_remove` | DELETE + `SREM` + limpeza do índice reverso |
| `queue_reorder` | a regra `409 QUEUE_MISMATCH` de `RoomQueueService.cs:364-403`: a lista enviada tem que ser exatamente o conjunto de ids atuais |
| `submission_put` | `HSETNX` + incremento dos contadores agregados da fase |
| `submission_ready` | `MarkReadyAsync`: escreve `readyAt` **dentro** da submissão que já existe |
| `phase_restart` | `RestartPhaseAsync` (`MatchService.cs:262-285`): apaga as submissões da fase corrente **e zera os contadores dela** |

Duas observações sobre as duas últimas.

`ReadyAt` não ganha chave própria: ele mora dentro do JSON da submissão, porque `MarkReadyAsync`
já exige ter respondido antes (`400 VALIDATION_ERROR` senão), então o campo nunca existe sozinho.
Duas chaves com a mesma chave composta e um só campo de destino no Mongo é o jeito garantido de um
implementador esquecer uma delas no commit.

`phase_restart` é **a única mutação que decrementa**. Reiniciar a fase apaga as submissões dela — e
junto com elas os `readyAt`. Se os contadores agregados não forem zerados no mesmo passo atômico, o
painel do líder passa a mostrar "12 de 8 responderam" pelo resto da partida, sem erro em lugar
nenhum.

`DisplayNameNormalized` era uma **coluna computada STORED** do Postgres
(`ParticipantConfiguration.cs:19-20`). Vira responsabilidade do `participant_join`: normalizar e
gravar passam a ser o mesmo passo, dentro do script.

### 4.3 TTL e política de memória

`redis/redis.conf` hoje:

```
maxmemory 256mb
maxmemory-policy allkeys-lru
```

Isso está correto para pub/sub e tickets de 30 s. **Deixa de estar no momento em que a sala vira
fonte da verdade**: sob pressão de memória, `allkeys-lru` descarta a sala de alguém no meio da
partida, em silêncio, sem erro em lugar nenhum.

Requisito: **`database` separado** (`REDIS_STATE_DB`) com `maxmemory-policy noeviction`,
`appendonly yes` mantido, e **TTL explícito por chave**:

| Momento | TTL da sala |
|---|---|
| Criada, sem partida | 24 h, renovado a cada mutação — resolve as "salas abandonadas" do §8 do `arquitetura-dados.md` |
| Partida em andamento | renovado a cada transição de fase; a sala nunca expira debaixo de uma partida viva |
| Partida encerrada e **confirmada** no Mongo | 24 h — o mesmo `RoomLifetimeAfterMatch` de `MatchService.cs:49` |
| Partida encerrada e **não** confirmada | TTL não encurta; o `matchId` fica em `commit:pending` |

---

## 5. Mongo — a partida finalizada

### 5.1 `matches` — um documento por partida

```jsonc
{
  "_id": "01a06cc4-cf85-7f92-b5c1-f099545b0268",     // UUID v7, o mesmo Guid.CreateVersion7()
  "schemaVersion": 1,
  "roomCode": "969180",
  "roomId": "01a06cc4-7b7f-7025-ba5d-98a2c92dfbb6",  // linhagem: a sala pode não existir mais
  "leaderUserId": "01a069ee-9029-76e7-b874-9508fa1a2f13",  // -> users, no Postgres
  "mode": "live",
  "startedAt": "2026-09-04T14:13:52Z",
  "finishedAt": "2026-09-04T14:14:08Z",

  "phaseSets": [
    { "queueSetId": "01a06a04-380f-…", "sourcePhaseSetId": "01a069f5-8351-…",
      "title": "Conjunto de exemplo", "color": "var(--blue-500)", "orderIndex": 0 }
  ],

  "phases": [
    { "phaseId": "01a06cc4-7b82-…", "queueSetId": "01a06a04-380f-…",
      "sourcePhaseId": "01a069f5-835e-…", "orderIndex": 0,
      "kind": "quiz", "name": "Pergunta fácil de soma",
      "basePoints": 50, "pointsMultiplier": 1.0, "timeSeconds": 15, "maxScore": 50,
      "content": { "question": "Quanto é 1 + 2?", "fromAI": false,
                   "options": ["3","2","1","4"], "correctIndexes": [0] } }
  ],

  "stats": {
    "participantCount": 1, "avgScore": 137, "maxScore": 325, "accuracyRate": 100,
    "phaseAccuracy": [100, null, null, 100], "phaseAvgScore": [42, null, null, 95]
  }
}
```

`maxScore` por fase é `round(basePoints × pointsMultiplier)` — o resultado de `PhaseGrading.Score`
com acerto total e bônus de tempo máximo, já que `MinimumTimeBonus = 0.5m`
(`PhaseGrading.cs:24,203-216`) faz o bônus chegar a exatamente `1.0` quando não se gasta tempo
nenhum. Ele **não** é digitado à mão no documento: sai de um `PhaseGrading.MaxScore(phase)` novo,
derivado da mesma fórmula, para os dois números não poderem divergir.

> O exemplo do `arquitetura-dados.md` §3.3 traz `basePoints: 50, pointsMultiplier: 1.0,
> maxScore: 75`. 75 não sai dessa conta — o valor correto para aquela fase é 50.

Índices:

```
{ leaderUserId: 1, finishedAt: -1 }   // histórico do líder
{ finishedAt: -1 }                    // varredura por período
{ roomCode: 1, finishedAt: -1 }       // "as partidas daquele código"
```

**`matches` não guarda `participants[]`.** Quem quer participante lê `match_participants` — o pódio,
o relatório, o perfil do jogador. O que fica aqui é só o agregado, e ele existe por um motivo
específico: o histórico do líder precisa de `participantCount`, `avgScore` e `accuracyRate` por
linha, e `LeaderMatchSummaryDto` **não tem nenhum campo por participante além da contagem** — então
uma leitura de `matches` resolve a tela inteira, sem tocar na outra coleção.

> **Invariante de `stats`.** É uma cópia denormalizada de números cuja fonte é
> `match_participants`. Ela é calculada **uma vez, no commit, a partir do mesmo payload em memória
> que gera os documentos de participante** — nunca recalculada depois, nunca corrigida por um
> `$set`. Sem essa regra, a primeira rota de "recalcular estatísticas" cria uma segunda verdade
> sobre a média de alguém. É o mesmo cuidado que `MatchStatsService` já documenta ao exigir que
> `teamAvgScore` e `scoreboard.avgScore` saiam do **mesmo** `MatchTotalsAsync`.

### 5.2 `match_participants` — um documento por participante por partida

```jsonc
{
  "_id": "01a06cc4-a5bc-74a1-8a5d-3a443f5f3e59",
  "schemaVersion": 1,
  "matchId": "01a06cc4-cf85-7f92-b5c1-f099545b0268",
  "participantId": "01a06cc4-a5bc-74a1-8a5d-3a443f5f3e59",
  "userId": "01a069f6-56b0-764c-852e-ec5787df5837",   // null = convidado, sem histórico
  "displayName": "Maria",
  "avatarIndex": 1,
  "joinedAt": "2026-09-04T14:13:41Z",

  "totalScore": 137, "gradedCount": 2, "correctCount": 2, "pendingCount": 2,

  "submissions": [
    { "phaseId": "01a06cc4-7b82-…", "phaseOrderIndex": 0, "maxScore": 50,
      "answer": { "kind": "quiz", "optionId": "o1" },
      "submittedAt": "2026-09-04T14:13:57Z", "elapsedSeconds": 5, "readyAt": null,
      "grading": "graded", "correct": true, "score": 42,
      "explanation": null, "aiSuggestions": null, "testsPassed": null }
  ]
}
```

Índices:

```
{ matchId: 1, participantId: 1 }  UNIQUE   // reproduz a unicidade que o Postgres garantia
{ matchId: 1 }                             // a matriz do relatório, numa consulta só
{ userId: 1, matchId: -1 }                 // histórico do jogador (§4.4 do arquitetura-dados)
```

### 5.3 Por que bucket por participante, e não um documento só

O teto do Mongo é **rígido**: 16 MB por documento. O pior caso que a aplicação já aceita hoje:

```
MaxSetsPerRoom  ×  MaxPhasesPerSet   =    8 × 50   =   400 fases numa fila
                         MaxCapacity =            500 participantes
```

| Layout | Submissões no maior documento | Cota por submissão |
|---|---:|---:|
| Tudo embutido em `matches` | 400 × 500 = **200.000** | 84 bytes |
| **Bucket por participante** | **400** — o máximo que *uma* pessoa envia | **~41 KB** |

84 bytes não cabem: `{"kind":"quiz","optionId":"o1"}` sozinho já tem 31, antes de `phaseId`,
`submittedAt`, `score` e o resto da linha. 41 KB cabem com folga — e o bucket tem um teto
**estrutural**, não estatístico: nenhuma sala pode fazer um participante enviar mais de 400
respostas.

Isso não dispensa o limite de tamanho de texto do passo 1. Uma fase `code` carrega `source` livre, e
`sql.md` §1.1 mostra que **não há validação de tamanho nenhuma** hoje. Com um teto de 8 KB por
`source`, o pior caso do bucket fica em ~3,2 MB. Sem teto, nenhum layout é seguro — e o problema
aparece antes, no `maxmemory` do Redis, onde estourar é estritamente pior: no meio da partida ainda
não existe snapshot para o qual retentar.

`matches` fica pequeno e previsível: 400 fases de conteúdo, uma vez. É ele que o histórico lê, e é
por isso que os agregados de que o histórico precisa moram em `matches.stats`, não em
`match_participants`.

> **O teto vale para conteúdo escrito a partir de agora.** Os limites são cobrados na escrita
> (editor, `PATCH` da fila, resposta do aluno); linhas que já existiam não são revalidadas, e
> `RoomQueueService.AppendSetAsync` copia o `ContentJson` literal sem passar por validação de
> novo — é o que faz a cópia ser imune a edições, e o preço é esse. Um conjunto autorado antes
> desta mudança pode ter um enunciado acima do teto e chegar inteiro ao documento da partida. Se
> isso importar, a varredura é um `select` por `length(ContentJson)` antes do passo 5.

### 5.4 A decisão fase ↔ submissão

**A submissão guarda um ponteiro, não uma cópia da fase.**

```
matches.phases[]                        submissions[]
  phaseId: "01a0…733"   ◀───────────────  phaseId: "01a0…733"
  content: { … gabarito … }               phaseOrderIndex: 0
  maxScore: 50                            maxScore: 50
                                          answer: { kind:"quiz", optionId:"o1" }
```

Três argumentos, em ordem de peso:

1. **O motivo da cópia já foi satisfeito um nível acima.** `RoomQueueService.cs:174` copia o
   `ContentJson` literalmente, gabarito incluído, para a fila ficar imune a edições posteriores no
   conjunto de origem. Dentro de um documento de partida *finalizada*, `phases[]` já é um snapshot
   imutável e escopado àquela partida. Copiar de novo por submissão não compra imunidade nenhuma
   que já não exista.
2. **O custo é multiplicativo.** 30 participantes × 20 fases: ~40 KB de conteúdo viram ~1,2 MB. Uma
   fase `code` replica `starterCode` e `testCases` inteiros em cada uma das 30 linhas.
3. **Referenciar para *fora* do documento seria pior que as duas.** `optionId` é **posicional** —
   `"o1"` significa "o primeiro item de `options`" (`sql.md` §4.1 e §7.5). Uma submissão que
   apontasse para `phases` ou para o catálogo publicado no Postgres seria reinterpretada em silêncio
   se o autor reordenasse as opções, e um relatório de seis meses atrás mudaria sozinho.

**Invariante a escrever no código e nos testes:** a geração de relatório resolve `answer` **sempre**
contra `matches.phases[]` da mesma partida, nunca contra `phases` nem contra o catálogo publicado.
O ponteiro é interno ao documento; é isso que o torna seguro.

Os campos denormalizados na submissão são exatamente dois — `phaseOrderIndex` e `maxScore`. Ambos
`int`, ambos imutáveis, e juntos permitem ordenar uma linha de relatório e calcular uma porcentagem
sem resolver nada.

---

## 6. A fronteira entre os três serviços

Esta etapa inverte duas das três regras do `README.md` raiz. Vale escrever o que passa a valer.

| Hoje | Depois |
|---|---|
| "O realtime não é dono de estado. Toda mutação passa pela API." | **O realtime é dono do estado vivo** — sala, fila, partida em andamento. A API é dona de identidade, catálogo e histórico. |
| "Autorização num lugar só": o realtime pergunta à API quem é quem *e* qual é o papel. | **Duas perguntas, dois donos.** *Quem é você* continua sendo da API — o token de sessão é opaco e só ela o decifra. *Qual é o seu papel nesta sala* passa a ser do realtime, que lê do Redis. |
| "O browser nunca fala com a API REST." | Inalterado. O browser fala com o servidor do Next e com o WebSocket. |

O eixo que organiza a divisão: **o realtime é dono de estado; a API é dona de semântica de conteúdo
e de identidade.** Toda vez que for preciso interpretar o `ContentJson` de uma fase — projetar para
a tela, corrigir uma resposta, calcular uma nota — quem responde é a API.

### 6.1 Superfície interna nova, no lado da API

Todas atrás do `ServiceTokenMiddleware`, chamadas pelo realtime.

| Rota | Para quê |
|---|---|
| `POST /internal/realtime/identity` | Substitui `/internal/realtime/resolve`. Recebe `sessionToken` ou `ticket`; devolve `{ userId, name, avatarIndex }`. **Não sabe mais nada de sala** — o papel virou responsabilidade do chamador. |
| `GET /internal/users/{id}/card` | Nome e avatar do líder, para o lobby. |
| `POST /internal/phase-sets/{id}/snapshot` | O copy-on-enqueue. Valida dono/visibilidade — o predicado de `RoomQueueService.cs:207` — e devolve o conjunto e as fases congelados, **já com as duas projeções prontas** (§6.2). |
| `POST /internal/phases/grade` | Corrige uma resposta. Entrada: snapshot da fase + `answer` + `secondsRemaining`. Saída: `{ grading, correct, score }`. Mantém `PhaseGrading` como implementação única. |
| `POST /internal/matches` | O commit do fim de partida. Recebe o payload inteiro e grava no Mongo. Idempotente. |

### 6.2 Por que a API pré-computa as projeções

`PhaseProjection` decide o que o aluno vê: os `optionId` posicionais do quiz, os `segments` do fill,
os `examples` parseados do `testCases` do code — nada disso é persistido, tudo é derivado na leitura.
E `includeAnswers` segue a **fase** (fechada?), nunca o papel de quem pediu.

Se o realtime tivesse que servir a fase, teria que portar `PhaseProjection`, `PhaseContent` e o
parser de `testCases` para TypeScript. Em vez disso, `POST /internal/phase-sets/{id}/snapshot`
devolve, por fase, **três blobs**:

```
contentJson   a forma de autoria, com gabarito — o que vai para o documento da partida
openJson      a projeção sem gabarito — o que o aluno recebe enquanto a fase está aberta
closedJson    a projeção com gabarito — o que todos recebem depois que a fase fecha
```

O realtime nunca interpreta nenhum dos três: guarda em `room:{roomId}:qphase:{id}` e escolhe qual
servir pelo estado da fase. **Zero regra de conteúdo duplicada em TypeScript.**

O mesmo vale para a correção: o realtime chama `POST /internal/phases/grade` em vez de reimplementar
`score = round(basePoints × pointsMultiplier × acerto × bônusDeTempo)`. Uma fórmula, uma linguagem,
um conjunto de testes.

### 6.3 O que o realtime passa a fazer sozinho

- Ciclo de vida da sala: criar, ler, configurar, expirar.
- Participantes: entrar, aprovar, recusar, remover, apelido único, capacidade.
- Fila: adicionar/remover conjunto, editar/remover fase, reordenar, `queueRevision`.
- Partida: iniciar, avançar, pausar, reiniciar fase, encerrar, voltar ao lobby.
- Cronômetro e o **fechamento preguiçoso** de fase expirada — hoje em `MatchService.cs:479-496`,
  idempotente via `currentPhaseEndedAt`, sem job. A propriedade se preserva: quem chegar primeiro
  depois do `endsAt` fecha.
- Estatísticas **ao vivo** do painel do líder e do pódio. Hoje `MatchStatsService` calcula tudo
  on-the-fly a partir de `Submission` + `Participant`; com as submissões no Redis, o cálculo vai
  junto. As regras sutis precisam viajar inteiras: taxa de acerto sobre **corrigidos** e não sobre
  enviados; média por pessoa aprovada, com zero explícito para quem não pontuou; desempate do pódio
  por menor tempo somado e depois por `joinedAt`; exclusão de quem está `inResultsSince` da
  contagem de jogadores da partida seguinte.
- As mutações passam a ser chamadas pelo servidor do Next, por HTTP interno com `x-service-token` —
  o mesmo formato que as Server Actions já usam para a API. O browser continua sem falar com nenhum
  dos dois diretamente.

---

## 7. O commit do fim de partida

Não existe `BeginTransaction` em lugar nenhum da API hoje; toda atomicidade é um `SaveChangesAsync`
só. E três métodos escrevem `rooms` **e** `matches` no mesmo save — `MatchService.StartAsync`,
`FinishCoreAsync` e `ReturnToLobbyAsync`. Com sala no Redis e partida no Mongo, viram operações em
dois stores sem transação distribuída.

**Regra: a escrita no Mongo é o ponto de commit.**

```
1. realtime  monta o payload a partir do Redis            (idempotente)
2. realtime  POST /internal/matches                       (pode ser retentado)
3. API       upsert em match_participants                 (bulk, chave {matchId, participantId})
4. API       upsert em matches                            ← o marcador de commit
5. API       200
6. realtime  encurta o TTL da sala, limpa match:{id}:*    (best-effort)
```

A ordem 3→4 não é negociável: `matches` é a coleção que o histórico consulta, então gravá-la por
último significa que **nenhuma leitura enxerga uma partida pela metade**. Se o passo 4 falhar, a
partida simplesmente não existe ainda e o passo 2 pode ser refeito.

Se o passo 2 falhar: o `matchId` fica em `commit:pending`, o TTL da sala **não** encurta, e o
realtime retenta com backoff — inclusive drenando `commit:pending` no boot, para uma instância que
morreu no meio não perder a partida.

Montar o payload precisa ser idempotente: montar duas vezes tem que dar o mesmo resultado. O
precedente já existe — `currentPhaseEndedAt` é exatamente um fechamento preguiçoso idempotente, e
`FinishCoreAsync` já começa verificando se a partida já terminou.

### 7.1 Durante a escrita dupla, os dois lados são comparáveis — e é a hora de testar isso

No passo 3 quem monta o payload ainda é a **API**, a partir do Postgres: `FinishCoreAsync` é o único
ponto de encerramento (os dois gatilhos — botão do líder e fim automático da última fase — já passam
por lá) e já é idempotente. O realtime só vira o produtor no passo 7, e `POST /internal/matches`
aceita **o mesmo DTO** nos dois casos, para o passo 7 trocar só quem chama.

Enquanto os dois lados convivem, existe uma verificação que não existe nem antes nem depois: para a
mesma partida encerrada, os agregados do documento do Mongo têm que bater com o que
`MatchStatsService` e `GetMatchHistoryAsync` calculam do Postgres. **Esse é o teste mais valioso da
migração inteira, e ele só é possível nos passos 3 e 4.** Escrever depois é tarde — no passo 5 o
lado do Postgres deixa de existir.

Dois limites a registrar, herdados do §4.4 do `arquitetura-dados.md`:

- **Convidado não tem histórico.** `userId` é nulo para quem entra sem conta. O documento guarda
  `displayName` e pontuação, mas a pessoa não aparece em `{ userId: 1, matchId: -1 }`.
- **O snapshot é tirado no fim.** Quem for removido antes do encerramento não estará no documento —
  hoje `RemovePlayerAsync` apaga a linha do participante e todas as submissões dele.

---

## 8. O que quebra, e em que ordem consertar

### 8.1 O histórico do líder é o nó da ordem

`UserProfileService.GetMatchHistoryAsync` (`UserProfileService.cs:167-203`) é uma query em cinco
tabelas:

```csharp
db.Matches.Where(m => m.Room.LeaderUserId == userId && m.FinishedAt != null)
  .Select(m => new {
      SetTitles        = m.Room.QueueSets.OrderBy(s => s.OrderIndex).Select(s => s.Title).ToList(),
      ParticipantCount = m.Room.Participants.Count(p => p.Status == ParticipantStatus.Approved),
      ScoreSum         = m.Submissions.Sum(s => s.Score),
      GradedCount      = m.Submissions.Count(s => s.Grading == GradingStatus.Graded),
      CorrectCount     = m.Submissions.Count(s => s.Correct == true),
  })
```

O título de cada linha do histórico é lido de `room_queue_sets` — a fila da sala — meses depois de a
partida ter acabado. Se a sala virar chave com TTL antes de a partida virar documento
autossuficiente, o histórico fica mostrando partidas sem nome.

> **O documento da partida é o que autoriza a sala a ser efêmera.** A leitura migra antes de a
> escrita parar; a escrita para antes de a sala sumir.

No desenho novo, a mesma consulta vira uma leitura só, de uma coleção só:
`matches.find({ leaderUserId }).sort({ finishedAt: -1 })` — `setTitles` sai de `phaseSets[]`, e
`participantCount`, `avgScore` e `accuracyRate` saem de `stats`, já calculados no commit.

### 8.2 Ordem de execução

| # | Passo | Por que nesta posição |
|---|---|---|
| 1 | Limitar tamanho de texto: `question`, `starterCode`, `testCases`, `source` | Pré-requisito do teto de 16 MB **e** do `maxmemory` do Redis. Tapa um buraco que já existe hoje, sem depender de nada. |
| 2 | Subir o Mongo: compose, driver, connection string, healthcheck, volume | Infra antes de uso. |
| 3 | Escrever o documento da partida ao encerrar, **mantendo o Postgres intacto** | Nada quebra; dá para comparar os dois lados e conferir o snapshot. |
| 4 | Migrar o histórico do líder para ler do Mongo | Leitura migra antes de a escrita parar. |
| 5 | Parar de escrever `matches`/`submissions` no Postgres; migration que dropa as duas tabelas | Só depois que ninguém mais lê. |
| 6 | Redis: `database` separado, `noeviction`, scripts Lua, o store de sala/fila | Só é seguro depois de (3). |
| 7 | Mover sala, participantes, fila e partida viva para o realtime; rotas internas novas na API; Server Actions do Next apontando para o realtime | O passo grande. |
| 8 | Migration que dropa `rooms`, `participants`, `room_queue_sets`, `room_queue_phases` | Último. Depois dele não há volta sem restore. |

Cada passo é reversível até o 5, e em nenhum momento o produto fica quebrado.

### 8.3 Uma mudança de comportamento, pequena e proposital

Havia **dois arredondamentos** para o mesmo número. `MatchStatsService.Average` usa
`MidpointRounding.AwayFromZero` — a mesma escolha de `PhaseGrading.Score`, que a documenta: "o
arredondamento bancário padrão do .NET deixaria 150,5 virar 150, e a tela mostra pontuação inteira,
então a diferença aparece". Já `UserProfileService` arredondava o `avgScore` do histórico com
`Math.Round` puro, que é bancário.

Os dois discordavam por 1 ponto exatamente nos casos terminados em `,5`: o placar ao vivo mostrava
um número e o histórico da mesma partida mostrava outro. O documento tem **uma** grafia para cada
número, e ela é `AwayFromZero`.

Vale para os **dois** campos do histórico: `avgScore` e `accuracyRate` — `UserProfileService`
arredondava os dois de forma bancária, e `MatchStatsService` já usava `AwayFromZero` nos dois
(`GetStatsAsync` calcula a taxa de acerto com `MidpointRounding.AwayFromZero` desde sempre). Efeito
prático: uma linha de histórico pode mudar em 1 ponto em relação ao que mostrava antes. É a
correção da divergência, não uma regressão — e `Document_accuracy_matches_the_leader_panel` é o
teste que impede ela de voltar.

### 8.4 Arquivos que a remoção do SQL toca

| Camada | Arquivos |
|---|---|
| Entidades | `Domain/Entities/`: `Room.cs`, `Participant.cs`, `RoomQueueSet.cs`, `RoomQueuePhase.cs`, `Match.cs`, `Submission.cs` |
| EF | `Data/Configurations/` (os seis correspondentes), `Data/AppDbContext.cs` (DbSets), duas migrations novas |
| Serviços | `RoomService.cs`, `RoomQueueService.cs`, `RoomAccessService.cs`, `ParticipantService.cs`, `MatchService.cs`, `MatchAccessService.cs`, `MatchStatsService.cs`, `SubmissionService.cs`, `MatchEventPublisher.cs`, `RealtimeSessionService.cs`, `UserProfileService.cs` |
| Endpoints | `RoomEndpoints.cs`, `RoomQueueEndpoints.cs`, `ParticipantEndpoints.cs`, `MatchEndpoints.cs`, `RealtimeEndpoints.cs` |
| Realtime | `src/`: módulos novos de store, comandos, cronômetro e estatísticas, ao lado de `hub.ts`/`broker.ts`/`channels.ts` |
| Next | `lib/api/rooms.ts`, `lib/api/match.ts`, `lib/actions/room.ts`, `lib/actions/match.ts` — trocam de destino, não de forma |
| Testes | `Codex.Api.Tests/`: `RoomCreationTests`, `RoomServiceTests`, `RoomQueueTests`, `RoomQueueMutationTests`, `ActiveRoomsTests`, `MatchLifecycleTests`, `MatchEndingTests`, `MatchStatsTests`, `SubmissionTests`, `ParticipantServiceTests` migram para o realtime |

### 8.5 Documentos que ficam falsos

Este repositório trata contrato como código. Os que deixam de descrever o sistema:

- `README.md` — regras #2 e #3 e a tabela de arquitetura.
- `realtime/README.md` — a premissa inteira ("transporta estado, não é dono de nenhum"; "não escreve
  no banco. Nem indiretamente").
- `realtime/package.json` — o campo `description` repete a mesma frase.
- `docs/contracts/realtime/websocket-contract.md` §1 — mesmo princípio. E o log de implementação já
  está desatualizado num ponto: diz que os eventos de partida "não têm quem os produza", e
  `MatchService`/`SubmissionService` já os produzem todos.
- `docs/contracts/api/api-rest-contract.md` — as seções 4, 6 e 7 mudam de serviço. A **seção 13**
  descreve a modelagem documento-orientada original (Firestore) que antecedeu a tradução relacional;
  vale relê-la, porque esta etapa é em boa parte um retorno a ela.
- `nextjs/src/realtime/protocol.ts` — o comentário de cabeçalho afirma a regra antiga.
- `docs/contracts/postgresql/sql.md` — passa a ser retrato histórico; ganha nota de data.
- `docs/contracts/postgresql/modelagem_codex.sql` — regerar depois das migrations.

---

## 9. Estado da implementação

| # | Passo | Estado |
|---|---|---|
| 1 | Limites de tamanho de texto | **Feito.** `PhaseLimits` ganhou os tetos; conferidos no editor (`PhaseSetService`), no `PATCH` da fila (`RoomQueueService`) e na resposta do aluno (`PhaseGrading.Validate`). 12 testes novos, incluindo o caso de fronteira (o valor exato do limite passa). |
| 2 | Infra do Mongo | **Feito.** `MongoDB.Driver`, serviço no compose com healthcheck e volume, seção `CodexApi:Documents`, `MONGO_*` no `.env.example`. Sem conexão configurada, cai num store em memória — como o realtime faz sem Redis. |
| 3 | Documento da partida no encerramento | **Feito.** `MatchDocumentWriter` monta o snapshot e `FinishCoreAsync` o grava, logo depois do `SaveChangesAsync`. Escrita dupla: o Postgres continua intacto. |
| 4 | Histórico do líder lendo do Mongo | **Feito.** `UserProfileService.GetMatchHistoryAsync` passou de uma query em cinco tabelas para uma leitura de uma coleção. A sala não é mais consultada ali. |
| 5 | Parar de escrever `matches`/`submissions` no Postgres e dropar as tabelas | **Não feito.** |
| 6 | Redis como store: `database` separado, `noeviction`, scripts Lua | **Não feito.** Especificado na §4. |
| 7 | Sala, fila e partida viva no realtime; rotas internas; Next apontando para lá | **Não feito.** Especificado nas §4 e §6. É o passo grande — reescreve em TypeScript o ciclo de vida que hoje vive em `RoomService`, `RoomQueueService`, `ParticipantService`, `MatchService` e `MatchStatsService`. |
| 8 | Migration que dropa `rooms`, `participants`, `room_queue_*` | **Não feito.** |

O corte entre 4 e 5 não é arbitrário: **até o 4, tudo é aditivo e reversível**, e o produto funciona
igual com ou sem Mongo. Do 5 em diante cada passo apaga um caminho de volta.

Enquanto a escrita for dupla, `MatchDocumentTests` compara os dois lados — agregados do documento
contra o que `MatchStatsService` calcula do Postgres, e a ordem dos participantes contra
`GetPodiumAsync`. É a verificação que desaparece no passo 5 (§7.1).

`MongoMatchDocumentStoreTests` cobre o que o store em memória não alcança: o driver de verdade,
os índices, o upsert idempotente e as três consultas. Roda só com `CODEX_TEST_MONGO` apontado para
um Mongo; sem a variável, os quatro testes ficam `Skipped` e o resto da suíte segue sem dependência
externa.

```bash
docker run -d --rm -p 27019:27017 mongo:8.0
CODEX_TEST_MONGO=mongodb://localhost:27019 dotnet test
```

O BSON que sai disso, conferido no banco:

```jsonc
{ "_id": UUID("01a0…c65"), "schemaVersion": 1, "roomCode": "969180",
  "mode": "live",                                   // o vocabulário do contrato, não o do C#
  "finishedAt": ISODate("2026-09-04T14:29:52Z"),    // UTC, ordenável — não um par [ticks, offset]
  "phases": [ { "kind": "quiz",
                "pointsMultiplier": Decimal128("1.5"),   // agregável, não string
                "content": { "question": "…", "options": […], "correctIndexes": [0] } } ] }
```

E a submissão gravada, que é a prova da §5.4 nos bytes e não só no desenho:

```jsonc
{ "phaseId": UUID("01a0…113"), "phaseOrderIndex": 0, "maxScore": 75,
  "answer": { "kind": "quiz", "optionId": "o1" },
  "grading": "graded", "correct": true, "score": 137 }
```

Nenhum enunciado, nenhuma alternativa, nenhum gabarito — só o ponteiro e os dois números.

---

## 10. Duas coisas a não confundir

**`user_identities` não existe neste branch.** O `sql.md` descreve o banco vivo, que já rodou
`20260908234747_UserIdentities`; o código de `refactor-sql` não tem a entidade, a configuração nem a
migration — elas estão em `oAuth`. Como `users` é justamente a tabela que fica, o merge vai encostar
aqui. Melhor saber antes.

**"Coleção" tem dois sentidos.** No pedido, "cada participante tem uma coleção de submissões" é o
modelo lógico, e ele está preservado: o participante é um documento e as submissões dele são um
array dentro dele. No vocabulário do Mongo, `matches` e `match_participants` é que são coleções. O
modelo lógico e o layout físico coincidem aqui — não é sempre assim.

---

## 11. Fora do escopo desta etapa

Registrado para não parecer esquecimento:

- **Catálogo publicado** (`published_phase_sets` / `published_phases`) e o ciclo publicar → remixar →
  republicar. É o passo 5 do `arquitetura-dados.md` e não depende deste.
- **Rascunhos do autor para o Mongo.** Passo 6: é o que menos ganha e o que mais mexe em CRUD que já
  funciona. `phase_sets` e `phases` continuam no Postgres.
- **Revogação de reuso.**
- **Geração de relatório.** Esta etapa cria a estrutura que a torna possível — a matriz
  participante × fase sai de `match_participants.find({ matchId })` numa consulta só — mas
  `GET /matches/{id}/report` e `POST /matches/{id}/report/export` continuam não existindo.
- **Correção de `text` e `code`.** Continuam voltando `pending` para sempre; `explanation`,
  `aiSuggestions` e `testsPassed` continuam sendo campos que nenhum código escreve.
- **Modo `self-paced`.** Continua respondendo `409 MODE_NOT_AVAILABLE`.
