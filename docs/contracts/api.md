# Contrato de API REST — Codex

Este documento define o contrato completo e autossuficiente da API REST do Codex (.NET 10 Minimal APIs). Define rotas, modelos de domínio, autenticação, formatos de entrada/saída, tratamento de erros e regras de negócio.

---

## 1. Convenções Globais

### 1.1 Comunicação e Portas
* **Host Padrão:** `http://localhost:5282` (HTTP) ou `https://localhost:7091` (HTTPS) em desenvolvimento; `:8080` interno em container.
* **Cliente:** Chamado pelo servidor Next.js (Server Components e Server Actions) e por serviços internos autorizados. O navegador cliente nunca faz requisições REST diretas à API.

### 1.2 Cabeçalhos de Segurança e Identificação
| Cabeçalho | Formato | Descrição |
|---|---|---|
| `x-service-token` | String | Token compartilhado entre serviços. Validação estrita (*fail-closed*): ausência resulta em `500 SERVICE_TOKEN_NOT_CONFIGURED`, token incorreto em `401 INVALID_SERVICE_TOKEN`. Rota `/health` é a única isenta. |
| `Authorization` | `Bearer <token>` | Token de sessão opaco gerado via ASP.NET Data Protection. Abrange tanto usuários logados quanto participantes convidados. |

### 1.3 Sessão Dual
O token de sessão decodifica para duas identidades coexistentes:
* **Usuário Autenticado:** Possui `userId`, criado via cadastro, login ou OAuth.
* **Participante Convidado:** Possui `participantId` e `roomCode`, criado ao entrar em uma sala sem conta cadastrada.
* **Usuário em Sala:** Quando um usuário autenticado entra em uma sala, o token armazena `userId`, `participantId` e `roomCode` simultaneamente.

### 1.4 Serialização JSON
* Propriedades em `camelCase`.
* Datas em formato ISO 8601 UTC terminadas em `Z` (ex: `2026-09-25T20:30:00Z`).
* Enums serializados como string. Exceção de nomenclatura: `MatchMode` usa kebab-case (`live`, `self-paced`).
* Valores nulos omitidos quando indicado (`WhenWritingNull`).

### 1.5 Padrão de Erro
Todas as respostas de erro seguem o formato padronizado com código estável:
```json
{
  "code": "ROOM_LOCKED",
  "message": "O apresentador travou a entrada."
}
```

#### Tabela de Códigos de Erro
| HTTP | Código | Descrição / Contexto |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Carga de requisição inválida, campos ausentes ou fora das regras |
| 400 | `OAUTH_STATE_INVALID` | Estado OAuth expirado, adulterado ou de outro provedor |
| 401 | `INVALID_CREDENTIALS` | E-mail ou senha incorretos |
| 401 | `INVALID_SERVICE_TOKEN` | Cabeçalho `x-service-token` inválido |
| 403 | `ACCOUNT_REQUIRED` | Ação restrita a contas cadastradas (sala exige conta ou criação de sala) |
| 403 | `NOT_ROOM_LEADER` | Rota de gestão da sala chamada por quem não é o líder |
| 404 | `ROOM_NOT_FOUND` | Código de sala inexistente, expirado ou inválido |
| 404 | `USER_NOT_FOUND` | Perfil de usuário não localizado |
| 404 | `PHASE_SET_NOT_FOUND` | Conjunto de fases inexistente ou pertencente a outro autor |
| 404 | `MATCH_NOT_FOUND` | Partida não localizada ou chamada indevida por participante |
| 404 | `PARTICIPANT_NOT_FOUND`| Participante não encontrado na sala |
| 409 | `EMAIL_ALREADY_USED` / `EMAIL_TAKEN` | E-mail já utilizado por outra conta |
| 409 | `USERNAME_TAKEN` | Apelido já em uso por outro participante aprovado/pendente na sala |
| 409 | `ROOM_FULL` | Capacidade máxima da sala atingida |
| 409 | `ROOM_LOCKED` | Sala bloqueada para novas entradas |
| 409 | `MATCH_ALREADY_STARTED` | Ação incompatível com partida em andamento (ex: alterar fila) |
| 409 | `TOO_MANY_SETS` | Fila da sala atingiu o limite de 8 conjuntos |
| 409 | `QUEUE_MISMATCH` | IDs divergentes na reordenação da fila |
| 409 | `EMPTY_QUEUE` | Tentativa de iniciar partida sem fases na fila |
| 409 | `NO_PLAYERS` | Tentativa de iniciar partida sem participantes aprovados |
| 409 | `INCOMPLETE_PHASE` | Fase na fila com dados incompletos ou sem gabarito |
| 409 | `MODE_NOT_AVAILABLE` | Modo de partida não suportado (ex: `self-paced`) |
| 409 | `PHASE_ALREADY_SUBMITTED` | Participante já enviou resposta para a fase atual |
| 409 | `PHASE_CLOSED` | Resposta enviada após encerramento do tempo da fase |
| 409 | `PHASE_STILL_OPEN` | Comparação solicitada antes do encerramento da fase |
| 409 | `INVALID_DIRECTION` | Direção inválida de avanço (ex: voltar fase no modo live) |
| 409 | `OAUTH_EMAIL_NOT_VERIFIED` | Provedor OAuth não forneceu e-mail verificado |
| 429 | `RATE_LIMITED` | Limite de requisições excedido |
| 500 | `SERVICE_TOKEN_NOT_CONFIGURED` | API sem token de serviço configurado |
| 501 | `OAUTH_PROVIDER_NOT_CONFIGURED`| Credenciais do provedor OAuth não configuradas |
| 502 | `OAUTH_EXCHANGE_FAILED` | Falha de comunicação com o provedor OAuth externo |

