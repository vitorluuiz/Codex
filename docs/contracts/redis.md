# Contrato de Estado Efêmero em Memória e Pub/Sub (Redis) — Codex

Este documento define o contrato de dados, mapa de chaves, scripts atômicos em Lua e barramento de eventos do Redis (v6+) no Codex. O Redis gerencia o **Estado Vivo das Salas e Filas**, **Execução em Tempo Real da Partida**, **Broker de Mensagens Pub/Sub** e **Tickets de Conexão**.

---

## 1. Configuração e Políticas Operacionais

* **Isolamento de Base:** O estado de execução e o barramento Pub/Sub operam com isolamento de namespace.
* **Política de Memória Obrigatória:** `maxmemory-policy noeviction`. A sala em andamento atua como fonte da verdade de alta frequência; o descarte por LRU (`allkeys-lru`) sob pressão de memória corromperia partidas em andamento.
* **Persistência em Disco:** `appendonly yes` (AOF) habilitado para evitar perda de estado em reinicializações acidentais de container.
* **Ciclo de Vida com TTL:** Chaves possuem TTLs explícitos gerenciados pela aplicação em cada transição de estado.

---

## 2. Mapa Completo de Chaves

| Padrão da Chave | Tipo Redis | Conteúdo / Formato | TTL Padrão |
|---|---|---|---|
| `code:{code}` | STRING | `roomId`. Reserva de código de 6 dígitos criada via `SET NX EX`. | 24 horas (renovável) |
| `room:{roomId}` | HASH | Metadados da sala: `code, status, matchMode, capacity, locked, requireAccount, leaderUserId, createdAt, expiresAt, queueRevision`. | 24 horas (renovável) |
| `room:{roomId}:names` | SET | Conjunto de apelidos normalizados `lower(displayName)` de participantes não rejeitados. | Igual ao da sala |
| `room:{roomId}:parts` | HASH | Mapeamento `participantId` → JSON com dados do participante (`id`, `displayName`, `avatarIndex`, `status`, `joinedAt`, `userId`, `loggedIn`, `inResultsSince`). | Igual ao da sala |
| `room:{roomId}:parts:idx` | ZSET | Índice ordenado de entrada. Score = timestamp `joinedAt` em milissegundos; Membro = `participantId`. | Igual ao da sala |
| `room:{roomId}:queue:sets` | ZSET | Fila de conjuntos. Score = `orderIndex`; Membro = `queueSetId`. | Igual ao da sala |
| `room:{roomId}:qset:{id}` | HASH | Dados do conjunto na fila: `sourcePhaseSetId, title, color, orderIndex`. | Igual ao da sala |
| `room:{roomId}:queue:phases` | ZSET | Fila de fases. Score = `orderIndex`; Membro = `queuePhaseId`. | Igual ao da sala |
| `room:{roomId}:qphase:{id}` | HASH | Definição da fase: `queueSetId, sourcePhaseId, kind, name, basePoints, pointsMultiplier, timeSeconds, orderIndex, contentJson, openJson, closedJson`. | Igual ao da sala |
| `match:{matchId}` | HASH | Estado de execução da partida: `roomId, mode, status, currentPhaseIndex, startedAt, currentPhaseStartedAt, currentPhaseEndsAt, currentPhaseEndedAt, pausedSecondsLeft`. | Partida ativa + 24h |
| `match:{matchId}:subs` | HASH | Submissões da partida: `{queuePhaseId}:{participantId}` → JSON da resposta do aluno. | Igual ao da partida |
| `match:{matchId}:agg:{queuePhaseId}` | HASH | Contadores de progresso da fase: `submitted, graded, correct, scoreSum`. | Igual ao da partida |
| `user:{userId}:led` | SET | IDs das salas lideradas pelo usuário (`roomId`). Sustenta `GET /rooms/active`. | Persistente / TTL da sala |
| `user:{userId}:joined` | SET | IDs das salas em que o usuário entrou como participante. | Persistente / TTL da sala |
| `commit:pending` | SET | IDs de partidas finalizadas aguardando confirmação no MongoDB. | Permanente até commit |
| `codex:rt:ticket:{ticket}` | STRING | Token de sessão do usuário. Consumido com `GETDEL`. | 30 segundos fixos |

---

## 3. Barramento Pub/Sub (Broker de Eventos)

