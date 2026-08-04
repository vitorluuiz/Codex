# O que a API tem hoje (status de implementação)

Levantado lendo o código em `.NET/src/Codex.Api` (backend .NET 10 Minimal API +
PostgreSQL/EF Core) e cruzando com `contract/api-rest-contract.md`. Fontes
adicionais: `contract/api-init-log.md` (base do projeto) e `contract/api-lobby-log.md`
(seções 3–4), que são os registros de decisão de cada leva de trabalho.

**Resumo executivo:** das 14 seções do contrato REST, **as seções 2, 3 e 4
(sessão/auth + perfil, entrar em sala, lobby) estão completas exceto por OAuth**.
A criação de sala (`POST /rooms`), que era o bloqueador nº 1 da lista de próximos
passos, existe — inclusive com a cópia `PhaseSet → fila da sala` quando vem
`setId`. Da seção 6, **a leitura da fila (`GET /rooms/{code}/queue`) existe**; as
mutações, não. As seções 5 e 7–12 (conjuntos de fases, partida, respostas,
comparação, painel do líder, relatórios, landing) **existem só como modelo de
dados** (entidades EF Core), sem endpoint próprio. **Nenhum evento de realtime é
publicado** — o serviço de WebSocket descrito em
`contract/websocket-contract.md` não tem nem projeto iniciado.

---

## 1. Rotas implementadas

| # | Rota do contrato | Implementada? | Arquivo |
|---|---|---|---|
| 2 | `GET /session` | ✅ | `Endpoints/SessionEndpoints.cs` |
| 2 | `POST /auth/login` | ✅ | `Endpoints/AuthEndpoints.cs` |
| 2 | `POST /auth/signup` | ✅ | `Endpoints/AuthEndpoints.cs` |
| 2 | `POST /auth/oauth/{provider}/authorize` | ❌ | não iniciada |
| 2 | `POST /auth/logout` | ⚠️ parcial | responde `204`, mas não invalida o token no servidor (token é stateless — ver §3) |
| 2 | `PATCH /users/me` | ✅ | `Endpoints/UserEndpoints.cs` · `Services/UserProfileService.cs` |
| 2 | `GET /users/{userId}/profile` | ⚠️ parcial | `Endpoints/UserEndpoints.cs`; `matches` sai sempre vazio porque nada cria `Match` ainda (seção 7) — ver §2 |
| 3 | `GET /rooms/{code}/availability` | ✅ | `Endpoints/RoomEndpoints.cs` |
| 3 | `POST /rooms/{code}/participants` | ✅ | `Endpoints/ParticipantEndpoints.cs` |
| 4 | `POST /rooms` (criar sala) | ✅ | `Endpoints/RoomEndpoints.cs` · `RoomService.CreateAsync` · `RoomQueueService` |
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
| 6 | `GET /rooms/{code}/queue` | ✅ | `Endpoints/RoomQueueEndpoints.cs` · `RoomQueueService.GetQueueAsync` |
| 6 | mutações de fila (`POST`/`DELETE`/`PATCH` de conjunto, `PATCH`/`DELETE` de fase, `PUT …/order`) | ❌ | zero endpoint, **mas a cópia `PhaseSet → fila` já existe** em `RoomQueueService.AppendSetAsync` (escrita para o `setId` do `POST /rooms`), com paleta de 8 cores e `TOO_MANY_SETS` |
| 6 | `GET /rooms/{code}/queue/phases/{phaseId}` (modal "Ver desafio") | ❌ | o payload da fila não traz enunciado nem gabarito — é esta rota que traz |
| 7 | `POST /rooms/{code}/match`, `GET /rooms/{code}/match`, `GET /matches/{id}/current-phase` | ❌ | entidade `Match` existe, zero endpoint |
| 8 | `POST …/submissions`, `POST …/run`, `POST …/ready` | ❌ | entidade `Submission` existe, zero endpoint; `run` precisa de sandbox de execução (não decidido) |
| 9 | `GET …/comparison`, `GET …/scoreboard/me`, `GET …/podium` | ❌ | não iniciada |
| 10 | `GET …/stats`, `advance`, `pause`, `restart`, `finish`, `return-to-lobby`, `DELETE …/participants/{id}` (partida) | ❌ | não iniciada |
| 11 | Relatórios (`report`, `report/export`, `GET /jobs/{jobId}`) | ❌ | não iniciada; contrato já registra que não há tela pronta |
| 12 | `GET /marketing/landing` | ❌ | opcional — hoje o conteúdo é local em `src/content/landing.ts` no front |