---

## 2. Tipos de Desafio e Projeções de Conteúdo

O sistema trabalha com 4 tipos (`kind`) de desafios gamificados. Cada um possui duas formas: **Autoria (`DraftPhase`)**, com gabaritos completos para edição pelo autor, e **Partida (`Phase`)**, projetada para os jogadores.

### 2.1 Quiz (`quiz`)
* **Autoria (`DraftPhase`):**
  * `question`: string.
  * `options`: string[] (mínimo 2, máximo 6).
  * `correctIndexes`: number[] (índices 0-based; não vazio; nunca todas as alternativas).
* **Partida (`Phase`):**
  * `question`: string.
  * `options`: `[{ "id": "o1", "label": "Texto" }, { "id": "o2", "label": "Texto" }]`.
  * `correctOptionId`: string ou null (omitido enquanto a fase estiver aberta).
* **Resposta do Aluno:**
  * `{ "kind": "quiz", "optionId": "o1" }`.

### 2.2 Completar Frase (`fill`)
* **Autoria (`DraftPhase`):**
  * `question`: string contendo marcadores de lacuna no padrão `___` ou `PALAVRA`.
  * `words`: string[] (banco de palavras, incluindo distratores).
  * `blanks`: (string | null)[] (palavras corretas posicionais para cada lacuna; tamanho idêntico à contagem de lacunas).
* **Partida (`Phase`):**
  * `segments`: `[{ "type": "text", "value": "Texto " }, { "type": "blank", "index": 0 }]`.
  * `words`: string[] (banco completo de alternativas).
* **Resposta do Aluno:**
  * `{ "kind": "fill", "blanks": ["palavra1", "palavra2"] }`.

### 2.3 Resposta Dissertativa (`text`)
* **Autoria (`DraftPhase`):**
  * `question`: string.
  * `expectedAnswer`: string (gabarito de referência para correção).
* **Partida (`Phase`):**
  * `question`: string.
  * `placeholder`: string opcional.
* **Resposta do Aluno:**
  * `{ "kind": "text", "value": "Texto digitado" }`.

### 2.4 Desafio de Código (`code`)
* **Autoria (`DraftPhase`):**
  * `question`: string (enunciado).
  * `starterCode`: string (esqueleto inicial de código).
  * `testCases`: string (casos no formato `"Entrada: 10\nSaída: 0"`).
* **Partida (`Phase`):**
  * `statement`: string (enunciado com suporte a código inline em crases).
  * `examples`: `[{ "input": "...", "output": "..." }]` (derivados dos primeiros casos).
  * `fileName`: string (ex: `solucao.js`).
  * `languages`: `[{ "id": "js", "label": "JavaScript", "enabled": true, "starterCode": "..." }]`.
* **Resposta do Aluno:**
  * `{ "kind": "code", "languageId": "js", "source": "function..." }`.

---

## 3. Especificação de Rotas

### 3.1 Autenticação e Sessão

