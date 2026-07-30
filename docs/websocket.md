# Servidor de WebSocket

Documento de arquitetura do serviço de tempo real do Codex: o que ele faz, o que
ele explicitamente **não** faz, o protocolo completo e como escalar.

O contrato em TypeScript está em `src/realtime/protocol.ts` — este documento e
aquele arquivo descrevem a mesma coisa.

---

## 1. A decisão que estrutura tudo

> **O servidor de WebSocket transporta estado. Ele não é dono de nenhum.**

Toda mutação passa pela API REST, que grava no Firestore e **depois** publica o
evento. O serviço de WS recebe esse evento e faz fan-out para as conexões
certas. Ele nunca escreve no banco a partir de uma mensagem do cliente.

Por que assim:

- **Uma fonte de verdade.** Um aluno que recarrega a página e um que ficou
  conectado vêem exatamente o mesmo estado, porque os dois leem do mesmo lugar.
- **Autorização num lugar só.** "Aluno pode ver gabarito?" é uma pergunta
  respondida pela API. Se o WS também pudesse mutar, a mesma regra existiria
  duplicada — e uma das cópias ficaria desatualizada.
- **O WS pode cair.** Se ele cair, a partida não corrompe: os alunos param de ver
  atualização ao vivo, recarregam, e o REST devolve o estado correto. Um WS
  autoritativo transformaria uma queda em perda de dados.
- **Escala horizontal trivial.** Um processo sem estado é só um multiplicador de
  mensagens; pode-se ligar e desligar instâncias à vontade.

A única exceção é o evento `activity` ("fulano está digitando"), que é efêmero por
natureza e não vale uma escrita no banco.

```
                    ┌──────────────┐
   HTTP (mutação)   │              │  grava
Browser ──────────▶ │   API REST   │ ────────▶ Firestore
                    │              │
                    └──────┬───────┘
                           │ publica (Pub/Sub · Redis)
                           ▼
                    ┌──────────────┐
   WebSocket        │  Serviço de  │
Browser ◀────────── │  tempo real  │  (sem estado, N instâncias)
      (só leitura)  └──────────────┘
```

---

## 2. Handshake

```
wss://realtime.codex.app/realtime
```

O cookie `codex_session` (httpOnly, `SameSite=Lax`) vai automaticamente no
handshake quando o WS está no mesmo site. O servidor valida o cookie **antes** de
aceitar o upgrade — conexão não autenticada nunca chega a existir.

Quando o cookie não está disponível (navegador em iframe, ITP do Safari), o front
pede `POST /realtime-ticket` à API, recebe um token de uso único válido por 30 s,
e o manda no campo `token` do `hello`.

Sequência:

```
cliente → { "type": "hello", "v": 1, "token": "", "roomCode": "482913" }
servidor → { "type": "ready", "v": 1, "participantId": "p_9", "isLeader": false, "serverTime": 1785000000000 }
cliente → { "type": "subscribe", "channels": ["room:482913:match", "participant:p_9"] }
```

Se a versão do protocolo não bater: `{ "type": "error", "code": "PROTOCOL_VERSION" }`
e o socket fecha. O front trata como "recarregue a página".

---

## 3. Canais

| Canal | Quem pode assinar | Conteúdo |
|---|---|---|
| `room:{code}` | qualquer participante aprovado | lobby: entradas, saídas, configurações, fila |
| `room:{code}:match` | qualquer participante aprovado | partida: fase corrente, cronômetro, contadores agregados |
| `room:{code}:leader` | **apenas o líder** | métricas por aluno, atividade individual |
| `participant:{id}` | **apenas aquele participante** | correção da própria resposta, expulsão |

A separação não é organizacional, é de segurança. `room:{code}:match` carrega só
agregados (12 de 28 enviaram) — nada que identifique. Tudo que é individual está
em `:leader` ou no canal privado. Assim, se a autorização de canal falhar, o pior
caso vaza um contador, não uma resposta.

O servidor **rejeita** `subscribe` em canal proibido com
`{ "type": "error", "code": "FORBIDDEN_CHANNEL" }` — nunca aceita silenciosamente.

---

## 4. Mensagens do cliente

| Tipo | Payload | Nota |
|---|---|---|
| `hello` | `{ v, token, roomCode }` | obrigatório, primeiro quadro |
| `subscribe` / `unsubscribe` | `{ channels: [...] }` | |
| `ping` | `{ sentAt }` | a cada 20 s; serve também para medir latência |
| `activity` | `{ phaseId, state: "typing" \| "idle" }` | efêmero, ver §7 |

Nenhuma outra mensagem do cliente é aceita. Responder uma pergunta, avançar de
fase, pausar a sala — tudo isso é HTTP.

