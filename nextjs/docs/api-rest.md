# API REST do Codex

Este documento lista **todas as rotas que a interface precisa** para funcionar sem
nenhum dado mockado. Cada rota foi derivada de algo que aparece na tela — se um
campo está aqui, é porque existe um pixel que depende dele.

- **Base URL:** valor de `API_BASE_URL` (ex.: `https://api.codex.app/v1`).
- **Quem chama:** apenas o servidor do Next (Server Components e Server Actions).
  O browser nunca fala com esta API diretamente — ele só abre o WebSocket.
- **Tipos:** os formatos de resposta são exatamente os de `src/lib/types.ts`.
  Esse arquivo e este documento são o mesmo contrato em duas linguagens.

---

## 1. Convenções

### Autenticação

| Cabeçalho | Origem | Uso |
|---|---|---|
| `Authorization: Bearer <token>` | cookie `codex_session` (httpOnly) | identifica usuário **ou** participante convidado |
| `x-service-token` | `API_SERVICE_TOKEN` | prova que a chamada veio do servidor do Next, não de um cliente |

O token de sessão cobre dois sujeitos diferentes:

- **usuário autenticado** — tem `userId`, criado no login/cadastro;
- **participante convidado** — tem apenas `participantId` + `roomCode`, criado ao
  entrar numa sala sem conta, e expira junto com a sala.

O backend resolve os dois para o mesmo "quem está falando". Toda rota de partida
aceita os dois; rotas de líder exigem que o `userId` seja o dono da sala.

### Erros

Sempre JSON, sempre com `code` estável (a UI escolhe o texto pelo `code`, nunca
pela `message`):

```json
{ "code": "ROOM_LOCKED", "message": "O apresentador travou a entrada." }
```

| HTTP | `code` | Onde aparece na UI |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | "Email ou senha incorretos." |
| 409 | `EMAIL_ALREADY_USED` | "Já existe uma conta com este email." |
| 404 | `ROOM_NOT_FOUND` | diálogo "Sala não encontrada" |
| 423 | `ROOM_LOCKED` | diálogo "Sala fechada" |
| 403 | `ACCOUNT_REQUIRED` | diálogo "Conta necessária" |
| 409 | `USERNAME_TAKEN` | diálogo "Nome já em uso" |
| 409 | `ROOM_FULL` | diálogo "Sala cheia" |
| 403 | `NOT_ROOM_LEADER` | rota de líder chamada por aluno |
| 409 | `PHASE_ALREADY_SUBMITTED` | reenvio na mesma fase |
| 429 | `RATE_LIMITED` | proteção de força bruta no código da sala |

Qualquer outra falha (incluindo timeout de rede) a UI trata como `network`.

### Cache

Tudo que é de partida ou lobby é `no-store`. As únicas rotas cacheáveis são
`GET /phase-sets` (60 s) e `GET /marketing/landing` (300 s).

---

## 2. Sessão e autenticação

### `GET /session`
Resolve o cookie. É a primeira coisa que todo Server Component chama.

```json
{
  "user": { "id": "u_1", "name": "Marina Duarte", "email": "marina@escola.br", "avatarIndex": 2, "plan": "intermediate" },
  "participantId": null,
  "roomCode": null
}
```
Sem cookie válido → `{ "user": null, "participantId": null, "roomCode": null }` (200, não 401).

### `POST /auth/login`
```json
{ "email": "…", "password": "…", "rememberMe": true }
```
→ `{ "token": "…", "expiresIn": 2592000, "user": { … } }`

`rememberMe` só altera `expiresIn` (30 dias vs. sessão do browser).

### `POST /auth/signup`
```json
{ "name": "…", "email": "…", "password": "…" }
```
→ mesma resposta do login. A confirmação de email/senha é validada no cliente
(os dois campos "Confirmar…"); o backend recebe só o valor final.

### `POST /auth/oauth/{provider}/authorize`
`provider` ∈ `google` | `microsoft` | `github`.

```json
{ "redirectTo": "/sala" }
```
→ `{ "authorizeUrl": "https://accounts.google.com/o/oauth2/v2/auth?…" }`

O callback do provedor bate no backend, que redireciona para o Next já com o
cookie de sessão setado.

### `POST /auth/logout`
→ `204`. Invalida o token.

---

## 3. Entrar numa sala

O fluxo tem dois passos justamente porque os erros precisam aparecer em telas
diferentes: erro de código volta no passo 1, erro de nome no passo 2.

