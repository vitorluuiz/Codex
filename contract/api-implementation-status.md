# O que a API tem hoje (status de implementação)

Levantado lendo o código em `.NET/src/Codex.Api` (backend .NET 10 Minimal API +
PostgreSQL/EF Core) e cruzando com `contracts2/api-rest-contract.md`. Fontes
adicionais: `contract/api-init.md` (base do projeto) e `contract/api-lobby.md`
(seções 3–4), que são os registros de decisão de cada leva de trabalho.

**Resumo executivo:** das 14 seções do contrato REST, **só as seções 2, 3 e 4
(sessão/auth, entrar em sala, lobby) têm rota implementada** — e mesmo essas com
duas lacunas conhecidas (`POST /rooms` e OAuth). As seções 5–12 (conjuntos de
fases, fila, partida, respostas, comparação, painel do líder, relatórios,
landing) **existem só como modelo de dados** (entidades EF Core), sem nenhum
endpoint. **Nenhum evento de realtime é publicado** — o serviço de WebSocket
descrito em `contracts2/websocket-contract.md` não tem nem projeto iniciado.

---

## 1. Rotas implementadas

| # | Rota do contrato | Implementada? | Arquivo |
|---|---|---|---|
| 2 | `GET /session` | ✅ | `Endpoints/SessionEndpoints.cs` |
| 2 | `POST /auth/login` | ✅ | `Endpoints/AuthEndpoints.cs` |
| 2 | `POST /auth/signup` | ✅ | `Endpoints/AuthEndpoints.cs` |
| 2 | `POST /auth/oauth/{provider}/authorize` | ❌ | não iniciada |
| 2 | `POST /auth/logout` | ⚠️ parcial | responde `204`, mas não invalida o token no servidor (token é stateless — ver §3) |
| 2 | `PATCH /users/me` | ❌ | não iniciada |
| 2 | `GET /users/{userId}/profile` | ❌ | não iniciada |
| 3 | `GET /rooms/{code}/availability` | ✅ | `Endpoints/RoomEndpoints.cs` |
| 3 | `POST /rooms/{code}/participants` | ✅ | `Endpoints/ParticipantEndpoints.cs` |
| 4 | `POST /rooms` (criar sala) | ❌ | **bloqueador** — ver §2 |
| 4 | `GET /rooms/{code}` | ✅ | `Endpoints/RoomEndpoints.cs` |
| 4 | `GET /rooms/{code}/participants?status=` | ✅ | `Endpoints/ParticipantEndpoints.cs` |
| 4 | `PATCH /rooms/{code}` | ✅ | `Endpoints/RoomEndpoints.cs` |
| 4 | `POST /rooms/{code}/participants/{id}/approve` | ✅ | `Endpoints/ParticipantEndpoints.cs` |
| 4 | `POST /rooms/{code}/participants/{id}/reject` | ✅ | `Endpoints/ParticipantEndpoints.cs` |
| 4 | `DELETE /rooms/{code}/participants/{id}` | ✅ | `Endpoints/ParticipantEndpoints.cs` |
| 5 | `GET /phase-sets` | ❌ | só entidade `PhaseSet`/`Phase` no schema |
| 5 | `GET /phase-sets/{setId}/draft` | ❌ | idem |
| 5 | `POST /phase-sets` | ❌ | idem |
| 5 | `PUT /phase-sets/{setId}/draft` | ❌ | idem |
| 5 | `PATCH /phase-sets/{setId}` | ❌ | idem |
| 5 | `DELETE /phase-sets/{setId}` | ❌ | idem |
| 5 | `POST /phase-sets/phases/generate` | ❌ | idem (exige integração de IA — nenhuma decisão tomada) |
| 6 | `GET /rooms/{code}/queue` + todas as mutações de fila | ❌ | entidades `RoomQueueSet`/`RoomQueuePhase` existem no schema, zero endpoint |
| 7 | `POST /rooms/{code}/match`, `GET /rooms/{code}/match`, `GET /matches/{id}/current-phase` | ❌ | entidade `Match` existe, zero endpoint |
| 8 | `POST …/submissions`, `POST …/run`, `POST …/ready` | ❌ | entidade `Submission` existe, zero endpoint; `run` precisa de sandbox de execução (não decidido) |
| 9 | `GET …/comparison`, `GET …/scoreboard/me`, `GET …/podium` | ❌ | não iniciada |
| 10 | `GET …/stats`, `advance`, `pause`, `restart`, `finish`, `return-to-lobby`, `DELETE …/participants/{id}` (partida) | ❌ | não iniciada |
| 11 | Relatórios (`report`, `report/export`, `GET /jobs/{jobId}`) | ❌ | não iniciada; contrato já registra que não há tela pronta |
| 12 | `GET /marketing/landing` | ❌ | opcional — hoje o conteúdo é local em `src/content/landing.ts` no front |