---

## 5. Mensagens do servidor

### Conexão
```jsonc
{ "type": "ready", "v": 1, "participantId": "p_9", "isLeader": false, "serverTime": 1785000000000 }
{ "type": "pong",  "sentAt": 1785000000000, "serverTime": 1785000000042 }
{ "type": "error", "code": "FORBIDDEN_CHANNEL", "message": "…" }
```

### Lobby — canal `room:{code}`
```jsonc
{ "type": "participant.joined",  "participant": { … } }
{ "type": "participant.updated", "participant": { … } }   // aprovado / recusado
{ "type": "participant.left",    "participantId": "p_9" }
{ "type": "room.settings",       "locked": true, "requireAccount": false, "capacity": 20 }
{ "type": "queue.updated",       "revision": 7 }          // só o número; quem quiser detalhe refaz GET
{ "type": "match.started",       "matchId": "m_1", "mode": "live" }
```

`queue.updated` manda só a revisão de propósito: a fila só interessa ao líder, e
ele é quem acabou de mudá-la. Mandar a fila inteira para 28 alunos que não a
enxergam seria desperdício puro.

### Partida — canal `room:{code}:match`
```jsonc
{ "type": "phase.started",  "phaseNumber": 3, "totalPhases": 8, "endsAt": 1785000045000, "state": { …PhaseState… } }
{ "type": "phase.paused",   "paused": true, "endsAt": null }
{ "type": "phase.progress", "phaseId": "ph_1", "submittedCount": 13, "totalPlayers": 28, "readyCount": 4 }
{ "type": "phase.ended",    "phaseId": "ph_1" }
{ "type": "match.finished", "podium": [ … ] }
{ "type": "match.returned-to-lobby" }
```

### Privado — canal `participant:{id}`
```jsonc
{ "type": "submission.graded",  "submission": { …Submission… } }
{ "type": "participant.removed", "reason": "removed_by_leader" }
```

### Painel do líder — canal `room:{code}:leader`
```jsonc
{ "type": "stats.updated",   "stats": { …PhaseStats… } }
{ "type": "player.activity", "participantId": "p_4", "name": "Diego", "avatarIndex": 3, "state": "typing" }
```

`stats.updated` carrega exatamente o corpo de
`GET /matches/{id}/phases/{id}/stats`. Um formato só, usado por HTTP e por WS —
o front não precisa de dois parsers, e o backend não precisa manter dois
serializadores em sincronia.

---

## 6. Cronômetro: `endsAt`, não `secondsLeft`

O servidor manda **um instante absoluto** (`endsAt`, epoch em ms do relógio dele).
Nunca "faltam 32 segundos".

O motivo é que um contador local decrementando de 1 em 1 segundo erra em quatro
situações que acontecem toda aula:

1. aba em segundo plano — o navegador reduz `setInterval` a 1 Hz ou menos;
2. reconexão — o cliente perdeu N tiques e não sabe quantos;
3. pausa do líder — precisaria de mensagem de "quanto tempo sobrou";
4. relógio do aluno errado — comum em Chromebook de escola.

Com `endsAt`, o cliente calcula `endsAt − (agora + offset)` a cada 250 ms. O
`offset` sai da troca de `ping`/`pong`:

```
offset = serverTime + (rttEstimado / 2) − agoraLocal
```

Isso resolve o relógio errado (o offset absorve a diferença) e a aba em segundo
plano (o próximo tique já mostra o valor correto, sem acumular erro).

Ao pausar, o servidor manda `endsAt: null`; ao retomar, um novo `endsAt` deslocado
pela duração da pausa.

Implementação: `src/realtime/useServerCountdown.ts`.

---

## 7. Throttling e volume

Uma sala de 30 pessoas gera picos de dezenas de eventos por segundo. Sem
throttle, o servidor manda 30 × 30 = 900 mensagens para um único envio em massa.

| Evento | Política |
|---|---|
| `phase.progress` | agregado, **no máx. 1 a cada 500 ms** por sala |
| `stats.updated` | agregado, **no máx. 1 a cada 1 s**, só para o líder |
| `player.activity` | debounce de 2 s no cliente, throttle de 1 s no servidor, só para o líder |
| `phase.started` / `phase.ended` / `match.finished` | imediato, sem throttle |
| `participant.*` | imediato (frequência naturalmente baixa) |

Regra: eventos de **transição** vão na hora; eventos de **contador** vão em lote.
Uma barra de progresso que atualiza a cada 500 ms parece contínua; uma tela que
demora 500 ms para trocar de fase parece travada.

