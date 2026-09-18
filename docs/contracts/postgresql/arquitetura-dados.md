# Para onde os dados vão

Resposta ao documento de migração. O par deste arquivo é o [`sql.md`](./sql.md), que mostra como os
dados estão guardados **hoje**; aqui é **para onde vão** e o que cada escolha cobra.

Decisões já tomadas, que servem de premissa para tudo abaixo:

| Decisão | Escolha |
|---|---|
| Motor da migração | Aprender / portfólio — persistência poliglota é o objetivo |
| Publicar e editar depois | **Versão imutável**, com histórico |
| Salas | Vão para cache |
| Partidas | Vão para o Mongo |
| Revogação de reuso | Adiada |

Como o motor é aprendizado, este documento **não** tenta argumentar "fica tudo no Postgres porque o
volume é pequeno". Ele faz outra coisa: escolhe o recorte que ensina mais com menos risco, e aponta
em cada ponto onde a conta chega.

---

## 1. Suas três perguntas

### 1.1 "ContentJson — qual é o tamanho máximo que esse campo pode armazenar?"

Três limites, do mais distante para o que realmente morde.

| Limite | Valor | Origem |
|---|---|---:|
| String dentro de um `jsonb` | **268.435.455 bytes** (~256 MB) | o servidor de vocês |
| Qualquer campo no Postgres | 1 GB | limite de `varlena` |
| **Validação da aplicação** | **nenhuma** | `PhaseSetService.Validate` |
| Uso real hoje | **127 a 247 bytes** | `pg_column_size` nas 9 fases |

O limite de 256 MB não veio de documentação — a página oficial de tipos JSON do PostgreSQL **não
menciona limite nenhum**. Veio de perguntar ao Postgres 18.4 de vocês:

```
=> select length(to_jsonb(repeat('x', 268435460))::text);

ERRO:  cadeia de caracteres muito longa para representar uma cadeia de caracteres jsonb
DETAIL:  Devido a uma restrição de implementação, cadeias de caracteres jsonb
         não podem exceder 268435455 bytes.
```

(268.435.455 = 2²⁸ − 1. Um `repeat('x', 100000000)` — 100 MB — passa sem reclamar.)

Ou seja: entre o que vocês usam (247 bytes) e o teto do Postgres há **seis ordens de grandeza**.
Do lado do armazenamento, tamanho não é uma restrição. Valores acima de ~2 KB saem da linha para o
TOAST, comprimidos com `pglz`, de forma transparente.

**Mas o limite que importa é o que não existe.** `PhaseSetService.Validate` (`:364-494`) confere
tamanho de nome, pontuação, tempo e multiplicador — e **não confere tamanho de `question`,
`starterCode` nem `testCases`**. Para `Code`, a validação inteira é presença:

```csharp
if (phase.StarterCode is null || phase.TestCases is null) throw Validation(...);
```

E `PhaseConfiguration.cs:17` declara a coluna `jsonb` **sem `HasMaxLength`**. Hoje o teto real de
uma fase é o limite de corpo do HTTP. Multiplicado pelos limites que existem:

```
MaxPhasesPerSet   =  50   (PhaseSetService.cs:41)
MaxSetsPerRoom    =   8   (RoomQueueService.cs:54)
MaxCapacity       = 500   (RoomService.cs:31)
```

→ uma sala aceita **400 fases** na fila, cada uma com texto ilimitado, copiada literalmente de
`phases` para `room_queue_phases`. Isso já é um buraco hoje, e vira **bloqueio** na migração: o
Mongo tem teto **rígido** de 16 MB por documento. Ver §4.3.

### 1.2 "Dentro do Postgres, o que o jsonb é capaz?"

Tudo abaixo foi **executado no Postgres 18.4 de vocês, contra a tabela `phases` real**. A coluna
"Resultado" é a saída de verdade.