### `GET /rooms/{code}/availability`
Valida o código **antes** de pedir nome e avatar. Não cria nada.

→ `200 { "code": "482913", "capacity": 20, "requireAccount": false }`

Erros: `ROOM_NOT_FOUND`, `ROOM_LOCKED`, `ACCOUNT_REQUIRED`, `ROOM_FULL`.

> `ACCOUNT_REQUIRED` só é retornado quando a sala exige conta **e** quem chamou
> não está autenticado — por isso esta rota precisa ver o `Authorization`.

### `POST /rooms/{code}/participants`
```json
{ "displayName": "Ana Silva", "avatarIndex": 0 }
```
→ `201`
```json
{
  "participant": { "id": "p_9", "roomId": "r_1", "displayName": "Ana Silva", "avatarIndex": 0, "loggedIn": false, "userId": null, "status": "pending", "joinedAt": "2026-07-29T14:02:11Z" },
  "token": "…",
  "expiresIn": 14400
}
```

Erros: todos os de `availability` mais `USERNAME_TAKEN`.

O participante nasce `pending`. Quem aprova é o líder — enquanto isso o aluno
fica no lobby vendo "Aguardando … iniciar a partida".

---

## 4. Sala (lobby)

### `GET /rooms/{code}`
```json
{
  "id": "r_1",
  "code": "482913",
  "status": "lobby",
  "matchMode": null,
  "capacity": 20,
  "locked": false,
  "requireAccount": false,
  "leader": { "id": "u_1", "name": "Marina Duarte" },
  "createdAt": "2026-07-29T13:50:00Z"
}
```

O front compara `leader.id` com `session.user.id` para decidir entre a visão de
líder e a de jogador. **A API precisa aplicar a mesma regra**: nunca confie no
front para esconder dado de líder.

### `GET /rooms/{code}/participants?status=approved|pending`
→ `Participant[]`.

`status=pending` só é permitido ao líder (`403 NOT_ROOM_LEADER` caso contrário).

### `PATCH /rooms/{code}` — líder
```json
{ "locked": true, "requireAccount": false, "capacity": 30 }
```
→ `Room` atualizado. Publica `room.settings` no WebSocket.

### `POST /rooms/{code}/participants/{id}/approve` — líder
### `POST /rooms/{code}/participants/{id}/reject` — líder
### `DELETE /rooms/{code}/participants/{id}` — líder

→ `204`. Publicam `participant.updated` / `participant.left`.

Regra: se `requireAccount` está ligado, `approve` de um participante com
`loggedIn: false` deve responder `403 ACCOUNT_REQUIRED` (a UI já desabilita o
botão, mas a checagem tem que existir no servidor).

---

## 5. Conjuntos de fases

### `GET /phase-sets?scope=owned|community&q={busca}`
Alimenta o seletor "Escolher conjunto de fases". A busca é no servidor porque a
biblioteca da comunidade não cabe no cliente.

```json
[
  { "id": "s1", "title": "Frações & Funções Básicas", "phaseCount": 8, "source": "owned", "updatedLabel": "editado há 2 dias", "authorName": null },
  { "id": "c1", "title": "Álgebra para o ENEM", "phaseCount": 10, "source": "community", "updatedLabel": null, "authorName": "Prof. Marcos" }
]
```

`updatedLabel` vem pronto do servidor (já relativo e localizado) para o front não
precisar de biblioteca de datas.

---

## 6. Fila de fases da sala — líder

A fila é o que a partida vai executar: as fases de todos os conjuntos escolhidos,
numa ordem, com pontuação e tempo possivelmente ajustados.

**Todas as mutações desta seção devolvem a fila inteira recalculada.** Isso evita
um refetch por clique e mantém servidor e UI na mesma verdade (a cor de cada
conjunto e os índices são decididos no servidor).

### `GET /rooms/{code}/queue`
```json
{
  "sets": [
    { "setId": "s1", "title": "Frações & Funções Básicas", "color": "var(--blue-500)", "phaseCount": 8 }
  ],
  "phases": [
    { "id": "ph_1", "setId": "s1", "name": "Frações equivalentes", "kind": "quiz", "basePoints": 100, "pointsMultiplier": 1, "timeSeconds": 45 }
  ]
}
```

