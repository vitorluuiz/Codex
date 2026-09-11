# API REST do Codex — contrato atualizado

> **Nota de proveniência:** este arquivo consolida o contrato de API na versão mais
> atual encontrada no repositório, copiado de `nextjs/docs/api-first-contract.md`
> (que já inclui alterações ainda não commitadas — `git diff --stat` mostra +153
> linhas nesse arquivo em relação ao `HEAD`). Ele **substitui**
> `contract/api-rest-contract.exemple.md`, que é uma versão mais antiga do mesmo
> documento e não tem: `audience` em `User`/`GET /session`, `PATCH /users/me`,
> `GET /users/{userId}/profile`, `POST /rooms` (criação de sala), e toda a seção 5
> do editor de conjuntos (`GET /phase-sets/{setId}/draft`, `POST /phase-sets`,
> `PUT /phase-sets/{setId}/draft`, `POST /phase-sets/phases/generate`). Trate
> `contract/api-rest-contract.exemple.md` como obsoleto a partir de agora — ele não
> foi apagado porque pode haver histórico de decisão preso a ele, mas o contrato
> vivo é este arquivo (espelhado de `nextjs/docs/api-first-contract.md` e de
> `nextjs/src/lib/types.ts`, que devem sempre ser lidos em conjunto).
>
> Para saber **o que da lista abaixo já está implementado** no backend .NET, veja
> `contracts2/api-implementation-status.md`. Para os próximos passos, veja
> `contracts2/next-steps.md`.

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

Quando alguém **com conta** entra numa sala, os dois fatos coexistem no mesmo
token: a pessoa continua logada na própria conta **e** vira participante daquela
sala (`GET /session` responde `user` + `participantId` + `roomCode` juntos).

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
| 409 | `EMAIL_TAKEN` | `PATCH /users/me` com email já em uso |
| 404 | `ROOM_NOT_FOUND` | diálogo "Sala não encontrada" |
| 423 | `ROOM_LOCKED` | diálogo "Sala fechada" |
| 403 | `ACCOUNT_REQUIRED` | diálogo "Conta necessária" |
| 409 | `USERNAME_TAKEN` | diálogo "Nome já em uso" |
| 409 | `ROOM_FULL` | diálogo "Sala cheia" |
| 403 | `NOT_ROOM_LEADER` | rota de líder chamada por aluno |
| 409 | `PHASE_ALREADY_SUBMITTED` | reenvio na mesma fase |
| 409 | `TOO_MANY_SETS` | mais de 8 conjuntos na fila |
| 409 | `QUEUE_MISMATCH` | reordenação com ids divergentes |
| 409 | `EMPTY_QUEUE` / `NO_PLAYERS` | iniciar partida sem fase ou sem aprovado |
| 409 | `PHASE_CLOSED` | envio depois do fim da fase |
| 409 | `PHASE_STILL_OPEN` | comparação pedida antes da fase fechar |
| 409 | `INVALID_DIRECTION` | `previous` no modo `live` |
| 404 | `PARTICIPANT_NOT_FOUND` | id de participante inexistente ou de outra sala |
| 400 | `VALIDATION_ERROR` | payload fora das regras de campo |
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
  "user": { "id": "u_1", "name": "Marina Duarte", "email": "marina@escola.br", "avatarIndex": 2, "plan": "intermediate", "audience": "teacher" },
  "participantId": null,
  "roomCode": null
}
```
Sem cookie válido → `{ "user": null, "participantId": null, "roomCode": null }` (200, não 401).

`audience` é `"teacher"` ou `"recruiter"` e só troca o vocabulário da interface
("Participantes" vira "Candidatos"). Não é permissão — não decida nada com base
nele no servidor.

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
{ "redirectTo": "/perfil" }
```
→ `{ "authorizeUrl": "https://accounts.google.com/o/oauth2/v2/auth?…", "state": "…" }`

`redirectTo` só aceita caminho interno; qualquer outra coisa (`//host`,
`https://host`) vira `/perfil` em silêncio. Provedor sem credenciais nesta
instalação → `501 OAUTH_PROVIDER_NOT_CONFIGURED`.