| Recurso | Consulta | Resultado |
|---|---|---|
| Containment | `"ContentJson" @> '{"fromAI": false}'` | 9 |
| Existência de chave | `"ContentJson" ? 'expectedAnswer'` | 1 |
| JSONPath | `"ContentJson" @? '$.options[*]'` | 6 |
| Subscript (PG14) | `"ContentJson"['question']` | `"Quanto é 1 + 2?"` |
| Tamanho de array | `jsonb_array_length("ContentJson"->'options')` | 4, 2 |
| Extração por caminho | `jsonb_path_query_array(…, '$.options[*]')` | `["3","2","1","4"]` |
| Predicado `IS JSON` (PG16) | `"ContentJson"::text is json object` | `t` |
| `JSON_VALUE` (PG17) | `json_value(…, '$.question' returning text)` | `Quanto é 1 + 2?` |
| `JSON_TABLE` (PG17) | opções viram linhas | 4 linhas |
| Documento → colunas | `jsonb_to_record(…) as r(question text, "fromAI" boolean)` | tipado |
| Agregação | `avg(jsonb_array_length("ContentJson"->'options'))` | 3.67 |

Além desses, e igualmente disponíveis: índice **GIN** (`jsonb_ops` para qualquer chave,
`jsonb_path_ops` menor e mais rápido para containment), índice **B-tree por expressão** sobre
`->>'campo'`, **coluna gerada** a partir do jsonb com índice único ou parcial em cima — padrão que
vocês **já usam** em `participants.DisplayNameNormalized` — e **`CHECK`** de formato.

Resumindo sem rodeio: o Postgres faz o trabalho de banco documental, e faz bem.

**Dois avisos que tornam esse poder teórico no projeto de hoje:**

1. O EF mapeia essas colunas como `string` opaca — `HasColumnType("jsonb")`, sem value converter,
   sem `ToJson()`. **Nada disso é alcançável por LINQ.** Para usar, seria preciso mudar o
   mapeamento (`EnableDynamicJson` / owned JSON) ou escrever SQL cru.
2. O operador `?` colide com placeholder de parâmetro em vários drivers. No Npgsql, use
   `jsonb_exists(coluna, 'chave')`.

**O que isso significa para a decisão.** A escolha pelo Mongo aqui não corrige uma limitação do
Postgres — não há limitação. É uma escolha de aprendizado, e ela é legítima. Só vale registrar por
escrito para que ninguém, daqui a seis meses, leia o repositório e conclua que o `jsonb` não dava
conta.

### 1.3 "O que acontece se o usuário publicar mas alterar o conjunto depois?"

**Versão imutável.** O argumento mais forte vem do esquema que você mesmo propôs.

Você quer guardar em `phase_sets` publicados: `Approvals`, `Rejections`, `SubmissionsCount`,
`CorrectSubmissionsCount`. Esses quatro campos **só significam alguma coisa contra um conteúdo
fixo**. Se o autor edita a pergunta depois de 300 pessoas responderem, "78% de acerto" passa a
medir uma pergunta que não existe mais. Não é uma estatística imprecisa — é uma estatística sobre
outra coisa.

E vocês **já resolveram esse mesmo problema uma vez**. `RoomQueueService.cs:174` copia o
`ContentJson` literalmente ao montar a fila da sala, com o comentário dizendo que a cópia é literal,
gabarito incluído — para que a sala fique imune a edições posteriores no conjunto de origem.
Publicar é o mesmo problema, com mais gente e por mais tempo.

Concretamente:

- O **rascunho** do autor é mutável e vive no Mongo. Continua evoluindo para sempre.
- **Publicar** tira um snapshot e grava como `Version = N` no Postgres. Aquela linha nunca mais muda
  de conteúdo.
- **Republicar** cria `Version = N+1`. As duas coexistem.
- Quem consome — uma sala, um remix, um voto — aponta para **uma versão específica**.

Consequência a registrar: numa linha imutável, `UpdatedAt` não pode significar "conteúdo mudou".
Só pode significar "contador mudou". Vale renomear para não enganar depois.

---

## 2. A descoberta que amarra as duas decisões