**Contagem:** 14 de ~45 rotas do contrato têm endpoint no backend — 13 das seções
2–4, mais o `GET` da fila (seção 6).

---

## 2. Lacunas que bloqueiam o resto

### ~~`POST /rooms` não existe~~ — resolvido

Era o bloqueador nº 1: `contract/api-lobby-log.md` §10 registrava que nenhuma seção
original do contrato definia como criar uma sala, e por isso todo teste ponta a
ponta precisava semear a sala via SQL. A rota existe agora (§4 do contrato), e
com ela **a demonstração ponta a ponta pela UI passou a ser possível**: perfil →
"Criar sala" → lobby, sem SQL manual.

As três decisões que o `api-lobby-log.md` deixou em aberto foram fechadas assim:

- **Geração do código.** 6 dígitos de `RandomNumberGenerator` (não sequencial,
  não derivado do relógio — o código é a única credencial da sala), verificados
  contra as salas **ativas**, não contra a tabela inteira: a seção 13 é explícita
  que códigos são reciclados quando a sala expira, e é por isso que
  `rooms.Code` nem tem índice único.
  **Limitação conhecida:** entre o `SELECT` e o `INSERT` cabe outra sala nascendo
  com o mesmo código. Uma constraint não resolveria — a unicidade é sobre "sala
  ativa" e o predicado (`ExpiresAt > agora`) não é imutável, então o Postgres não
  aceita índice parcial com ele. Com 10⁶ códigos a janela não justifica uma
  tabela de reserva; se um dia justificar, o lugar é `RoomService.GenerateCodeAsync`.
- **Quem pode criar.** Exige conta (`403 ACCOUNT_REQUIRED` para convidado).
  "Líder" é um `userId` em todo o resto do contrato — sem conta não há o que
  gravar em `LeaderUserId`.
- **O que `setId` faz.** Copia o conjunto para a fila da sala na **mesma
  transação** da criação, então não existe o estado intermediário "sala criada,
  fila falhou". Isso antecipou parte da seção 6 (ver `Services/RoomQueueService.cs`).

Padrões novos: `capacity` nasce em 20 (valor dos exemplos das seções 3–4; o líder
ajusta pelo `PATCH`), `status: lobby`, `matchMode: null`, `locked` e
`requireAccount` em `false`.

### ~~Lobby do líder quebrava inteiro por causa da fila~~ — resolvido

`GET /rooms/{code}/queue` não existia, e o lobby chama essa rota **no servidor,
durante o render** (`src/app/sala/[code]/lobby/page.tsx`, dentro de um
`Promise.all` sem `try/catch`). Resultado: `404` do roteador do ASP.NET →
`ApiError` → a página inteira falhava para o líder. O participante não via nada
disso, porque o front só busca a fila quando `isLeader`. Era o primeiro caso de
uma rota faltando derrubar uma tela em vez de degradá-la — vale como aviso para
as seções 5–7: **rota ausente hoje quebra render, não só some um bloco.**

Decisões que esta rota tomou e que valem para o resto da seção 6:

- **É rota de líder** (`403 NOT_ROOM_LEADER` para qualquer outro, inclusive
  participante aprovado e anônimo). A fila é o roteiro da aula com os nomes das
  fases que ainda não foram jogadas; a tabela de acesso da seção 14 lista
  "todas as de `/queue/*`" só no lobby do líder.
- **Fila vazia é `200` com duas listas vazias**, não `404`. Sala criada sem
  `setId` nasce exatamente assim, e o lobby precisa abrir para o líder poder
  adicionar o primeiro conjunto.
- **`setId` no payload é o id da linha da fila** (`RoomQueueSet.Id`), não o
  `SourcePhaseSetId`. É ele que `/queue/sets/{setId}` vai receber de volta —
  mandar o id de origem faria o mesmo conjunto adicionado duas vezes na sala
  virar dois itens com o mesmo id.
- **Duas listas paralelas, fases não aninhadas no conjunto** (é o que o contrato
  desenha): a ordem que vale é a da fila inteira, atravessando conjuntos. Por
  isso o `ORDER BY` é `OrderIndex` da fase, e não agrupamento por conjunto —
  depois do primeiro arrasto (`PUT …/order`) agrupar daria a ordem errada.