O `state` volta junto porque quem o guarda é o Next, num cookie de dez minutos.
É o que amarra o fluxo a um browser: sem essa conferência, alguém poderia iniciar
um login e induzir outra pessoa a completá-lo, deixando-a logada numa conta que
não é dela.

### `POST /auth/oauth/{provider}/callback`

```json
{ "code": "…", "state": "…" }
```
→ `{ "token": "…", "expiresIn": 43200, "user": { … }, "redirectTo": "/perfil" }`

**O callback do provedor não bate no backend.** O `redirect_uri` registrado nos
três provedores é `{origem do Next}/auth/callback/{provider}`, porque o redirect
é uma navegação de browser e nunca traria o `x-service-token` que a API exige de
toda rota. O Next confere o `state` contra o cookie, chama esta rota pelo
servidor e grava o cookie de sessão — o mesmo caminho do login por senha.

| HTTP | `code` | Quando |
|---|---|---|
| 400 | `OAUTH_STATE_INVALID` | `state` adulterado, expirado, ou de outro provedor |
| 409 | `OAUTH_EMAIL_NOT_VERIFIED` | o provedor não confirma um email verificado (email privado no GitHub, conta Microsoft sem email) |
| 502 | `OAUTH_EXCHANGE_FAILED` | o provedor recusou a troca do código ou não devolveu o perfil |

Conta com o mesmo email e senha já cadastrada é **vinculada**, não duplicada,
desde que o provedor afirme que o email é verificado. Conta criada por aqui nasce
sem senha, e `POST /auth/login` já recusa senha para ela.

### `POST /auth/logout`
→ `204`. Invalida o token.

### `PATCH /users/me`
Campos editáveis pelo diálogo "Editar perfil".

```json
{ "name": "Marina Duarte", "email": "marina.duarte@escola.edu.br", "avatarIndex": 2 }
```
→ `User` atualizado. Email já em uso → `409 EMAIL_TAKEN`.

### `GET /users/{userId}/profile`
Perfil de liderança. `userId` aceita o literal `me`, que a API resolve pela
sessão — é a mesma rota porque quem decide o que é público é o servidor, não o
front.

```json
{
  "user": { "id": "u_1", "name": "Marina Duarte", "email": "marina@escola.br", "avatarIndex": 2, "plan": "intermediate", "audience": "teacher" },
  "sets": [
    { "id": "s1", "title": "Frações & Funções Básicas", "phaseCount": 8, "source": "owned", "updatedLabel": "editado há 2 dias", "authorName": null }
  ],
  "matches": [
    {
      "id": "m_1",
      "setTitle": "Frações & Funções Básicas",
      "mode": "live",
      "playedAtLabel": "28 jul 2026 · 14:32",
      "participantCount": 24,
      "avgScore": 640,
      "maxScore": 800,
      "accuracyRate": 78,
      "durationLabel": "32 min",
      "phaseAccuracy": [92, 81, 70, 65, 88, 74, 60, 95]
    }
  ]
}
```

Três decisões que valem a pena registrar:

1. **`playedAtLabel` e `durationLabel` vêm prontos**, como `updatedLabel` em
   `/phase-sets`. O front não carrega biblioteca de datas.
2. **A linha do histórico já traz os números do relatório resumido**
   (`accuracyRate`, `durationLabel`). A lista e o diálogo "Ver relatório" leem do
   mesmo objeto — abrir o diálogo não custa uma segunda ida ao servidor.
3. **`phaseAccuracy` é o acerto médio da turma em cada fase, 0..100, na ordem em
   que foram jogadas** — alimenta o mini-gráfico de barras do card do histórico.
   `maxScore` é a maior pontuação possível da partida, para o card mostrar
   `avgScore / maxScore`.

Num perfil de outra pessoa, `email` pode vir vazio: o front só o exibe, não
decide nada com ele.

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

### `POST /rooms`
Abre uma sala nova com quem chamou como líder. Usado pelos botões "Criar sala" e
"Iniciar" (no card de um conjunto) do perfil.

```json
{ "setId": "s1" }
```

`setId` é opcional. Quando vem, o servidor já enfileira as fases daquele conjunto
na sala recém-criada — numa chamada só, para o lobby não abrir vazio e a fila
aparecer meio segundo depois.