Suas duas escolhas — **sala no cache** e **partida no Mongo** — parecem independentes. Não são: uma
habilita a outra, e sem essa ordem a primeira quebra o produto.

O histórico do líder (`Services/UserProfileService.cs:169-202`) é **uma query em cima de cinco
tabelas**:

```csharp
db.Matches
  .Where(m => m.Room.LeaderUserId == userId && m.FinishedAt != null)
  .Select(m => new {
      m.Id, m.Mode, m.StartedAt, m.FinishedAt,
      SetTitles        = m.Room.QueueSets.OrderBy(s => s.OrderIndex).Select(s => s.Title).ToList(),
      ParticipantCount = m.Room.Participants.Count(p => p.Status == ParticipantStatus.Approved),
      ScoreSum         = m.Submissions.Sum(s => s.Score),
      GradedCount      = m.Submissions.Count(s => s.Grading == GradingStatus.Graded),
      CorrectCount     = m.Submissions.Count(s => s.Correct == true),
  })
```

Repare no `SetTitles`: **o título de cada linha do histórico é lido de `room_queue_sets`** — a fila
da sala — meses depois de a partida ter acabado. O mesmo vale para `ParticipantCount`, que vem de
`participants`.

Se a sala virar cache com TTL, o histórico perde o título quando a chave expira. A lista fica
mostrando partidas sem nome.

A saída é exatamente o que você propôs: **ao terminar, a partida vira um documento autossuficiente
no Mongo** — título, fases, participantes, pontuações, tudo embutido. A partir daí ninguém mais
consulta a sala nem a fila, e as duas podem ser descartáveis de verdade.

> **O documento da partida é o que autoriza a sala a ser efêmera.** Por isso a ordem em §5 não é
> negociável: partida no Mongo **antes** de sala no cache.

---

## 3. O desenho alvo

| Store | Guarda | Por quê |
|---|---|---|
| **Postgres** | `users`, `user_identities` | Identidade. E-mail único, FK, `DataProtectionKeys`. Não muda. |
| **Postgres** | `published_phase_sets`, `published_phases` | Catálogo da comunidade: imutável, versionado, buscado, ranqueado, contado. Trabalho relacional clássico. |
| **Mongo** | Rascunhos do autor | Documento de verdade: 4 shapes por `Kind`, lido e escrito inteiro, nunca consultado por campo. |
| **Mongo** | Partidas finalizadas | Snapshot autossuficiente, append-only, uma leitura por documento. |
| **Redis** | Sala, fila, estado vivo da partida | Efêmero, escrita frequente, morre no fim da partida. |

### 3.1 Postgres — o catálogo publicado

```sql
published_phase_sets
  Id                       uuid        PK
  SourceSetId              uuid        -- _id do rascunho no Mongo; sem FK, é linhagem
  Version                  int         -- 1, 2, 3…
  OwnerId                  uuid        FK -> users
  Title                    varchar(160)
  Permission               varchar(16) -- Closed | Remixable
  Status                   varchar(16) -- Published | Delisted
  PublishedAt              timestamptz
  CountersUpdatedAt        timestamptz -- NÃO "UpdatedAt": conteúdo não muda
  Approvals                int
  Rejections               int
  SubmissionsCount         bigint
  CorrectSubmissionsCount  bigint
  UNIQUE (SourceSetId, Version)

published_phases
  Id                       uuid        PK
  PublishedSetId           uuid        FK -> published_phase_sets  ON DELETE CASCADE
  OriginPublishedPhaseId   uuid        -- se esta fase é remix de outra publicada; sem FK
  Kind, Name, BasePoints, PointsMultiplier, TimeSeconds, OrderIndex
  ContentJson              jsonb
  SubmissionsCount         bigint
  CorrectSubmissionsCount  bigint
```

Três observações sobre a sua lista original:

1. **Faltou `PointsMultiplier`.** Ele existe hoje (`numeric(5,2)`, entre 0.1 e 10) e entra no
   cálculo de pontos. Tirar é uma decisão de produto válida, mas precisa ser deliberada.
