# Contrato de Realtime (WebSocket) — Codex

Este documento define o contrato completo e autossuficiente do serviço de tempo real do Codex (Node.js, `ws`, `ioredis`). Especifica protocolo de comunicação, canais, envelopes de mensagens, modelo de sincronização de relógio, controle de vazão (*throttling*) e ciclo de vida das conexões.

---

## 1. Arquitetura e Papel do Serviço

* **Tecnologia:** Node.js (v20+), biblioteca nativa `ws` e cliente Redis `ioredis`.
* **Porta:** `4001` (com rota de atualização WebSocket em `/realtime` e `/health` para monitoramento).
* **Escalabilidade Horizontal:** O serviço não possui estado durável (*stateless*). Cada instância mantém na memória apenas o mapa transitório `socket → canais`.
* **Broker de Pub/Sub:** As instâncias conectam-se ao Redis via canal dedicado por sala (`codex:rt:room:{code}`). Apenas salas com conexões ativas na instância local têm canais assinados no Redis.
* **Sem Afinidade de Sessão:** Qualquer instância pode atender qualquer cliente ou sala.

---

## 2. Handshake e Autenticação

### 2.1 Ponto de Conexão
```text
ws://localhost:4001/realtime (desenvolvimento)
wss://realtime.codex.app/realtime (produção)
```

### 2.2 Fluxo de Autenticação
A autenticação do socket ocorre por uma de duas vias:
1. **Cookie `codex_session` (Via Principal):** O cookie HTTP (`httpOnly`, `SameSite=Lax`) é transmitido nos cabeçalhos da requisição de upgrade HTTP. O servidor valida a sessão antes de aceitar o upgrade; se for inválida ou ausente, rejeita imediatamente com HTTP 401.
2. **Ticket Descartável (Fallback / Safari ITP):** Para ambientes onde cookies de terceiros são bloqueados, o cliente obtém previamente um ticket via API REST (`POST /realtime-ticket`), válido por 30 segundos com consumo único, e o transmite no primeiro quadro (`hello`).

### 2.3 Sequência de Inicialização
1. O cliente abre a conexão WebSocket e envia o quadro `hello`:
```json
{
  "type": "hello",
  "v": 1,
  "token": "ticket_ou_token_opcional",
  "roomCode": "969180"
}
```
2. O servidor valida as credenciais e responde com `ready`:
```json
{
  "type": "ready",
  "v": 1,
  "participantId": "01a06cc4-a5bc-74a1-8a5d-3a443f5f3e59",
  "isLeader": false,
  "serverTime": 1785000000000
}
```
3. O cliente assina os canais desejados:
```json
{
  "type": "subscribe",
  "channels": [
    "room:969180:match",
    "participant:01a06cc4-a5bc-74a1-8a5d-3a443f5f3e59"
  ]
}
```
* **Erro de Versão:** Se `v` for incompatível, o servidor responde `{"type":"error","code":"PROTOCOL_VERSION"}` e encerra o socket.
* **Timeout de Identificação:** Se a conexão não apresentar credenciais válidas em até 5 segundos, o socket é encerrado com HTTP 401.

---

## 3. Matriz de Canais e Permissões

Cada conexão pode assinar no máximo 16 canais simultâneos.

| Canal | Quem pode assinar | Conteúdo Trafegado |
|---|---|---|
| `room:{code}` | Qualquer participante aprovado na sala | Eventos de lobby: entradas, saídas, alterações de capacidade, revisões de fila e disparo da partida. |
| `room:{code}:match` | Qualquer participante aprovado na sala | Eventos da partida coletiva: início/fim de fase, pausas, progresso agregado, encerramento e pódio. |
| `room:{code}:leader` | **Apenas o líder** da sala | Métricas consolidadas em tempo real, respostas detalhadas e digitação de alunos. |
| `participant:{id}` | **Apenas o participante titular** daquele ID | Notificações privadas: correção de resposta individual, aprovação/rejeição no lobby e ordem de expulsão. |

* Assinaturas em canais não autorizados são rejeitadas com `{"type":"error","code":"FORBIDDEN_CHANNEL"}`.
* Ao receber o evento `participant.removed`, o servidor fecha ativamente a conexão WebSocket do participante expulso.

---

## 4. Mensagens do Cliente (Client-to-Server)