- **`phaseCount` sai da lista de fases já carregada**, não de uma subconsulta por
  conjunto: mesmo número, e sem chance de as duas leituras discordarem.
- Detalhe de serialização: `pointsMultiplier` sai como `1.00` (é `decimal` no
  banco), não `1`. É o mesmo número em JSON e o front tipa como `number` — mas
  quem comparar payload com o exemplo do contrato vai ver a diferença.

`RoomQueueService.GetQueueAsync` tem uma sobrecarga por `roomId` **sem checagem
de acesso**, para as mutações que faltam: "todas as mutações desta seção
devolvem a fila inteira recalculada" e elas já terão resolvido a sala.

### Front já construído esperando por seção 5 (editor de conjuntos) sem backend

O working tree do Next tem, sem commit ainda: `src/app/conjunto/` (rotas do
editor), `src/components/set-editor/` (rail de fases, formulários por tipo),
`src/lib/api/phaseSets.ts` e `src/lib/actions/phaseSets.ts` — todos batendo
exatamente nas rotas de `contract/api-rest-contract.md` §5
(`GET /phase-sets/{id}/draft`, `POST /phase-sets`, `PUT .../draft`,
`POST .../phases/generate`). Nenhuma delas tem endpoint no `.NET`. A tela
existe e não tem com o que falar. **É agora o maior bloco de UI parado esperando
API**, e tem um efeito indireto: sem rota de criação de conjunto, o `setId` do
`POST /rooms` e a lista `sets` do perfil só têm dado se alguém semear via SQL.

### `GET /users/{userId}/profile` responde, mas `matches` sai sempre vazio

A rota está completa em código — os agregados do histórico (`participantCount`,
`avgScore`, `accuracyRate`, `durationLabel`) foram escritos de verdade, e não
como placeholder, porque todo o dado de que precisam já existe no schema. Só que
**nada cria `Match` ainda** (seção 7 não tem endpoint), então a lista vem vazia
em qualquer instalação. Ela acende sozinha no dia em que `POST /rooms/{code}/match`
existir, sem tocar neste código.

Decisões que o contrato não define e que estas duas rotas precisaram tomar —
registradas aqui porque a seção 5 (`GET /phase-sets`) vai esbarrar nas mesmas:

- **`email` vazio em perfil alheio.** O contrato diz que "pode vir vazio"; vem.
  Email não aparece em pixel nenhum de perfil de outra pessoa, e mandá-lo assim
  mesmo o exporia a qualquer um que soubesse um id.
- **Perfil alheio só lista conjuntos `community`.** Um rascunho privado não vira
  público porque alguém abriu o link do autor. Como efeito, o mesmo conjunto sai
  como `owned` (com `updatedLabel`) para o dono e como `community` (com
  `authorName`) para os outros — que é exatamente a distinção que
  `PhaseSetSummary` faz na seção 5. **`source` é relativo a quem olha, não é um
  atributo do conjunto.**
- **`me` sem sessão é `403 ACCOUNT_REQUIRED`**, não 401: o front só monta essas
  telas para quem está logado, então chegar sem `userId` é bug de integração, e o
  code descreve o que falta. Mesmo critério do `POST /rooms`.
- **Id de usuário irresolvível é `404 USER_NOT_FOUND`**, não 400 — para quem
  olha, um id que não resolve é um perfil que não existe. Segue `USER_NOT_FOUND`
  e `PHASE_SET_NOT_FOUND` a lista de codes fora da tabela da seção 1, junto de
  `VALIDATION_ERROR` e `PARTICIPANT_NOT_FOUND` (ver `api-lobby-log.md` §8).
- **`PATCH /users/me` só mexe no que veio.** `null` é "não mexe", como no
  `PATCH /rooms/{code}`. `plan` e `audience` não são editáveis: o contrato não os
  lista, e plano muda por cobrança, não por formulário.
- **Histórico corta em 50 partidas.** O contrato não pagina e a tela não tem
  "carregar mais"; três anos de aulas não podem virar uma resposta de megabytes.