`color` é atribuída pelo servidor a partir de uma paleta fixa de 8 tons, sem
repetir dentro da mesma sala. Vai como string de token CSS para o front só
repassar.

### `POST /rooms/{code}/queue/sets` — `{ "setId": "s2" }`
Acrescenta todas as fases do conjunto ao fim da fila. Máximo de **8 conjuntos**
por sala (`409 TOO_MANY_SETS`).

### `DELETE /rooms/{code}/queue/sets/{setId}`
Remove o conjunto **e todas as fases dele** da fila.

### `PATCH /rooms/{code}/queue/sets/{setId}`
```json
{ "basePoints": 150, "pointsMultiplier": 2, "timeSeconds": 60 }
```
Aplica os três valores a todas as fases daquele conjunto de uma vez.

### `PATCH /rooms/{code}/queue/phases/{phaseId}`
```json
{ "name": "…", "basePoints": 100, "pointsMultiplier": 1.5, "timeSeconds": 45, "expectedAnswer": "…" }
```
Todos os campos são opcionais. `expectedAnswer` só vale para fases `text`/`code`
e é o gabarito que alimenta a correção por IA.

### `DELETE /rooms/{code}/queue/phases/{phaseId}`

### `PUT /rooms/{code}/queue/order` — `{ "phaseIds": ["ph_3", "ph_1", "ph_2"] }`
Reordenação por arrastar-e-soltar. A lista precisa conter **exatamente** os ids
atuais da fila (`409 QUEUE_MISMATCH` se divergir — protege contra dois
navegadores reordenando ao mesmo tempo).

### `GET /rooms/{code}/queue/phases/{phaseId}`
Detalhe completo da fase, para o modal "Ver desafio". Devolve um `Phase` com
gabarito (`correctOptionId`, `correctWords`, `expectedAnswer`) — só o líder pode
chamar.

---

## 7. Partida

### `POST /rooms/{code}/match` — líder
```json
{ "mode": "live" }
```
`mode` ∈ `live` (todos juntos, o líder avança) | `self-paced` (cada aluno no seu
ritmo). → `201 Match`. Publica `match.started`.

Rejeita com `409 EMPTY_QUEUE` se não houver fases, e `409 NO_PLAYERS` se não
houver ninguém aprovado.

### `GET /rooms/{code}/match`
```json
{ "id": "m_1", "roomId": "r_1", "mode": "live", "status": "running", "currentPhaseIndex": 2, "totalPhases": 8, "startedAt": "2026-07-29T14:10:00Z" }
```

### `GET /matches/{matchId}/current-phase`
A rota mais importante da tela de Desafios. Devolve a fase corrente **já filtrada
pelo papel de quem pediu**.

```json
{
  "phase": { "id": "ph_1", "setId": "s1", "kind": "quiz", "name": "Frações equivalentes", "basePoints": 100, "pointsMultiplier": 1.5, "timeSeconds": 45,
             "question": "Qual fração abaixo é equivalente a 2/3?",
             "options": [{ "id": "o1", "label": "4/6" }, { "id": "o2", "label": "3/4" }] },
  "phaseNumber": 3,
  "totalPhases": 8,
  "secondsLeft": 32,
  "paused": false,
  "submittedCount": 12,
  "totalPlayers": 28,
  "mySubmission": null
}
```

> **Regra de ouro:** `correctOptionId`, `correctWords` e `expectedAnswer` **não
> podem** sair para um aluno enquanto a fase está aberta. Se saírem, o gabarito
> está no DevTools. Eles voltam junto com a submissão corrigida.

`mySubmission` preenchido significa que a pessoa recarregou a página depois de
enviar — o front cai direto na tela de espera em vez de mostrar o desafio de novo.

#### Formato de `phase` por tipo

**`quiz`** — `question`, `options[{id,label}]`, (`correctOptionId`, `explanation` restritos).

**`fill`** — a frase vem quebrada em segmentos, para o front não fazer parse:
```json
{
  "kind": "fill",
  "segments": [
    { "type": "text", "value": "Uma fração é equivalente a outra quando, ao" },
    { "type": "blank", "index": 0 },
    { "type": "text", "value": "o numerador e o denominador pelo mesmo número, a" },
    { "type": "blank", "index": 1 },
    { "type": "text", "value": "entre eles se mantém igual." }
  ],
  "words": ["multiplicar", "somar", "proporção", "quantidade"]
}
```
(`correctWords` restrito.)