O WebSocket destina-se ao recebimento de eventos de tempo real e envio de sinais transitórios. Mutação de estado de negócio (responder pergunta, avançar fase, mudar configuração) deve ser realizada via API REST.

| Tipo | Formato do Payload | Descrição |
|---|---|---|
| `hello` | `{"type":"hello","v":1,"token":"...","roomCode":"969180"}` | Primeiro quadro obrigatório de inicialização. |
| `subscribe` | `{"type":"subscribe","channels":["room:969180:match"]}` | Solicita inclusão nos canais especificados. |
| `unsubscribe` | `{"type":"unsubscribe","channels":["room:969180:match"]}` | Cancela assinatura nos canais indicados. |
| `ping` | `{"type":"ping","sentAt":1785000000000}` | Enviado periodicamente (a cada 20s) para cálculo de latência e heartbeat. |
| `activity` | `{"type":"activity","phaseId":"...","state":"typing"\|"idle"}` | Notificação transitória de atividade/digitação. |

Qualquer outro tipo de mensagem enviada pelo cliente é descartado em silêncio.

---

## 5. Mensagens do Servidor (Server-to-Client)

### 5.1 Sistema e Conexão
* **`ready`:** Confirmando conexão autenticada:
  ```json
  { "type": "ready", "v": 1, "participantId": "...", "isLeader": false, "serverTime": 1785000000000 }
  ```
* **`pong`:** Resposta imediata de latência:
  ```json
  { "type": "pong", "sentAt": 1785000000000, "serverTime": 1785000000025 }
  ```
* **`error`:** Erro do protocolo:
  ```json
  { "type": "error", "code": "FORBIDDEN_CHANNEL", "message": "Canal não autorizado." }
  ```

### 5.2 Lobby — Canal `room:{code}`
* `participant.joined`: Participante entrou na sala (`{"participant": { ... }}`).
* `participant.updated`: Participante aprovado ou rejeitado pelo líder (`{"participant": { ... }}`).
* `participant.left`: Participante saiu ou foi removido (`{"participantId": "..."}`).
* `room.settings`: Configurações alteradas (`{"locked": true, "requireAccount": false, "capacity": 30}`).
* `queue.updated`: Notificação leve de fila alterada (`{"revision": 3}`). O cliente líder recarrega os dados completos via REST.
* `match.started`: Partida iniciada pelo líder (`{"matchId": "...", "mode": "live"}`).

### 5.3 Partida — Canal `room:{code}:match`
* `phase.started`: Nova fase iniciada para todos:
  ```json
  {
    "type": "phase.started",
    "phaseNumber": 1,
    "totalPhases": 5,
    "endsAt": 1785000030000,
    "state": {
      "id": "...",
      "kind": "quiz",
      "name": "Soma",
      "basePoints": 50,
      "pointsMultiplier": 1.0,
      "timeSeconds": 30,
      "question": "Quanto é 2 + 2?",
      "options": [{ "id": "o1", "label": "4" }, { "id": "o2", "label": "3" }]
    }
  }
  ```
* `phase.paused`: Cronômetro congelado pelo líder (`{"paused": true, "endsAt": null}`).
* `phase.progress`: Progresso consolidado da turma na fase:
  ```json
  { "type": "phase.progress", "phaseId": "...", "submittedCount": 18, "totalPlayers": 20, "readyCount": 10 }
  ```
* `phase.ended`: Tempo encerrado ou todos responderam (`{"phaseId": "..."}`).
* `match.finished`: Encerramento da partida com pódio calculado:
  ```json
  {
    "type": "match.finished",
    "podium": [
      { "participantId": "...", "name": "Ana", "score": 250, "avatarIndex": 1, "avatarUrl": null }
    ]
  }
  ```
* `match.returned-to-lobby`: Sala retornada para o estado de lobby.

### 5.4 Privado — Canal `participant:{id}`
* `submission.graded`: Resultado da avaliação da resposta:
  ```json
  {
    "type": "submission.graded",
    "submission": {
      "phaseId": "...",
      "grading": "graded",
      "correct": true,
      "score": 50,
      "explanation": "Cálculo correto."
    }
  }
  ```
* `participant.updated`: Decisão de aprovação ou recusa destinada ao próprio participante.
* `participant.removed`: Aviso de expulsão pelo líder (`{"reason": "removed_by_leader"}`).