→ `201 Room`. O front navega para `/sala/{code}/lobby`.

### `GET /rooms/active`
As salas ainda de pé das quais **quem chamou** faz parte, das mais recentes para
as mais antigas. É o que sustenta "Voltar para a sala": fechar a aba não tira
ninguém da sala, mas o único caminho de volta era digitar o código — que o líder
nunca decorou (a sala nasce com um código gerado pelo servidor) e o convidado já
esqueceu.

```json
[
  {
    "code": "482913",
    "status": "lobby",
    "matchMode": null,
    "role": "leader",
    "leaderName": "Marina Duarte",
    "setTitle": "Frações & Funções Básicas",
    "phaseCount": 8,
    "currentPhase": 3,
    "participantCount": 3,
    "createdAtLabel": "28 jul 2026 · 14:32"
  }
]
```

`currentPhase` só vem para `role: "leader"` e `status: "running"` — mesma regra de
`setTitle`/`phaseCount`. É o que o histórico do perfil mostra em "fase 3" para uma sala
ainda em andamento; `null` nos demais casos.

Decisões que esta rota carrega:

- **É rota de sessão, não de perfil.** Não aceita `userId` no caminho, e por isso
  não é um campo de `GET /users/{userId}/profile`: o código de 6 dígitos é a
  única credencial da sala, e devolvê-lo dentro de um perfil que qualquer um abre
  entregaria a chave de todas as salas abertas da pessoa.
- **Sem sessão é `200 []`**, não 401/403. Quem chama é a tela de entrar, que
  existe justamente para quem ainda não é ninguém — e o convidado que ela precisa
  atender nem tem conta para receber `ACCOUNT_REQUIRED`. Mesmo critério do
  `GET /session`.
- **`role`** é `"leader"` ou `"participant"`, derivado de `leader.id` — decide em
  qual aba do perfil a linha aparece e quais campos o front pode desenhar.
- **`setTitle` e `phaseCount` só saem para o líder** (`null` para participante). A
  fila é o roteiro da aula e `GET /rooms/{code}/queue` responde
  `403 NOT_ROOM_LEADER` a qualquer outro; um resumo dela aqui contornaria a mesma
  regra por outra rota. Para o participante o cartão se identifica pelo
  `leaderName`, que ele já lê no lobby.
- **Sala `finished` não aparece.** Retomá-la não leva a lugar nenhum (a entrada em
  sala encerrada já é recusada), e é o `matches` do perfil que a registra.
- `status` pode ser `running`: **entrar numa sala em andamento é legítimo** — o
  front manda para `/sala/{code}/partida` em vez do lobby.
- No máximo **10 salas**. Enquanto `rooms.expiresAt` não for preenchido, "sala
  ativa" é "sala que ninguém encerrou", e quem abre uma sala por aula acumularia
  a lista inteira.

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

### `DELETE /rooms/{code}` — líder
Encerra a sala inteira — o "Encerrar sala" do histórico do perfil, para quando o
líder quer fechá-la sem entrar (diferente de `POST /matches/{matchId}/finish`, que
encerra só a partida em curso e mostra o pódio a quem está dentro). Publica
`room.closed` no WebSocket, tirando todo mundo para fora, e some da lista de
`GET /rooms/active`.

→ `204`.

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

### `GET /phase-sets/library`

Alimenta a tela "Conjuntos de desafios". Devolve os conjuntos do autor e os da
comunidade na **mesma** resposta: as duas abas trocam a cada clique, e refazer a
busca a cada troca faria a grade piscar sem nenhuma informação nova ter chegado.

É rota separada de `GET /phase-sets` pelo motivo oposto: aquela abre o seletor no
meio de uma aula e não pode esperar as agregações de acerto médio e duração que
só o card da biblioteca lê.