#### `GET /session`
Retorna os dados da sessão corrente a partir do cookie/token.
* **Autenticação:** Opcional (não falha se anônimo).
* **Resposta `200`:**
```json
{
  "user": {
    "id": "01a069ee-9029-76e7-b874-9508fa1a2f13",
    "name": "Professora Marina",
    "email": "marina@codex.app",
    "avatarIndex": 1,
    "plan": "free",
    "audience": "teacher"
  },
  "participantId": null,
  "roomCode": null
}
```
*Caso anônimo:* `user`, `participantId` e `roomCode` retornam `null`.

#### `POST /auth/signup`
Cria nova conta com e-mail e senha.
* **Corpo:**
```json
{
  "name": "Marina Duarte",
  "email": "marina@codex.app",
  "password": "senhaForte123!"
}
```
* **Resposta `200`:** `{ "token": "...", "expiresIn": 43200, "user": { ... } }`
* **Erros:** `409 EMAIL_ALREADY_USED`, `400 VALIDATION_ERROR`.

#### `POST /auth/login`
Autentica usuário com e-mail e senha.
* **Corpo:**
```json
{
  "email": "marina@codex.app",
  "password": "senhaForte123!",
  "rememberMe": true
}
```
* **Resposta `200`:** `{ "token": "...", "expiresIn": 2592000, "user": { ... } }`
* `expiresIn`: 30 dias (2592000s) com `rememberMe: true`; 12 horas (43200s) com `false`.
* **Erros:** `401 INVALID_CREDENTIALS`.

#### `POST /auth/oauth/{provider}/authorize`
Gera URL de autorização para provedor externo (`google`, `microsoft`, `github`).
* **Corpo:** `{ "redirectTo": "/perfil" }`
* **Resposta `200`:** `{ "authorizeUrl": "https://...", "state": "..." }`
* **Erros:** `501 OAUTH_PROVIDER_NOT_CONFIGURED`.

#### `POST /auth/oauth/{provider}/callback`
Conclui o fluxo OAuth via servidor.
* **Corpo:** `{ "code": "...", "state": "..." }`
* **Resposta `200`:** `{ "token": "...", "expiresIn": 43200, "user": { ... }, "redirectTo": "/perfil" }`
* **Erros:** `400 OAUTH_STATE_INVALID`, `409 OAUTH_EMAIL_NOT_VERIFIED`, `502 OAUTH_EXCHANGE_FAILED`.

#### `POST /auth/logout`
Encerra a sessão no cliente.
* **Resposta:** `204 No Content`.

#### `PATCH /users/me`
Atualiza dados cadastrais do usuário autenticado.
* **Corpo:**
```json
{
  "name": "Marina D.",
  "email": "novo@codex.app",
  "avatarIndex": 3
}
```
* **Resposta `200`:** Objeto `User` atualizado.
* **Erros:** `401`, `409 EMAIL_TAKEN`, `400 VALIDATION_ERROR`.

#### `GET /users/{userId}/profile`
Obtém perfil público ou próprio (`userId = "me"`).
* **Resposta `200`:**
```json
{
  "user": { "id": "...", "name": "Marina", "email": "...", "avatarIndex": 1, "plan": "free", "audience": "teacher" },
  "sets": [
    { "id": "...", "title": "Frações", "phaseCount": 8, "source": "owned", "updatedLabel": "editado há 2 dias", "authorName": null }
  ],
  "matches": [
    {
      "id": "...",
      "setTitle": "Frações",
      "mode": "live",
      "playedAtLabel": "25 set 2026 · 14:00",
      "participantCount": 20,
      "avgScore": 140,
      "maxScore": 200,
      "accuracyRate": 70,
      "durationLabel": "15 min",
      "phaseAccuracy": [80, 60, 70]
    }
  ]
}
```

---

### 3.2 Entrada em Sala e Participação

#### `GET /rooms/{code}/availability`
Verifica se o código de 6 dígitos é válido e pode aceitar novos participantes.
* **Resposta `200`:** `{ "code": "969180", "capacity": 20, "requireAccount": false }`
* **Erros:** `404 ROOM_NOT_FOUND`, `423 ROOM_LOCKED`, `403 ACCOUNT_REQUIRED`, `409 ROOM_FULL`.