- **Um título por linha de histórico.** A fila aceita até 8 conjuntos, a linha
  mostra um: o primeiro nomeia e o resto vira contagem (`"Frações +2"`).

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
  ou os dois juntos desde `api-lobby-log.md`) via token opaco protegido por Data
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
- **Rótulos formatados no servidor** (`Common/Formatting/LabelFormatter.cs`) — o
  contrato repete em duas seções que `updatedLabel`, `playedAtLabel` e
  `durationLabel` vêm prontos "para o front não carregar biblioteca de datas".
  Está num serviço só, então as rotas da seção 5 (`GET /phase-sets`) e da seção
  11 (relatórios) reusam sem reescrever nada. Duas consequências de o projeto
  rodar com `InvariantGlobalization`: os nomes de mês são uma tabela literal (não
  `CultureInfo("pt-BR")`, que lançaria) e o fuso é um **deslocamento fixo**
  (`CodexApi:DisplayUtcOffsetHours`, padrão `-3`), não um `TimeZoneInfo` por id
  IANA. Enquanto o produto for pt-BR isso é exato — o Brasil não tem horário de
  verão desde 2019.
- **Fila da sala** (`Services/RoomQueueService.cs`) — a cópia
  `PhaseSet → fila` (paleta fixa de 8 tons sem repetir na sala, limite de 8
  conjuntos com `TOO_MANY_SETS`, ordenação contínua entre conjuntos) e a leitura
  da fila no formato do contrato. As cores são tokens que existem de fato em
  `nextjs/src/styles/tokens/colors.css`; o front só repassa a string, então um
  token inventado aqui viraria cor vazia lá. A cópia foi escrita para o `setId`
  do `POST /rooms`, mas é exatamente o que `POST /rooms/{code}/queue/sets`
  (seção 6) vai chamar — a regra tem que ser uma só, senão a sala criada com
  conjunto e a sala que recebeu o conjunto depois divergem. O mesmo vale para
  `GetQueueAsync(roomId)`: é o corpo de resposta de todas as mutações que faltam.
- **Rate limiting** — implementado, mas só para o código da sala
  (`availability` + `POST` de participante), com a limitação conhecida de
  particionar por código e não por IP do browser final (ver
  `contract/api-lobby-log.md` §7). Nenhum rate limit configurado ainda para
  `POST /rooms` (criação em massa de salas), para `POST …/run` (execução de
  código) ou para o WS.
- **Testes automatizados**: 111 testes (`dotnet test`, xUnit + EF Core InMemory),
  cobrindo `AuthService`, `RoomService`, `ParticipantService`, `RoomQueueService`,
  `UserProfileService` e `LabelFormatter`, sem precisar de Postgres. Os índices
  únicos parciais (`USERNAME_TAKEN`, `EMAIL_TAKEN`) foram verificados
  manualmente contra Postgres real (InMemory não suporta índices).

### Um desvio transversal que continua aberto

**Corpo JSON malformado responde `500 INTERNAL_ERROR`, não `400 VALIDATION_ERROR`.**
Vale para todas as rotas, não só as novas: `{"avatarIndex":"x"}` ou
`{"rememberMe":"x"}` estouram no binder antes de qualquer código do app rodar, e
o `ApiExceptionHandler` não distingue isso de uma falha real. A UI trata como
`network` de qualquer forma ("qualquer outra falha a UI trata como network",
seção 1) e o front é tipado, então nunca produz esse corpo — mas o dia em que
alguém integrar um cliente não-tipado, o 500 vai mentir sobre de quem é a culpa.
Conserto: um `IExceptionHandler` para `BadHttpRequestException` antes do atual.

## 4. Modelo de dados — mais completo do que os endpoints

O schema EF Core (`Data/Migrations`, três migrations aplicadas:
`Initial`, `ParticipantUniqueDisplayName` e `UserAudience`) já modela **todas** as entidades da
seção 13 do contrato — `User`, `Room`, `Participant`, `PhaseSet`, `Phase`,
`RoomQueueSet`, `RoomQueuePhase`, `Match`, `Submission` — traduzidas de
Firestore para PostgreSQL/relacional (decisão registrada em
`contract/api-init-log.md` §2). Ou seja: **o banco já suporta as seções 5–10**, só
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
  tipo ainda não foi escrita. A cópia para a fila move o `ContentJson` **literal**,
  sem desserializar: nada nesta leva precisou entender o formato por `kind`.

### `users.Audience` — a coluna que faltava para o contrato de `User`

`audience` (`"teacher" | "recruiter"`) está no `User` do contrato desde a versão
atualizada, aparece em `GET /session` e no perfil, e o front usa (`ProfileView`
troca "Participantes" por "Candidatos"). Não existia no schema — a migration
`UserAudience` a criou, com default `Teacher` para as contas já existentes.