### 5.5 Painel do Líder — Canal `room:{code}:leader`
* `stats.updated`: Estatísticas completas da fase para o painel em tempo real:
  ```json
  {
    "type": "stats.updated",
    "stats": {
      "phaseId": "...",
      "submittedCount": 15,
      "totalPlayers": 20,
      "accuracyRate": 80,
      "avgResponseSeconds": 14,
      "teamAvgScore": 120,
      "answerDistribution": [
        { "optionId": "o1", "label": "4", "count": 12, "correct": true },
        { "optionId": "o2", "label": "3", "count": 3, "correct": false }
      ]
    }
  }
  ```
* `player.activity`: Sinal de digitação de participante específico:
  ```json
  { "type": "player.activity", "participantId": "...", "name": "Carlos", "avatarIndex": 2, "state": "typing" }
  ```

---

## 6. Sincronização de Cronômetro

O servidor nunca envia contagens relativas decrecientes ("faltam 10 segundos"). Em vez disso, envia instantes absolutos (`endsAt`) baseados no relógio do servidor em milissegundos UTC.

### 6.1 Cálculo no Cliente
1. O cliente calcula a defasagem (*offset*) do seu relógio em relação ao servidor utilizando a troca de quadros `ping` e `pong`:
$$\text{rtt} = \text{now}_{\text{local}} - \text{ping.sentAt}$$
$$\text{offset} = \text{pong.serverTime} + \left(\frac{\text{rtt}}{2}\right) - \text{now}_{\text{local}}$$
2. O tempo restante exato para contagem regressiva em tela é calculado localmente a cada 250 ms:
$$\text{segundosRestantes} = \max\left(0, \frac{\text{endsAt} - (\text{now}_{\text{local}} + \text{offset})}{1000}\right)$$
3. **Pausa:** Em caso de pausa, o servidor publica `endsAt: null`. Ao despausar, transmite um novo `endsAt` ajustado com o tempo restante remanescente.

---

## 7. Controle de Vazão (Throttling)

Para preservar desempenho de rede em salas populosas, eventos com alta taxa de emissão passam por contenção no servidor:

| Evento | Taxa Máxima de Saída | Política |
|---|---|---|
| `phase.progress` | 1 evento a cada 500 ms por sala | Agrega contadores; emite o valor mais recente no final da janela (*leading + trailing collapse*). |
| `stats.updated` | 1 evento a cada 1.000 ms por sala | Direcionado apenas ao líder; colapsa no último snapshot de métricas. |
| `player.activity` | 1 evento a cada 1.000 ms por participante | Debounce de 2s no cliente + throttle de 1s por aluno no servidor; direcionado apenas ao líder. |
| `phase.started` / `phase.ended` | Imediato (sem throttle) | Transições de tela prioritárias sem atraso. |
| `match.finished` / `participant.*` | Imediato (sem throttle) | Transições de ciclo de vida prioritárias sem atraso. |

---

## 8. Ciclo de Vida da Conexão e Segurança

### 8.1 Limites Operacionais e Proteção
* **Tamanho de Quadro:** Máximo de 8 KB por mensagem WebSocket. Quadros maiores encerram a conexão com código de fechamento `1009` (Message Too Big).
* **Taxa de Mensagens:** Limite de 20 mensagens por segundo por conexão. Ultrapassar o limite encerra o socket com erro `RATE_LIMITED` (`1008`).
* **Validação de Origem (CORS):** O cabeçalho `Origin` é conferido contra a lista de permissões (`REALTIME_ALLOWED_ORIGINS`). Em produção, valores coringa (`*`) são rejeitados.
* **Detecção de Quedas:** Pings periódicos de heartbeat. Se a conexão ficar inativa por mais de 45 segundos, é finalizada por inatividade.

### 8.2 Reconexão e Tolerância a Falhas
* Em caso de desconexão, o cliente efetua tentativas com recuo exponencial e ruído aleatório (*jitter*): `500ms → 1s → 2s → 4s → 8s → 15s`.
* **Sem Replay de Eventos:** O servidor não armazena filas de mensagens perdidas. Ao reconectar, o cliente reenvia `hello` e, em caso de inconsistência de tela, faz uma leitura única de estado via API REST.
* **Desligamento Suave (Graceful Shutdown):** Ao receber sinal de término (`SIGTERM`), o servidor emite `{"type":"error","code":"RECONNECT"}` a todos os clientes conectados e encerra os sockets com código `1001` (Going Away), recusando novos upgrades com HTTP 503 enquanto drena as conexões ativas.