2. **Os contadores precisam existir também por fase**, não só por conjunto. Seu próprio ciclo prevê
   que alguém pegue *uma fase* da comunidade — quem faz isso quer a taxa de acerto daquela fase, não
   a média do conjunto de onde ela veio.
3. **`Permission` como você descreveu ("pode ser incorporado a outros phase_sets") pertence à fase,
   não só ao conjunto.** Quem remixa remixa fases.

Sobre os contadores: eles são **cross-store**. As submissões estarão no Mongo e os contadores no
Postgres, então a atualização é assíncrona e eventualmente consistente. Isso na verdade ajuda —
atualize **uma vez por partida**, não uma por submissão: `UPDATE … SET SubmissionsCount =
SubmissionsCount + @n`. Um `UPDATE` por partida em vez de 200 mil evita contenção de lock de linha
num conjunto popular.

### 3.2 Mongo — rascunho do autor

```json
{
  "_id": "01a069f5-8351-7c3f-aa88-50364832e5c1",
  "ownerId": "01a069ee-9029-76e7-b874-9508fa1a2f13",
  "title": "Conjunto de exemplo",
  "createdAt": "2026-09-03T22:08:12Z",
  "updatedAt": "2026-09-03T22:08:12Z",
  "publishedVersion": null,
  "phases": [
    {
      "id": "01a069f5-835e-73d4-9f5d-b86c84c20733",
      "kind": "quiz",
      "name": "Pergunta fácil de soma",
      "basePoints": 50, "pointsMultiplier": 1.0, "timeSeconds": 15, "orderIndex": 0,
      "content": {
        "question": "Quanto é 1 + 2?", "fromAI": false,
        "options": ["3", "2", "1", "4"], "correctIndexes": [0]
      },
      "origin": null
    }
  ]
}
```

Fases **embutidas** é o encaixe certo: no máximo 50 por conjunto, e o CRUD já lê e escreve o
conjunto inteiro (`ReplaceDraftAsync`).

Um detalhe a preservar: `ReplaceDraftAsync` hoje faz *diff por id* em vez de apagar-e-recriar,
justamente para que `RoomQueuePhase.SourcePhaseId` continue apontando para algo. **Os ids das fases
embutidas precisam continuar estáveis entre edições** pelo mesmo motivo — agora também porque
`published_phases.OriginPublishedPhaseId` depende disso.

### 3.3 Mongo — a partida finalizada

```json
{
  "_id": "01a06cc4-cf85-7f92-b5c1-f099545b0268",
  "roomCode": "969180",
  "leaderUserId": "01a069ee-9029-76e7-b874-9508fa1a2f13",
  "mode": "live",
  "startedAt": "2026-09-04T14:13:52Z",
  "finishedAt": "2026-09-04T14:14:08Z",
  "setTitles": ["Conjunto de exemplo"],
  "phases": [
    { "orderIndex": 0, "kind": "quiz", "name": "Pergunta fácil de soma",
      "basePoints": 50, "pointsMultiplier": 1.0, "timeSeconds": 15,
      "maxScore": 75, "content": { "...": "gabarito incluído" } }
  ],
  "participants": [
    { "participantId": "01a06cc4-a5bc-…", "userId": "01a069f6-56b0-…",
      "displayName": "Maria", "avatarIndex": 1,
      "totalScore": 137, "gradedCount": 2, "correctCount": 2 }
  ],
  "stats": {
    "participantCount": 1, "avgScore": 137, "maxScore": 325,
    "accuracyRate": 100, "phaseAccuracy": [100, null, null, 100]
  }
}
```

Índices necessários: `participants.userId` (multikey — é o histórico do jogador), `leaderUserId`,
e `finishedAt` decrescente.

**As submissões não cabem aqui dentro.** Ver §4.3 — é o achado mais duro deste documento.

### 3.4 Redis — a sala viva

A boa notícia: as duas garantias que hoje são do Postgres **têm equivalente atômico no Redis**, o
que torna essa migração bem mais tratável do que parece.