```json
{
  "sets": [
    {
      "id": "s1",
      "title": "Frações & Funções Básicas",
      "phaseCount": 8,
      "source": "owned",
      "updatedLabel": "editado há 2 dias",
      "authorName": null,
      "phaseKindCounts": { "quiz": 5, "fill": 3 },
      "accuracyRate": 78,
      "durationLabel": "32 min",
      "subject": "Matemática",
      "folder": "Matemática 2º ano",
      "useCount": 12,
      "coverUrl": null
    },
    {
      "id": "p1",
      "title": "Big-O sem sofrimento",
      "phaseCount": 10,
      "source": "community",
      "updatedLabel": "1.840 usos",
      "authorName": "Comunidade Codex",
      "phaseKindCounts": { "code": 6, "quiz": 4 },
      "accuracyRate": 64,
      "durationLabel": "45 min",
      "subject": "Programação",
      "folder": null,
      "useCount": 1840,
      "coverUrl": null
    }
  ],
  "subjects": ["Matemática", "Programação", "Estatística"],
  "folders": ["Matemática 2º ano", "Programação", "Provas"],
  "coverUrl": null
}
```

`sets` já vem ordenada por recência — é essa ordem que a aba "Recentes" usa e é o
primeiro conjunto `owned` que vira o destaque do topo. `updatedLabel` vem pronto
(relativo e localizado) pelo mesmo motivo de `GET /phase-sets`.

`subjects` e `folders` são as listas dos filtros e não saem de `sets`: uma pasta
recém-esvaziada tem que continuar clicável, senão o filtro some justamente quando
a pessoa quer voltar para ela. `folder` é sempre `null` em `source: "community"`.

`accuracyRate` é `null` enquanto nenhuma partida usou o conjunto — a tela escreve
"sem partidas" em vez de `0%`. Busca, tipo, disciplina, pasta e ordenação são
aplicados no cliente sobre esta resposta.

### `GET /phase-sets/{setId}/draft` — autor

Conjunto na forma que o **editor** manipula, que é diferente da que a partida
consome:

| | Partida (`Phase`) | Editor (`DraftPhase`) |
|---|---|---|
| Quiz | `options: {id,label}[]` + `correctOptionId` escondido | `options: string[]` + `correctIndexes: number[]` |
| Completar frase | `segments[]` já quebrados + `correctWords` escondido | `question` com `___` + `blanks: (string\|null)[]` |
| Código | `statement`, `examples`, `languages[]` | `question`, `starterCode`, `testCases` |
| Dissertativa | `expectedAnswer` só para o líder | `expectedAnswer` sempre |

São rotas separadas porque só o autor pode ver gabarito, casos de teste e
resposta esperada — e porque o editor não deveria ter que desmontar e remontar a
fase a cada tecla digitada.

```json
{
  "id": "s1",
  "title": "Frações & Funções Básicas",
  "phases": [
    {
      "id": "ph_1",
      "kind": "quiz",
      "name": "Frações equivalentes",
      "basePoints": 100,
      "pointsMultiplier": 1,
      "timeSeconds": 45,
      "fromAI": false,
      "question": "Qual fração abaixo é equivalente a 2/3?",
      "options": ["4/6", "3/4", "5/9", "6/8"],
      "correctIndexes": [0]
    },
    {
      "id": "ph_2",
      "kind": "fill",
      "name": "Proporção entre partes",
      "basePoints": 100,
      "pointsMultiplier": 1,
      "timeSeconds": 40,
      "fromAI": false,
      "question": "Ao ___ os termos, a ___ se mantém.",
      "words": ["multiplicar", "somar", "proporção", "quantidade"],
      "blanks": ["multiplicar", "proporção"]
    }
  ]
}
```

`blanks` é posicional: uma entrada por lacuna de `question`, na ordem, com `null`
onde o autor ainda não escolheu a palavra. `words` é o banco inteiro oferecido ao
aluno — inclui as distratoras, que por definição não aparecem em `blanks`.

### `POST /phase-sets` / `PUT /phase-sets/{setId}/draft` — autor

Mesmo corpo (`{ title, phases }`), e ambos devolvem o rascunho salvo. O editor
grava o conjunto **inteiro** de uma vez, não fase por fase: a ordem das fases é a
ordem do array, então não existe campo de posição para sair de sincronia com o
que o autor vê no rail.

Ids de fase começando com `draft_` são locais — o servidor os substitui pelos
definitivos e devolve o rascunho já reidentificado.