**Nenhuma rota escreve esse campo ainda:** nem o `POST /auth/signup` nem o
`PATCH /users/me` o aceitam no contrato, então toda conta nasce `teacher` até
existir a tela que pergunta. É um dado do contrato que está sendo servido com um
valor fixo — vale saber antes de desenhar qualquer coisa em cima dele. E, como o
contrato avisa, **não é permissão**: nada no servidor decide nada com ele.

## 5. O que o modelo de dados **não** cobre

- Nenhuma entidade para relatórios (seção 11) ou CMS da landing (seção 12) —
  tratados como especulativos no próprio contrato.
- `Room.ExpiresAt` existe na tabela, mas nada preenche esse campo — TTL de sala
  não funciona ainda. Com `POST /rooms` no ar isso passou de teórico a
  acumulativo: cada sala criada segura um código de 6 dígitos **para sempre**,
  porque a busca por código livre só ignora sala expirada e nada expira. O
  `POST /rooms` deliberadamente não preenche `ExpiresAt` na criação — o contrato
  sugere TTL a partir do *fim* da partida, e cravar 24h da criação mataria uma
  sala que ainda nem começou.
- Nenhuma tabela de sessões revogáveis — `POST /auth/logout` não invalida o
  token de fato (token stateless, expira só pelo `expiresIn`).

## 6. Realtime — arquiteturalmente ausente

- Não existe, neste repositório, nenhum projeto do serviço de WebSocket. É
  tratado desde `contract/api-init-log.md` como "um projeto Node.js separado" cuja
  forma de saber que algo mudou (ler o Postgres direto, uma fila, um webhook)
  **ainda não foi decidida**.
- As três rotas de líder já implementadas (`PATCH /rooms/{code}`, approve,
  reject, delete de participante) têm `// TODO(realtime)` no código exatamente
  onde a publicação de evento deveria entrar — mas nada é publicado hoje. Um
  segundo browser no lobby só vê a mudança se recarregar a página.
- As rotas desta leva **não acrescentaram pontos de publicação**: `POST /rooms`
  cria a sala antes de existir alguém para notificar, as duas de perfil não
  têm evento correspondente em `websocket-contract.md` §5, e
  `GET /rooms/{code}/queue` só lê. As mutações da seção 6, essas sim, vão
  precisar publicar `queue.updated` (`websocket-contract.md` §5) — que manda só
  o número da revisão, "quem quiser detalhe refaz `GET`". O `GET` que ele manda
  refazer agora existe; falta o evento.

---

## 7. Como este estado foi verificado

```bash
dotnet ef database update --project src/Codex.Api --startup-project src/Codex.Api
dotnet test          # 111 testes, sem precisar de Postgres
dotnet run --project src/Codex.Api
```

Os 111 testes rodam em EF InMemory. **O que eles não cobrem**, e por isso foi
verificado à mão contra um Postgres 18 local: os índices únicos (InMemory não tem
índices), a migration `UserAudience` aplicada sobre dados existentes, e a cópia
`PhaseSet → fila` gravando de fato as duas tabelas.

Rodado ponta a ponta em sessões anteriores: signup → `GET /session` com
`audience` → `PATCH /users/me` → `POST /rooms` (com e sem `setId`, e sem corpo
nenhum) → `GET /users/me/profile` com o conjunto aparecendo como
`"editado há 2 dias"`; mais os erros `ACCOUNT_REQUIRED` (criar sala e perfil sem
sessão), `PHASE_SET_NOT_FOUND`, `EMAIL_TAKEN`, `VALIDATION_ERROR` (email
implausível) e `USER_NOT_FOUND` (id irresolvível). O `PhaseSet` do teste do
`setId` precisou ser semeado via SQL, porque a seção 5 ainda não tem rota que
crie um.

`GET /rooms/{code}/queue`, contra o mesmo Postgres: fila vazia (`200
{"sets":[],"phases":[]}` numa sala criada sem `setId`), fila com um conjunto de
3 fases (cor `var(--blue-500)`, `phaseCount: 3`, `setId` de cada fase apontando
para o conjunto), `403 NOT_ROOM_LEADER` nas três variantes de quem não é o líder
(outro usuário logado, participante aprovado, sem sessão), `404 ROOM_NOT_FOUND`
para código inexistente e para código malformado, e `401` sem `x-service-token`.