| Garantia hoje | Como é feita | Equivalente no Redis |
|---|---|---|
| Apelido único por sala | índice único **parcial** `(RoomId, DisplayNameNormalized) WHERE Status <> 'Rejected'` | `SADD room:{code}:names <lower(nome)>` → retorna 0 se já existe — **mas ver ressalva abaixo** |
| 1 envio por pessoa/fase/partida | índice único `(MatchId, RoomQueuePhaseId, ParticipantId)` | `HSETNX match:{id}:subs {phase}:{participant} …` |
| Código de sala livre | `GenerateCodeAsync` com retry | `SET code:{code} {roomId} NX EX {ttl}` |

As duas últimas são equivalências limpas: uma operação atômica cada, sem seção crítica em código de
aplicação.

**A primeira não é.** O índice é *parcial* — o `WHERE "Status" <> 'Rejected'` significa que recusar
alguém **devolve o apelido para a sala**. Um `SADD` sozinho nunca devolve: seria preciso parear com
um `SREM` no momento da recusa, e aí já são duas operações que precisam acontecer juntas. Dá para
fazer (script Lua, ou aceitar a janela), mas é a única das três que exige cuidado de verdade — vale
não subestimar isso no planejamento.

---

## 4. As quatro consequências que precisam de decisão

### 4.1 O commit deixa de ser transacional

**Não existe `BeginTransaction` em lugar nenhum da API.** Toda atomicidade hoje é um
`SaveChangesAsync` só. E três métodos escrevem `rooms` **e** `matches` no mesmo save:

| Método | Escreve junto |
|---|---|
| `MatchService.StartAsync:102-112` | `matches` + `rooms` (Status, MatchMode, ExpiresAt) |
| `MatchService.FinishCoreAsync:316-341` | `matches` + `rooms.ExpiresAt` + `participants.InResultsSince` |
| `MatchService.ReturnToLobbyAsync:399-407` | `matches` + `rooms` (Status, MatchMode, ExpiresAt) |

Com sala no Redis e partida no Mongo, esses três viram operações em **dois stores sem transação
distribuída**.

Proposta: **a escrita do documento no Mongo é o ponto de commit.** Se ela falhar, a partida não
acabou e pode ser retentada a partir do estado no Redis. A limpeza do Redis vem depois e é
best-effort — no pior caso sobra uma chave que o TTL recolhe.

Isso exige que montar o documento seja **idempotente**: montar duas vezes tem que dar o mesmo
resultado. O precedente já existe no código — `CurrentPhaseEndedAt` é exatamente um fechamento
preguiçoso e idempotente, e `FinishCoreAsync` já começa com `var alreadyFinished = match.Status is
MatchStatus.Finished;`.

### 4.2 `allkeys-lru` apaga estado de sala viva

`redis/redis.conf`, hoje:

```
maxmemory 256mb
maxmemory-policy allkeys-lru
```

Isso é correto para o uso atual — pub/sub e tickets de 30 s. Mas **enquanto a partida corre, a sala
não é cache: é a fonte da verdade**. Sob pressão de memória, `allkeys-lru` descarta a sala de
alguém no meio da partida, em silêncio, sem erro em lugar nenhum.

Requisito, então: instância (ou ao menos `database`) **separada**, com `maxmemory-policy
noeviction`, TTL explícito por chave, e `appendonly yes` mantido. A sala só ganha TTL curto **depois**
que o documento da partida foi gravado no Mongo.

### 4.3 As submissões não cabem no documento da partida

O Mongo tem teto **rígido** de 16 MB por documento. Com os limites que a aplicação já aceita:

```
MaxSetsPerRoom  ×  MaxPhasesPerSet  =    8 × 50  =    400 fases numa fila
                        MaxCapacity =              500 participantes
                                                ─────────────────────
                            pior caso  =  400 × 500  =  200.000 submissões
```