**`text`** — `question`, `placeholder`, (`expectedAnswer` restrito).

**`code`**:
```json
{
  "kind": "code",
  "title": "Soma dos pares",
  "difficulty": "easy",
  "tags": ["Array"],
  "statement": "Dado um array de inteiros `nums` e um inteiro `target`, retorne os índices…",
  "examples": [{ "input": "nums = [2,7,11,15], target = 9", "output": "[0,1]" }],
  "fileName": "solucao.js",
  "languages": [
    { "id": "js", "label": "JavaScript", "enabled": true, "starterCode": "function somaDosPares(nums, target) {\n}\n" },
    { "id": "py", "label": "Python", "enabled": false, "starterCode": "" }
  ]
}
```
`statement` é texto puro; só `` `crase` `` é interpretado como código inline. Não
envie HTML — o front não renderiza HTML arbitrário.

---

## 8. Respostas

### `POST /matches/{matchId}/phases/{phaseId}/submissions`
```json
{ "answer": { "kind": "quiz", "optionId": "o1" } }
```

Formatos de `answer`:

| tipo | corpo |
|---|---|
| `quiz` | `{ "kind": "quiz", "optionId": "o1" }` |
| `fill` | `{ "kind": "fill", "blanks": ["multiplicar", "proporção"] }` (índice = lacuna) |
| `text` | `{ "kind": "text", "value": "…" }` |
| `code` | `{ "kind": "code", "languageId": "js", "source": "…" }` |

→ `201 Submission`:
```json
{
  "id": "sub_1", "phaseId": "ph_1", "participantId": "p_9",
  "answer": { "kind": "quiz", "optionId": "o1" },
  "submittedAt": "2026-07-29T14:11:03Z",
  "elapsedSeconds": 14,
  "grading": "graded",
  "correct": true,
  "score": 150,
  "explanation": "Multiplicando numerador e denominador de 2/3 por 2, obtemos 4/6…",
  "aiSuggestions": null,
  "testsPassed": null
}
```

**Correção síncrona vs. assíncrona:**

- `quiz` e `fill` são determinísticos → voltam já com `grading: "graded"`.
- `text` e `code` dependem de IA / execução de testes → voltam com
  `grading: "pending"`, `correct: null`, `score: null`. O resultado chega depois
  pelo evento `submission.graded` no canal privado do participante.

A tela sabe lidar com os dois: enquanto está `pending` mostra "sua resposta está
sendo avaliada" e troca sozinha quando o evento chega.

**Pontuação** é do servidor. Sugestão de fórmula, para a UI bater com o backend:

```
score = round(basePoints × pointsMultiplier × acerto × bônusDeTempo)
acerto        ∈ [0,1]   (1/0 em quiz e fill; nota da IA em text; % de testes em code)
bônusDeTempo  = 0.5 + 0.5 × (segundosRestantes / timeSeconds)
```

`elapsedSeconds` é calculado **no servidor** (`submittedAt − phaseStartedAt`), não
enviado pelo cliente.

Reenvio na mesma fase → `409 PHASE_ALREADY_SUBMITTED`.
Envio depois do fim → `409 PHASE_CLOSED`.

### `POST /matches/{matchId}/phases/{phaseId}/run` — só fases `code`
```json
{ "languageId": "js", "source": "…" }
```
→
```json
{ "status": "success", "output": "Entrada: nums = [2,7,11,15], target = 9\nSaída: [0, 1]", "testsPassed": { "passed": 1, "total": 1 } }
```

Roda **apenas os casos de exemplo** (nunca os de teste completos — senão o aluno
descobre o gabarito por tentativa). Não conta como envio, não altera pontuação.
Precisa de sandbox com limite de CPU/memória e rate limit (sugestão: 1 execução a
cada 3 s por participante).

### `POST /matches/{matchId}/phases/{phaseId}/ready` — modo `live`
→ `204`. Marca o aluno como pronto para avançar. Alimenta o card "Prontos para a
próxima fase" do painel do líder.

---

## 9. Feedback e comparação

### `GET /matches/{matchId}/phases/{phaseId}/comparison`
Alimenta a tela "Como você se compara aos outros jogadores".

```json
{
  "myScore": 850,
  "phaseScore": 150,
  "percentile": 91,
  "histogram": [
    { "score": 40, "isMe": false },
    { "score": 150, "isMe": true },
    { "score": 180, "isMe": false }
  ],
  "correctAnswerLabel": "4/6",
  "correct": true
}
```