#### `POST /rooms/{code}/participants`
Cadastra entrada de participante na sala (anônimo ou logado).
* **Corpo:** `{ "displayName": "Carlos", "avatarIndex": 2 }`
* **Resposta `201`:**
```json
{
  "participant": {
    "id": "01a06cc4-a5bc-74a1-8a5d-3a443f5f3e59",
    "roomId": "01a06cc4-7b7f-7025-ba5d-98a2c92dfbb6",
    "displayName": "Carlos",
    "avatarIndex": 2,
    "loggedIn": false,
    "userId": null,
    "status": "pending",
    "joinedAt": "2026-09-25T20:00:00Z"
  },
  "token": "...",
  "expiresIn": 14400
}
```
* **Erros:** Mesmos de `availability` + `409 USERNAME_TAKEN`.

#### `POST /rooms/{code}/participants/me/return`
Chamado pelo participante ao clicar em "Continuar jogando" na tela de pódio para sair dos resultados e retornar ao lobby.
* **Resposta:** `204 No Content`.

---

### 3.3 Gestão de Salas e Lobby

#### `POST /rooms`
Cria uma nova sala. Requer usuário logado como líder.
* **Corpo:** `{ "setId": "01a069f5-8351-7c3f-aa88-50364832e5c1" }` (`setId` opcional).
* **Resposta `201`:** Objeto `Room` com código de 6 dígitos gerado.
* **Erros:** `403 ACCOUNT_REQUIRED`.

#### `GET /rooms/active`
Lista até 10 salas ativas associadas à sessão corrente (como líder ou participante).
* **Resposta `200`:**
```json
[
  {
    "code": "969180",
    "status": "lobby",
    "matchMode": null,
    "role": "leader",
    "leaderName": "Marina",
    "setTitle": "Frações",
    "phaseCount": 5,
    "currentPhase": null,
    "participantCount": 4,
    "createdAtLabel": "há 10 min"
  }
]
```

#### `GET /rooms/{code}`
Dados detalhados da sala.
* **Resposta `200`:** `{ "id": "...", "code": "969180", "status": "lobby", "capacity": 20, "locked": false, "requireAccount": false, "leader": { "id": "...", "name": "..." }, "createdAt": "..." }`

#### `GET /rooms/{code}/participants?status=approved|pending`
Lista participantes da sala. Filtro `pending` restrito ao líder.
* **Resposta `200`:** Array de `Participant`.
* **Erros:** `403 NOT_ROOM_LEADER` se participante não líder requisitar `pending`.

#### `PATCH /rooms/{code}`
Atualiza configurações da sala (apenas líder).
* **Corpo:** `{ "locked": true, "requireAccount": false, "capacity": 30 }`
* **Resposta `200`:** Objeto `Room` atualizado.

#### `DELETE /rooms/{code}`
Encerra a sala e desconecta os participantes (apenas líder).
* **Resposta:** `204 No Content`.

#### Gestão de Participantes pelo Líder
* `POST /rooms/{code}/participants/{id}/approve` -> `204 No Content`.
* `POST /rooms/{code}/participants/{id}/reject` -> `204 No Content` (libera o apelido de volta à sala).
* `DELETE /rooms/{code}/participants/{id}` -> `204 No Content` (remove da sala).

---

### 3.4 Conjuntos de Fases e Autoria

#### `GET /phase-sets?scope=owned|community&q={termo}`
Busca conjuntos para o seletor. Retorna resumos com contagem de fases e títulos.

#### `GET /phase-sets/library`
Retorna conjuntos próprios e da comunidade com métricas agrupadas, tags e disciplinas para a tela de biblioteca.

#### `GET /phase-sets/{setId}/draft`
Retorna o conjunto na íntegra no formato do editor (com gabaritos e alternativas completas). Restrito ao autor.

#### `POST /phase-sets` e `PUT /phase-sets/{setId}/draft`
Criação e substituição completa do rascunho de um conjunto.
* **Corpo:**
```json
{
  "title": "Conjunto de Matemática",
  "phases": [
    {
      "id": "draft_1",
      "kind": "quiz",
      "name": "Soma Básica",
      "basePoints": 100,
      "pointsMultiplier": 1.0,
      "timeSeconds": 30,
      "fromAI": false,
      "question": "Quanto é 2 + 2?",
      "options": ["4", "3", "5"],
      "correctIndexes": [0]
    }
  ]
}
```
* **Validações:** Título até 160 caracteres, máximo 50 fases por conjunto. Limites de texto: enunciado até 4000 caracteres, código base até 8000 caracteres.