16 MB ÷ 200.000 = **84 bytes por submissão**. Uma resposta de `quiz` (`{"kind":"quiz","optionId":"o1"}`)
tem 31 bytes — só o payload já ocuparia a cota, sem contar `participantId`, `phaseOrderIndex`,
`submittedAt`, `score` e o resto da linha. Uma resposta de `code` carrega o `source`
inteiro — que, como visto em §1.1, **não tem limite nenhum**.

O caso típico cabe folgado (30 pessoas × 20 fases × ~200 B ≈ 120 KB). O pior caso permitido pela
própria aplicação estoura por mais de uma ordem de grandeza.

Duas saídas, e elas se combinam:

1. **Coleção separada** `match_submissions`, com `matchId` indexado. No documento da partida ficam só
   os agregados por participante e por fase — que é exatamente o que o histórico precisa ler.
2. **Limitar o tamanho do texto** de `question`, `starterCode`, `testCases` e `source`. Isso precisa
   acontecer de qualquer forma, e é o passo 1 da §5.

**O ciclo de vida de uma submissão, então, é:** escrita no Redis durante a partida (é lá que mora o
`HSETNX` que garante um envio por pessoa/fase — §3.4), e transferida para `match_submissions` no
commit do fim da partida (§4.1), junto com o documento agregado. São **duas escritas no Mongo**, não
uma — o que torna o requisito de idempotência da §4.1 mais exigente, não menos: refazer o commit
precisa dar o mesmo resultado nas duas coleções.

**E o problema de tamanho não começa no Mongo — começa no Redis.** O `maxmemory 256mb` da §4.2 é
*menor* que o teto de documento do Mongo. Com `source` ilimitado, o pior caso não cabe na memória do
Redis, e estourar ali é **estritamente pior** do que um insert recusado no Mongo: no meio da partida
ainda não existe snapshot nenhum para o qual retentar. É por isso que limitar texto é o passo 1 da
§5 e não uma tarefa de arrumação para depois.

**Bônus barato.** Montar esse documento é a hora de tornar reais dois números que hoje são falsos:
`LeaderProfileResponse` não tem `maxScore` nem `phaseAccuracy`, e a interface finge —
`MatchHistorySection.tsx:154` cai em `: 100` quando `maxScore` vem indefinido, e o sparkline está
chumbado:

```tsx
<PhaseSparkline values={[98, 78, 56, 10, 95]} />
```

### 4.4 Não existe link participante → partida — e o join disponível está errado

Você quer associar a partida a todos os usuários com conta. Hoje isso não é possível, e a forma
óbvia de fazer **dá resposta errada**.

`submissions.MatchId` é a única referência a `matches` fora de `matches.RoomId`. Não existe
`match_participants`. O caminho disponível é `participants → rooms → matches`, que afirma:

> todo participante de uma sala jogou todas as partidas daquela sala

O que é falso para quem entrou no meio. A sala `618531` tem **4 partidas**; quem chegou para a
última contaria as quatro.

No desenho novo isso se resolve de graça: o array `participants` do documento da partida carrega o
`userId`, e um índice multikey sobre ele **é** o histórico do jogador. Nenhuma tabela intermediária
precisa existir.

Dois limites a registrar:

- **Convidado não tem histórico.** `Participant.UserId` é `Guid?` e é nulo para quem entra sem
  conta. Consistente com o que você escreveu ("participantes com conta"), mas vale estar explícito.
- **O snapshot precisa ser tirado no fim.** `MatchService.RemovePlayerAsync:431-432` hoje **apaga** a
  linha do participante e todas as submissões dele. Quem for expulso antes do fim simplesmente não
  estará no documento.

---

## 5. Ordem de execução

Cada passo é reversível, e em nenhum momento o produto fica quebrado.