`histogram` já vem **ordenado por pontuação** e sem nomes (é anônimo por
construção). O front só desenha as barras e destaca `isMe`. Se a turma for grande,
agregue em ~15 baldes antes de enviar.

Só responde depois que a fase fechou (`409 PHASE_STILL_OPEN` antes disso) — é
aqui que o gabarito finalmente sai.

### `GET /matches/{matchId}/scoreboard/me`
→ `{ "myScore": 850, "avgScore": 620 }` — os dois números do canto da barra superior.

### `GET /matches/{matchId}/podium`
```json
[
  { "participantId": "p_1", "name": "Ana Silva", "score": 1240, "avatarIndex": 0, "avatarUrl": null },
  { "participantId": "p_2", "name": "Bruno Costa", "score": 1180, "avatarIndex": 1, "avatarUrl": null },
  { "participantId": "p_3", "name": "Carla Souza", "score": 1050, "avatarIndex": 2, "avatarUrl": null }
]
```
Ordenado, no máximo 3 posições (a tela só tem três degraus).

---

## 10. Painel do líder

### `GET /matches/{matchId}/phases/{phaseId}/stats` — líder
Um único payload alimenta o painel inteiro. Também é o corpo do evento
`stats.updated`, para o WebSocket não ter formato próprio.

```json
{
  "phaseId": "ph_1",
  "submittedCount": 24, "totalPlayers": 28, "readyCount": 9,
  "accuracyRate": 79, "correctCount": 19, "gradedCount": 24,
  "avgResponseSeconds": 27, "fastestResponseSeconds": 9,
  "teamAvgScore": 640, "teamTopScore": 950,
  "answerDistribution": [
    { "optionId": "o1", "label": "4/6", "count": 14, "correct": true },
    { "optionId": "o2", "label": "3/4", "count": 6, "correct": false }
  ],
  "gradingDistribution": [
    { "status": "correct", "count": 19 },
    { "status": "incorrect", "count": 5 },
    { "status": "awaiting", "count": 4 }
  ],
  "responseTimeBuckets": [
    { "label": "0-15s", "count": 4 }, { "label": "15-30s", "count": 9 },
    { "label": "30-45s", "count": 8 }, { "label": "45-60s", "count": 3 }
  ],
  "players": [
    { "participantId": "p_1", "name": "Ana Silva", "avatarIndex": 0, "status": "submitted", "elapsedSeconds": 14, "correct": true },
    { "participantId": "p_4", "name": "Diego Alves", "avatarIndex": 3, "status": "pending", "elapsedSeconds": null, "correct": null }
  ]
}
```

- `answerDistribution` só faz sentido em `quiz`; nos outros tipos o painel usa
  `gradingDistribution`. Mande os dois — o custo é irrelevante e evita um
  if/else de rota.
- Os baldes de tempo são fatias iguais de `timeSeconds` (4 baldes). Os rótulos
  vêm prontos.
- `players` é o modo avançado do painel. No modo anônimo o front simplesmente não
  desenha a tabela, **mas o dado já veio** — se isso for problema de privacidade
  na sua operação, crie `?scope=aggregate` e omita `players`.

### Controles da partida — todos exigem líder

| Rota | Efeito | Evento publicado |
|---|---|---|
| `POST /matches/{id}/advance` `{ "direction": "next" \| "previous" }` | troca a fase corrente | `phase.started` |
| `POST /matches/{id}/pause` `{ "paused": true }` | congela o cronômetro de todos | `phase.paused` |
| `POST /matches/{id}/phases/{phaseId}/restart` | zera envios e cronômetro da fase | `phase.started` |
| `POST /matches/{id}/finish` | encerra e calcula o pódio | `match.finished` |
| `POST /matches/{id}/return-to-lobby` | volta todo mundo para o lobby | `match.returned-to-lobby` |
| `DELETE /matches/{id}/participants/{participantId}` | expulsa da partida | `participant.removed` (privado) + `phase.progress` |

`previous` só é aceito no modo `self-paced` (`409 INVALID_DIRECTION` no `live`).

---

## 11. Relatórios

Não há tela pronta ainda (o botão "Ver relatório" leva para `/sala/{code}/relatorio`),
mas as rotas ficam registradas porque a landing page as promete:

- `GET /matches/{matchId}/report` — relatório coletivo em JSON.
- `GET /matches/{matchId}/report/participants/{participantId}` — individual.
- `POST /matches/{matchId}/report/export` `{ "format": "pdf" | "xlsx" }` →
  `202 { "jobId": "…" }`, com o link chegando por `GET /jobs/{jobId}`.
  Exportação é assíncrona porque uma turma grande estoura o timeout de request.

---

## 12. Conteúdo da landing (opcional)

Hoje o texto da landing mora em `src/content/landing.ts` porque é conteúdo
editorial, não dado de domínio. Se virar CMS:

- `GET /marketing/landing` → `{ useCases, phaseSlides, features, pricingPlans, pricingRows }`
  com exatamente as mesmas formas do módulo TypeScript. O módulo passa a ser o
  fallback quando a chamada falha.

---

## 13. Modelagem no Firestore

O modelo é documento-orientado, então o desenho abaixo assume Firestore (vale
igual para MongoDB trocando "coleção/documento" pelos nomes equivalentes).

```
users/{userId}
rooms/{roomId}                      ← code é indexado, não é o id
  participants/{participantId}
  queue/{phaseId}                   ← cópia da fase no momento em que entrou na fila
matches/{matchId}
  phases/{phaseId}
    submissions/{participantId}     ← id = participantId garante 1 envio por pessoa
    stats/current                   ← documento único de agregados
phaseSets/{setId}
  phases/{phaseId}
```

Decisões que valem a pena destacar:

1. **A fila copia a fase, não referencia.** Se o autor editar o conjunto no meio
   da aula, a partida em andamento não muda debaixo dos alunos.

2. **`submissions/{participantId}`** — usar o id do participante como id do
   documento transforma "só pode enviar uma vez" numa garantia do banco
   (`create` falha se já existe), em vez de uma checagem sujeita a corrida.

3. **`stats/current` é agregado, não calculado na leitura.** Cada submissão
   atualiza o documento numa transação (`FieldValue.increment`). Contar 28
   submissões a cada evento de progresso seria O(n) por tecla digitada.

4. **`code` da sala é campo indexado, não id.** Códigos de 6 dígitos são
   reciclados quando a sala expira; o `roomId` é permanente.

5. **Regras de segurança não bastam.** Cliente nenhum lê o Firestore direto — só
   a API. É ela quem decide o que vai para aluno e o que vai para líder. Regras
   do Firestore são a segunda linha de defesa, não a primeira.

### Índices necessários

| Coleção | Campos |
|---|---|
| `rooms` | `code` (asc) — busca por código |
| `rooms/{id}/participants` | `status` (asc), `joinedAt` (asc) |
| `phaseSets` | `ownerId` (asc), `updatedAt` (desc) — aba "Meus conjuntos" |
| `phaseSets` | `visibility` (asc), `title` (asc) — aba "Comunidade" + busca |
| `matches/{id}/phases/{id}/submissions` | `score` (desc) — histograma e pódio |

### TTL

Salas e participantes convidados expiram. Configure TTL em `rooms.expiresAt`
(sugestão: 24 h após `finishedAt`) para o banco não acumular sala de aula antiga.

---

## 14. Mapa tela → rotas

| Tela | Rotas |
|---|---|
| Landing | nenhuma (conteúdo local) |
| Auth | `POST /auth/login`, `POST /auth/signup`, `POST /auth/oauth/{provider}/authorize` |
| Entrar em Sala | `GET /session`, `GET /rooms/{code}/availability`, `POST /rooms/{code}/participants` |
| Lobby (jogador) | `GET /session`, `GET /rooms/{code}`, `GET /rooms/{code}/participants?status=approved` |
| Lobby (líder) | as acima + `?status=pending`, `GET /rooms/{code}/queue`, `GET /phase-sets`, todas as de `/queue/*`, `PATCH /rooms/{code}`, aprovar/recusar/remover, `POST /rooms/{code}/match` |
| Desafios (aluno) | `GET /rooms/{code}/match`, `GET /matches/{id}/current-phase`, `GET /matches/{id}/scoreboard/me`, `POST …/submissions`, `POST …/run`, `POST …/ready`, `GET …/comparison`, `GET /matches/{id}/podium` |
| Desafios (líder) | `GET /matches/{id}/current-phase`, `GET …/stats`, `advance`, `pause`, `restart`, `finish`, `return-to-lobby`, `DELETE …/participants/{id}` |