**Contagem:** 10 de ~45 rotas do contrato têm endpoint no backend. Todas as 10
pertencem às seções 2–4.

---

## 2. Lacunas que bloqueiam o resto

### `POST /rooms` não existe em lugar nenhum — nem no contrato

`contract/api-lobby.md` §10 registra isto explicitamente: as seções 1–14 do
contrato descrevem a sala sendo consultada, editada, preenchida de fases e
jogada, mas **nenhuma seção original definia como criar uma**. Isso foi
corrigido na versão atualizada do contrato (`contracts2/api-rest-contract.md`
§4, `POST /rooms`) — mas o backend .NET ainda não implementou essa rota, porque
foi escrita depois da última leva de trabalho no `.NET`.

**Efeito em cascata:** sem `POST /rooms`, não há como criar uma sala pela API —
os testes de ponta a ponta documentados em `api-lobby.md` §11 precisaram semear
a sala direto no Postgres via SQL. E como o front já tem a tela de perfil
pronta (`nextjs/src/app/perfil/`, `nextjs/src/lib/actions/profile.ts`) chamando
exatamente essa rota para os botões "Criar sala" e "Iniciar", **isso é hoje o
único bloqueador entre o front atual e uma demonstração ponta a ponta real**
(sala criada pela UI, não por SQL manual).

### Front já construído esperando por seção 5 (editor de conjuntos) sem backend

O working tree do Next tem, sem commit ainda: `src/app/conjunto/` (rotas do
editor), `src/components/set-editor/` (rail de fases, formulários por tipo),
`src/lib/api/phaseSets.ts` e `src/lib/actions/phaseSets.ts` — todos batendo
exatamente nas rotas de `contracts2/api-rest-contract.md` §5
(`GET /phase-sets/{id}/draft`, `POST /phase-sets`, `PUT .../draft`,
`POST .../phases/generate`). Nenhuma delas tem endpoint no `.NET`. A tela
existe e não tem com o que falar.

### Front já construído esperando por perfil (`PATCH /users/me`, `GET /users/{id}/profile`)

Mesma situação: `src/app/perfil/`, `src/components/profile/`,
`src/lib/api/profile.ts` chamam rotas que não existem no backend ainda.

---

## 3. Infraestrutura transversal — o que já está sólido

Isto **não** é rota por rota do contrato, mas é o que faz as próximas seções
saírem rápido quando alguém as escrever:

- **Formato de erro `{code, message}`** — `ApiException` + `ApiExceptionHandler`
  já tratam qualquer falha de regra de negócio no formato do contrato.
  `ErrorCodes` já tem constantes para os códigos das seções não implementadas
  ainda (`TOO_MANY_SETS`, `QUEUE_MISMATCH`, `PHASE_CLOSED` etc.), prontas para
  uso.
- **Autenticação de sessão dual** (`userId` **ou** `participantId`+`roomCode`,
  ou os dois juntos desde `api-lobby.md`) via token opaco protegido por Data
  Protection, persistido no Postgres — funciona hoje para as rotas que
  precisam.