#### `PATCH /phase-sets/{setId}`
Renomeia título do conjunto: `{ "title": "Novo Título" }`.

#### `DELETE /phase-sets/{setId}`
Exclui conjunto e suas fases associadas em cascata.

---

### 3.5 Fila de Fases da Sala

A fila é uma cópia congelada das fases autoradas, executada durante a partida. Toda mutação devolve a fila completa recalculada: `{ "sets": [...], "phases": [...] }`.

* `GET /rooms/{code}/queue`: Consulta a fila completa (apenas líder).
* `POST /rooms/{code}/queue/sets`: Adiciona conjunto à fila (`{ "setId": "..." }`). Máximo de 8 conjuntos por sala (`409 TOO_MANY_SETS`).
* `DELETE /rooms/{code}/queue/sets/{setId}`: Remove conjunto e suas respectivas fases da fila.
* `PATCH /rooms/{code}/queue/sets/{setId}`: Altera em lote `{ "basePoints", "pointsMultiplier", "timeSeconds" }` para todas as fases do conjunto.
* `PATCH /rooms/{code}/queue/phases/{phaseId}`: Altera valores de uma fase específica da fila.
* `DELETE /rooms/{code}/queue/phases/{phaseId}`: Remove uma fase individual da fila.
* `PUT /rooms/{code}/queue/order`: Reordenação de fases via arrastar-e-soltar (`{ "phaseIds": [...] }`). Requer envio exato dos IDs atuais (`409 QUEUE_MISMATCH`).
* `GET /rooms/{code}/queue/phases/{phaseId}`: Detalhe com gabarito para modal do líder.

---

### 3.6 Execução da Partida

#### `POST /rooms/{code}/match`
Inicia uma partida na sala (apenas líder).
* **Corpo:** `{ "mode": "live" }` (`mode: "self-paced"` responde `409 MODE_NOT_AVAILABLE`).
* **Validações:** Fila não vazia (`409 EMPTY_QUEUE`), ao menos um aluno aprovado (`409 NO_PLAYERS`), fases com gabarito válido (`409 INCOMPLETE_PHASE`).
* **Resposta `201`:** Objeto `Match` em estado `running`.

#### `GET /matches/{id}/current-phase`
Retorna a fase atual em execução.
* **Regra de Ouro:** Para alunos com fase em andamento, `correctOptionId`, `correctWords` e `expectedAnswer` são sempre omitidos (`null`).
* **Resposta `200`:**
```json
{
  "phase": {
    "id": "01a06cc4-7b82-7cfb-b7b8-a7520c076f7b",
    "setId": "01a06a04-380f-737c-b7c7-9f5363bed6ef",
    "kind": "quiz",
    "name": "Pergunta fácil",
    "basePoints": 50,
    "pointsMultiplier": 1.0,
    "timeSeconds": 15,
    "question": "Quanto é 1 + 2?",
    "options": [{ "id": "o1", "label": "3" }, { "id": "o2", "label": "2" }]
  },
  "phaseNumber": 1,
  "totalPhases": 4,
  "secondsLeft": 12,
  "paused": false,
  "submittedCount": 3,
  "totalPlayers": 4,
  "mySubmission": null
}
```

#### `POST /matches/{matchId}/phases/{phaseId}/submissions`
Envio de resposta do participante.
* **Corpo:** `{ "answer": { "kind": "quiz", "optionId": "o1" } }`
* **Resposta `201`:**
```json
{
  "id": "sub_1",
  "phaseId": "...",
  "participantId": "...",
  "answer": { "kind": "quiz", "optionId": "o1" },
  "submittedAt": "2026-09-25T20:15:00Z",
  "elapsedSeconds": 4,
  "grading": "graded",
  "correct": true,
  "score": 45,
  "explanation": null
}
```
* **Correção:** `quiz` e `fill` retornam corrigidos imediatamente (`graded`). `text` e `code` retornam `pending` com `score: null`.
* **Erros:** `409 PHASE_ALREADY_SUBMITTED`, `409 PHASE_CLOSED`.

#### `POST /matches/{matchId}/phases/{phaseId}/ready`
Marca o participante como pronto para avançar para a próxima fase. Responde `204 No Content`.