| # | Passo | Por que nesta posição |
|---|---|---|
| 1 | **Limitar tamanho de texto** (`question`, `starterCode`, `testCases`, `source`) | Pré-requisito do teto de 16 MB do Mongo **e do `maxmemory` do Redis** (§4.3), e tapa um buraco que já existe hoje |
| 2 | **Escrever o documento da partida no Mongo** ao finalizar, mantendo o Postgres intacto | Nada quebra; dá para comparar os dois lados e conferir o snapshot |
| 3 | **Migrar o histórico** para ler do Mongo; só então parar de escrever `matches`/`submissions` no Postgres | Leitura migra antes da escrita parar |
| 4 | **Sala e fila para o Redis** | Só é seguro depois de (2) — §2 |
| 5 | **Publicação** — catálogo, versões, contadores | Campo aberto, sem migração de dado (§6). Pode entrar em paralelo a qualquer momento. Um pré-requisito: se o catálogo for buscável **por conteúdo** (não só por título), precisa antes da mudança de mapeamento do EF da §1.2 — hoje `ContentJson` é `string` opaca para o LINQ |
| 6 | **Rascunhos para o Mongo** | Por último: é o que menos ganha e o que mais mexe em CRUD que já funciona |

---

## 6. "Publicar" ainda não existe — isso é uma boa notícia

Não há migração de dado a fazer no passo 5. `phase_sets.Visibility` é **lido** em quatro lugares:

```
Services/PhaseSetService.cs:80        filtro da aba "Comunidade"
Services/UserProfileService.cs:140    filtro do perfil alheio
Services/RoomService.cs:78            predicado de autorização
Services/RoomQueueService.cs:207      predicado de autorização
```

E é **escrito** em exatamente um, fixo:

```csharp
// PhaseSetService.cs:144
Visibility = PhaseSetVisibility.Private,
```

Não existe rota de publicar, de copiar, de votar. A aba "Comunidade" responde `[]` em qualquer
instalação; no front, `mockLibrary.ts` preenche a tela com dados falsos. O lado de leitura está
pronto e testado — falta só quem escreva.

Ou seja: o catálogo publicado pode ser desenhado do zero, no formato certo, sem compatibilidade
retroativa com nada.

---

## 7. O ciclo publicar → remixar → republicar

```
  ┌─ Mongo ────────────────┐         ┌─ Postgres ──────────────────────┐
  │ rascunho do autor A    │         │ published_phase_sets            │
  │  phases[] embutidas    │────────▶│  (SourceSetId, Version = 1)     │
  └────────────────────────┘ publica │ published_phases                │
                                     │  ContentJson idêntico ao        │
  ┌─ Mongo ────────────────┐         │  rascunho — cópia, não tradução │
  │ rascunho do autor B    │◀────────│                                 │
  │  phases[].origin =     │  remixa └─────────────────────────────────┘
  │   { publishedPhaseId,  │              ▲
  │     version }          │──────────────┘
  └────────────────────────┘   publica  → (SourceSetId de B, Version = 1)
```

A travessia entre stores é **cópia, não tradução**: o formato do conteúdo é o mesmo dos dois lados
(o record `PhaseContent` em `Services/PhaseContent.cs`). Isso é o que faz o ciclo se fechar sem
camada de conversão.

Linhagem segue o precedente que já existe no schema — `SourcePhaseId` como id solto, sem FK,
justamente para que apagar a origem não apague o derivado.

---

## 8. Fica para depois

Registrado para não parecer esquecimento:

- **Revogação de reuso.** Você adiou. Quando voltar, a pergunta é o que "proibir" significa: sumir da
  busca, bloquear novas cópias, ou invalidar cópias existentes. Com snapshot imutável, as duas
  primeiras são baratas; a terceira é um problema de delete distribuído e pode quebrar partidas já
  realizadas.
- **`DELETE /rooms/{code}` não existe.** O botão "Encerrar sala" do histórico chama essa rota e
  recebe 404. Nada no código jamais escreve `RoomStatus.Finished`.
- **`POST /matches/{id}/report/export` não existe.** O botão de baixar relatório também é ornamental.
- **Perfil de participante** é `MOCK_PARTICIPANT_PROFILE` — dados locais, sem rota. É o consumidor
  natural do índice `participants.userId` da §4.4.
- **Salas abandonadas não têm job de limpeza.** No desenho novo isso resolve sozinho: TTL do Redis.