- **`x-service-token`** — middleware fail-closed, já protege 100% das rotas
  (exceto `/health`).
- **Autorização baseada em recurso** (`RoomAccessService`: "existe?", "é
  líder?", "é membro?") — o padrão que qualquer rota nova de sala/partida vai
  reusar.
- **Contrato JSON**: camelCase global, `MatchMode` em kebab-case (o único enum
  do contrato que precisa disso), datas terminando em `Z` — os três desvios do
  padrão do ASP.NET Core que o contrato exige já estão cobertos.
- **Rate limiting** — implementado, mas só para o código da sala
  (`availability` + `POST` de participante), com a limitação conhecida de
  particionar por código e não por IP do browser final (ver
  `contract/api-lobby.md` §7). Nenhum rate limit configurado ainda para
  `POST …/run` (execução de código) ou para o WS.
- **Testes automatizados**: 48 testes (`dotnet test`, xUnit + EF Core InMemory),
  cobrindo `AuthService`, `RoomService`, `ParticipantService`, sem precisar de
  Postgres. O índice único parcial de `USERNAME_TAKEN` foi verificado
  manualmente contra Postgres real (InMemory não suporta índices).

## 4. Modelo de dados — mais completo do que os endpoints

O schema EF Core (`Data/Migrations`, duas migrations aplicadas:
`Initial` e `ParticipantUniqueDisplayName`) já modela **todas** as entidades da
seção 13 do contrato — `User`, `Room`, `Participant`, `PhaseSet`, `Phase`,
`RoomQueueSet`, `RoomQueuePhase`, `Match`, `Submission` — traduzidas de
Firestore para PostgreSQL/relacional (decisão registrada em
`contract/api-init.md` §2). Ou seja: **o banco já suporta as seções 5–10**, só
faltam os `Endpoints`/`Services`/`Contracts` (DTOs) que leem e escrevem nelas.
Isso muda o tamanho do próximo passo: não é "desenhar schema", é "escrever
handler HTTP em cima de tabela que já existe".

Pontos que os próximos endpoints (seção 5–6) vão precisar e que já estão
resolvidos no schema:

- `RoomQueueSet.SourcePhaseSetId` / `RoomQueuePhase.SourcePhaseId` são `Guid`
  soltos, sem FK — a fila copia a fase, não referencia (decisão 1 da seção 13).
- Índice único parcial de `Submission (RoomQueuePhaseId, ParticipantId)` já
  garante "1 envio por pessoa por fase" no banco, não em código.
- Campos por `Kind` (quiz/fill/text/code) são `jsonb` (`ContentJson`/
  `AnswerJson`), não colunas esparsas — a camada de serviço que serializa por
  tipo ainda não foi escrita.

## 5. O que o modelo de dados **não** cobre

- Nenhuma entidade para relatórios (seção 11) ou CMS da landing (seção 12) —
  tratados como especulativos no próprio contrato.
- `Room.ExpiresAt` existe na tabela, mas nada preenche esse campo — TTL de sala
  não funciona ainda (afeta reciclagem de código de 6 dígitos e limpeza do
  banco).
- Nenhuma tabela de sessões revogáveis — `POST /auth/logout` não invalida o
  token de fato (token stateless, expira só pelo `expiresIn`).

## 6. Realtime — arquiteturalmente ausente

- Não existe, neste repositório, nenhum projeto do serviço de WebSocket. É
  tratado desde `contract/api-init.md` como "um projeto Node.js separado" cuja
  forma de saber que algo mudou (ler o Postgres direto, uma fila, um webhook)
  **ainda não foi decidida**.
- As três rotas de líder já implementadas (`PATCH /rooms/{code}`, approve,
  reject, delete de participante) têm `// TODO(realtime)` no código exatamente
  onde a publicação de evento deveria entrar — mas nada é publicado hoje. Um
  segundo browser no lobby só vê a mudança se recarregar a página.