Validações que o servidor precisa repetir (a UI já impede, mas isso não é
garantia): `correctIndexes` nunca vazio e nunca com todas as alternativas;
`options` entre 2 e 6; `blanks.length` igual ao número de lacunas de `question`.

### `PATCH /phase-sets/{setId}` — autor
`{ "title": "…" }` → `PhaseSetSummary`. Só renomeia; o conteúdo vai pelo `PUT`.

### `DELETE /phase-sets/{setId}` — autor
→ `204`. Não afeta partidas passadas: a fila copia a fase em vez de referenciá-la.

### `POST /phase-sets/phases/generate` — autor

```json
{ "kind": "quiz", "topic": "frações equivalentes para o 7º ano", "difficulty": "medium", "notes": "" }
```

→ uma `DraftPhase` com `fromAI: true`. **A fase não é persistida**: ela entra no
rascunho local e só vai para o banco quando o autor salva o conjunto. Sair da
tela sem salvar não pode deixar lixo gerado no banco.

`difficulty` é `"easy" | "medium" | "hard"`.

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

> **Nota da implementação atual:** o backend .NET não usa Firestore — traduziu
> este modelo para PostgreSQL/EF Core. Ver `contracts2/api-implementation-status.md`
> § "Modelo de dados" para a tabela de tradução doc → relacional.

### Índices necessários

| Coleção | Campos |
|---|---|
| `rooms` | `code` (asc) — busca por código |
| `rooms/{id}/participants` | `status` (asc), `joinedAt` (asc) |
| `phaseSets` | `ownerId` (asc), `updatedAt` (desc) — aba "Meus conjuntos" |
| `phaseSets` | `visibility` (asc), `title` (asc) — aba "Comunidade" + busca |
| `matches/{id}/phases/{id}/submissions` | `score` (desc) — histograma e pódio |
| `matches` | `leaderId` (asc), `finishedAt` (desc) — histórico do perfil |

### TTL

Salas e participantes convidados expiram. Configure TTL em `rooms.expiresAt`
(sugestão: 24 h após `finishedAt`) para o banco não acumular sala de aula antiga.

---

## 14. Mapa tela → rotas

| Tela | Rotas |
|---|---|
| Landing | nenhuma (conteúdo local) |
| Auth | `POST /auth/login`, `POST /auth/signup`, `POST /auth/oauth/{provider}/authorize`, `POST /auth/oauth/{provider}/callback` |
| Entrar em Sala | `GET /session`, `GET /rooms/active`, `GET /rooms/{code}/availability`, `POST /rooms/{code}/participants` |
| Lobby (jogador) | `GET /session`, `GET /rooms/{code}`, `GET /rooms/{code}/participants?status=approved` |
| Lobby (líder) | as acima + `?status=pending`, `GET /rooms/{code}/queue`, `GET /phase-sets`, todas as de `/queue/*`, `PATCH /rooms/{code}`, aprovar/recusar/remover, `POST /rooms/{code}/match` |
| Desafios (aluno) | `GET /rooms/{code}/match`, `GET /matches/{id}/current-phase`, `GET /matches/{id}/scoreboard/me`, `POST …/submissions`, `POST …/run`, `POST …/ready`, `GET …/comparison`, `GET /matches/{id}/podium` |
| Desafios (líder) | `GET /matches/{id}/current-phase`, `GET …/stats`, `advance`, `pause`, `restart`, `finish`, `return-to-lobby`, `DELETE …/participants/{id}` |
| Perfil | `GET /users/{id}/profile`, `GET /rooms/active` (só o próprio), `PATCH /users/me`, `POST /rooms`, `DELETE /rooms/{code}` (encerrar sala), `POST /matches/{id}/report/export`, `POST /auth/logout` |
| Conjuntos de desafios | `GET /session`, `GET /phase-sets/library`, `POST /rooms`, `DELETE /phase-sets/{id}`, `POST /auth/logout` |
| Editor de Conjunto | `GET /phase-sets/{id}/draft`, `POST /phase-sets`, `PUT /phase-sets/{id}/draft`, `POST /phase-sets/phases/generate` |