* **Canal Redis por Sala:** `codex:rt:room:{code}`
* As instâncias de WebSocket assinam o canal no Redis quando recebem a primeira conexão da sala e desassinam quando o último participante local se desconecta.
* **Envelope de Evento:**
```json
{
  "channel": "room:969180:match",
  "event": {
    "type": "phase.progress",
    "phaseId": "01a06cc4-7b82-7cfb-b7b8-a7520c076f7b",
    "submittedCount": 12,
    "totalPlayers": 20,
    "readyCount": 4
  },
  "publishedAt": 1785000000000
}
```
* **Garantia de Entrega:** O Pub/Sub opera em modo *fire-and-forget*. Falhas de publicação não abortam a transação de escrita da API REST.

---

## 4. Scripts Atômicos Obrigatórios (Lua)

Operações concorrentes com múltiplas chaves e dependências lógicas devem ser executadas através de scripts Lua para garantir atomicidade sem condições de corrida.

### 4.1 `room_claim_code`
Gera a reserva do código da sala e inicializa a estrutura da sala.
* **Ação:** Executa `SET code:{code} {roomId} NX EX {ttl}`. Se o código estiver livre, cria a hash `room:{roomId}` e adiciona a sala em `user:{leaderUserId}:led`.

### 4.2 `participant_join`
Valida capacidade, unicidade de apelido e inclui o participante.
* **Parâmetros:** `roomId`, `participantId`, `displayName`, `participantJson`, `joinedAtMs`.
* **Ação Atômica:**
  1. Verifica se `HLEN room:{roomId}:parts` atingiu `capacity` (retorna erro se cheia).
  2. Normaliza o apelido para caixa baixa: `lowerDisplayName`.
  3. Executa `SADD room:{roomId}:names lowerDisplayName`. Se retornar `0`, o nome já está em uso na sala; interrompe e aborta.
  4. Salva `HSET room:{roomId}:parts participantId participantJson`.
  5. Adiciona ao ZSet `ZADD room:{roomId}:parts:idx joinedAtMs participantId`.

### 4.3 `participant_reject`
Rejeita participante e libera o apelido de volta para a sala.
* **Ação Atômica:**
  1. Atualiza `status = "rejected"` na hash do participante em `room:{roomId}:parts`.
  2. Executa `SREM room:{roomId}:names lowerDisplayName`, devolvendo imediatamente o apelido para reuso.

### 4.4 `participant_remove`
Remove o jogador por expulsão ou saída.
* **Ação Atômica:**
  1. Obtém o JSON do participante e extrai `displayName` e `userId`.
  2. Executa `HDEL room:{roomId}:parts participantId`.
  3. Executa `ZREM room:{roomId}:parts:idx participantId`.
  4. Executa `SREM room:{roomId}:names lowerDisplayName`.
  5. Se houver `userId`, remove de `user:{userId}:joined`.

### 4.5 `submission_put`
Garante o limite estrito de 1 envio por participante por fase e atualiza as métricas acumuladas.
* **Parâmetros:** `matchId`, `queuePhaseId`, `participantId`, `submissionJson`, `isCorrect`, `score`.
* **Ação Atômica:**
  1. Executa `HSETNX match:{matchId}:subs {queuePhaseId}:{participantId} submissionJson`.
  2. Se retornar `0`, a resposta já existia; aborta sem alterar contadores (impede duplicidade).
  3. Incrementa contadores atômicos na hash `match:{matchId}:agg:{queuePhaseId}`:
     * `HINCRBY submitted 1`
     * `HINCRBY graded 1` (se aplicável)
     * `HINCRBY correct 1` (se `isCorrect == true`)
     * `HINCRBY scoreSum score`

### 4.6 `phase_restart`
Reinicia a fase corrente na partida.
* **Ação Atômica:**
  1. Varre e remove todas as chaves de submissão da fase `{queuePhaseId}:*` de `match:{matchId}:subs`.
  2. Zera integralmente a hash de contadores `match:{matchId}:agg:{queuePhaseId}`.

---

## 5. Ciclo de Vida de TTL e Expiração

| Estado da Sala / Partida | Política de TTL no Redis | Justificativa |
|---|---|---|
| **Sala Criada (sem partida)** | 24 horas, renovado a cada interação | Evita acúmulo de salas abandonadas no lobby. |
| **Partida em Andamento** | Renovado a cada transição de fase | Garante que a sala nunca expire durante a execução de uma partida. |
| **Partida Concluída e Confirmada no Mongo** | 24 horas fixas | Permite visualização temporária do pódio e retorno ordenado ao lobby. |
| **Partida Concluída Pendente de Gravação** | TTL estendido; `matchId` em `commit:pending` | Protege os dados da partida caso o serviço de escrita no MongoDB sofra indisponibilidade transitória. |