O `activity` é o único evento originado no cliente. Ele nunca é retransmitido
para outros alunos — só para o líder — e é descartado se chegar mais rápido que o
throttle. Um cliente malicioso que o inunde só se prejudica (rate limit fecha o
socket com `RATE_LIMITED`).

---

## 8. Reconexão

Backoff exponencial com teto: `500ms → 1s → 2s → 4s → 8s → 15s`, com jitter para
não sincronizar a turma inteira num único pico de reconexão.

**Não há replay de eventos perdidos.** Ao reconectar, o cliente reenvia `hello` e
o servidor responde com `phase.started` contendo o `PhaseState` completo. Estado
inteiro é mais simples e mais barato que um log de eventos com cursor — e a tela
inteira cabe em poucos KB.

Enquanto o socket está fora do ar, a UI mostra uma faixa "Reconectando…" e as
ações continuam funcionando (elas são HTTP, não WS). O que degrada é só a
atualização automática dos números.

---

## 9. Escala

O serviço é **sem estado**. Cada instância mantém apenas o mapa
`socket → canais assinados` na memória, e recebe todos os eventos de um
broker compartilhado.

```
                     ┌──────────────────┐
API REST ──publish──▶│  Redis Pub/Sub   │
                     │  ou Cloud PubSub │
                     └────────┬─────────┘
                        ┌─────┴──────┬──────────┐
                        ▼            ▼          ▼
                     ws-1         ws-2       ws-3
                        │            │          │
                     sockets      sockets    sockets
```

- **Sem afinidade de sessão.** Qualquer instância atende qualquer sala. O load
  balancer só precisa de sticky sessions se você usar fallback de long-polling;
  com WebSocket puro, não precisa.
- **Escolha do broker:** Redis Pub/Sub para começar (latência sub-ms, operação
  trivial). Cloud Pub/Sub se você já está em GCP com Firebase e quer entrega
  garantida entre regiões — ao custo de ~50 ms a mais.
- **Capacidade:** ~10 mil sockets ociosos por instância Node de 1 vCPU. O limite
  prático não é conexão, é fan-out: dimensione por
  `eventos/s × participantes/sala`.
- **Encerramento gracioso:** ao receber `SIGTERM`, a instância manda
  `{"type":"error","code":"RECONNECT"}` e fecha com código 1001. Os clientes
  reconectam no backoff e caem em outra instância.

### Por que não Firestore listeners direto no cliente

O Firebase permite o browser assinar documentos direto, o que dispensaria este
serviço. Não foi o caminho escolhido por três motivos:

1. **Gabarito.** `correctOptionId` mora no mesmo documento da fase. Um listener
   direto obrigaria a partir o documento em dois só para esconder um campo — e
   qualquer erro de regra expõe a resposta.
2. **Custo.** Firestore cobra por documento lido. 30 alunos × 1 leitura por
   submissão × 30 submissões = 900 leituras por fase, só de atualizar um contador.
   O mesmo número via Pub/Sub custa uma publicação.
3. **Cronômetro.** Firestore não tem noção de "faltam 32 s". A sincronização de
   relógio da §6 precisa de um servidor que responda `ping`.

---

## 10. Segurança

- Autenticação no handshake, **antes** do upgrade. Nunca aceite conexão para
  autenticar depois.
- Autorização por canal a cada `subscribe`, sempre relendo o papel do banco — não
  confie no `isLeader` que você mandou no `ready` cinco minutos atrás (o líder
  pode ter mudado).
- Limite de tamanho de quadro (sugestão: 8 KB). O único payload grande que o
  cliente manda é código-fonte, e isso vai por HTTP.
- Rate limit por conexão: 20 mensagens/s. Ultrapassou → `RATE_LIMITED` e fecha.
- `Origin` na allowlist, para bloquear socket aberto de outro site.
- Ao expulsar alguém, feche o socket dele além de publicar `participant.removed`.
  Só mandar o evento deixa a conexão viva recebendo eventos da sala.

---

## 11. Resumo do ciclo de uma fase

```
1. Líder: POST /matches/m1/advance {direction:"next"}
2. API grava currentPhaseIndex, calcula endsAt, publica
3. WS envia phase.started para room:482913:match   ── todos veem a fase nova
4. Aluno responde: POST …/submissions
5. API grava, incrementa stats/current na mesma transação, publica
6. WS envia phase.progress (agregado, ≤2/s)  ── barra sobe para todos
   WS envia stats.updated (≤1/s)             ── painel do líder atualiza
7. quiz/fill: a resposta do POST já vem corrigida
   text/code: IA corrige em background → WS envia submission.graded
                                          no canal participant:p_9
8. Todos enviaram (ou endsAt passou) → API publica phase.ended
9. Front troca para o feedback individual; GET …/comparison libera o gabarito
```