#### `GET /matches/{matchId}/phases/{phaseId}/comparison`
Retorna dados de desempenho relativo da turma após o fechamento da fase.
* **Resposta `200`:**
```json
{
  "myScore": 45,
  "phaseScore": 45,
  "percentile": 85,
  "histogram": [
    { "score": 0, "isMe": false },
    { "score": 45, "isMe": true }
  ],
  "correctAnswerLabel": "3",
  "correct": true
}
```
* **Erros:** `409 PHASE_STILL_OPEN` (se requisitado antes da fase encerrar).

#### `GET /matches/{matchId}/podium`
Retorna o pódio final da partida com até 3 participantes ordenados por pontuação decrescente.
* **Critério de Desempate:** Maior pontuação total, menor tempo acumulado de resposta (`elapsedSeconds`), menor data de entrada (`joinedAt`).

#### `GET /matches/{matchId}/phases/{phaseId}/stats`
Estatísticas da fase para o painel do líder.
* **Resposta `200`:** Contagens agregadas (`submittedCount`, `accuracyRate`, `avgResponseSeconds`, `teamAvgScore`), distribuição de respostas por alternativa (`answerDistribution`), status de correção e lista de alunos.

#### Controles da Partida (Exclusivos do Líder)
| Rota | Efeito |
|---|---|
| `POST /matches/{id}/advance` | Avança para a próxima fase (`{ "direction": "next" }`). Responde `409 INVALID_DIRECTION` se após a última fase. |
| `POST /matches/{id}/pause` | Pausa ou retoma o cronômetro da fase atual (`{ "paused": true\|false }`). |
| `POST /matches/{id}/phases/{phaseId}/restart` | Reinicia a fase corrente, limpando suas submissões e restaurando o tempo original. |
| `POST /matches/{id}/finish` | Encerra a partida e calcula o pódio. Registra `ExpiresAt = FinishedAt + 24h` na sala. Retorna o pódio. |
| `POST /matches/{id}/return-to-lobby` | Devolve a sala ao estado `lobby`, destravando a fila para novas partidas. |
| `DELETE /matches/{id}/participants/{id}` | Expulsa o participante da partida e limpa seus registros. |

---

## 4. Regras de Cálculo e Negócio

### 4.1 Fórmula de Pontuação
O cálculo de pontos é determinístico e calculado integralmente no servidor:
$$\text{score} = \text{round}(\text{basePoints} \times \text{pointsMultiplier} \times \text{acerto} \times \text{bônusTempo})$$

* $\text{acerto}$: $1.0$ para resposta correta, $0.0$ para incorreta.
* $\text{bônusTempo}$:
$$\text{bônusTempo} = 0.5 + 0.5 \times \left(\frac{\text{segundosRestantes}}{\text{tempoTotalFase}}\right)$$
* $\text{segundosRestantes} = \text{endsAt} - \text{submittedAt}$. Pausas efetuadas pelo líder não penalizam o bônus de tempo dos participantes.
* Arredondamento: `MidpointRounding.AwayFromZero` em precisão decimal.

### 4.2 Encerramento Preguiçoso e Automático
1. **Fechamento de Fase por Tempo:** Não requer timers no servidor. O primeiro cliente cujo cronômetro zera dispara a verificação preguiçosa (`CurrentPhaseEndedAt`), publicando o encerramento da fase de forma idempotente.
2. **Fechamento por Submissões:** Ao atingir o envio de todos os participantes aprovados, a fase fecha imediatamente.
3. **Fim da Partida:** O fechamento da última fase da fila encerra a partida automaticamente, gerando o pódio.

---

## 5. Endpoints Internos e de Integração

Acessíveis exclusivamente por outros serviços (como o serviço de Realtime) com cabeçalho `x-service-token`:

* `POST /internal/realtime/resolve`: Recebe `{ "token": "..." }` ou `{ "ticket": "..." }`. Decifra o token Data Protection e devolve `{ "userId", "participantId", "isLeader", "participantStatus", "displayName", "avatarIndex", "roomCode" }`.
* `POST /realtime-ticket`: Emite token de uso único de 32 bytes randômicos com TTL de 30 segundos para handshake WebSocket.
* `POST /internal/phases/grade`: Submete resposta para cálculo de nota síncrono.
* `POST /internal/matches`: Commit consolidado de partida finalizada (gravação em documento). Idempotente.
