# Serviço de WebSocket — log de implementação

O que foi feito na leva que tirou `contract/websocket-contract.md` do estado
"**estado de implementação: nenhum**". Segue o formato de `api-init-log.md` e
`api-lobby-log.md`: não é um resumo do que o contrato pede, é o registro das
**decisões que o contrato não tomava** e de onde elas ficaram no código.

**Resumo executivo:** existe agora um serviço Node em `realtime/` que implementa
o protocolo inteiro das seções 2–4 e 6–10 do contrato, e a API .NET passou a
publicar eventos nos quatro pontos que estavam marcados `// TODO(realtime)` (mais
um quinto, `participant.joined`, que faltava para o lobby funcionar de fato). O
broker é Redis Pub/Sub. **O que continua faltando é payload, não transporte:** a
seção 5 lista eventos de partida (`phase.*`, `match.*`, `stats.updated`,
`submission.graded`) que nenhuma rota da API produz ainda, porque as seções 7–10
do contrato REST não têm endpoint. O caminho para eles já está aberto e testado.

---

## 1. As quatro decisões que estavam em aberto

`next-steps.md` §4 listava o realtime como "travando, mesmo sem endpoint novo", e
enumerava três decisões. Elas foram fechadas assim (a quarta apareceu durante a
implementação):

### 1.1. Broker: Redis Pub/Sub

Como o próprio contrato sugere para começar (§9): latência sub-ms e operação
trivial. Cloud Pub/Sub continua sendo a alternativa se um dia houver entrega
garantida entre regiões como requisito — a troca ficaria contida em
`realtime/src/broker.ts` e `RedisRealtimeEventPublisher.cs`, que são as duas
únicas peças que conhecem o Redis.

**Um canal Redis por sala (`codex:rt:room:{code}`), não um canal global.** O
contrato não especifica o layout. Com canal global, toda instância recebe todo
evento de todas as salas e descarta o que não interessa — o tráfego cresce com
`salas × instâncias`. Assinando por sala, uma instância só recebe o que ela de
fato atende. O canal *lógico* do contrato (`room:x:leader`, `participant:y`)
viaja **dentro** do envelope e é ele que decide o fan-out:

```json
{ "channel": "room:482913:leader", "event": { "type": "stats.updated", "...": "..." }, "publishedAt": 1785000000000 }
```

O refcount que liga e desliga a assinatura por sala está em `Hub.retainRoom` /
`releaseRoom` (`realtime/src/hub.ts`).

### 1.2. Quem publica: a própria API .NET, depois do `SaveChanges`

Sem fila intermediária nem webhook. A regra está escrita no contrato de
`IRealtimeEventPublisher` e vale para todo ponto de publicação futuro:

1. **Publique depois do `SaveChanges`.** Publicar antes entrega ao cliente um
   estado que ainda pode sumir se a transação falhar — e, ao recarregar, ele veria
   o estado antigo voltar.
2. **Falha ao publicar não derruba a requisição.** `RedisRealtimeEventPublisher`
   engole e loga. É o que o contrato §1 descreve: "se ele cair, a partida não
   corrompe; os alunos param de ver atualização ao vivo, recarregam, e o REST
   devolve o estado correto". Propagar a exceção transformaria um Redis fora do ar
   em um `500` numa ação que deu certo.

### 1.3. Iniciar o projeto: `realtime/`, TypeScript + `ws` + `ioredis`

Node 20+, ESM, `tsc` para `dist/`. `ws` e não `socket.io`: o contrato pede
WebSocket puro ("sem fallback de long-polling, o load balancer não precisa de
sticky sessions"), e `socket.io` traria um handshake próprio que obrigaria a
reescrever o `RealtimeProvider.tsx`, que hoje usa `WebSocket` nativo.

### 1.4. A decisão que ninguém tinha visto: **como o Node valida a sessão**

Esta não estava em nenhuma lista, e é a que mais moldou o desenho.

O token de sessão do Codex é **opaco**, protegido por ASP.NET Data Protection
(`SessionTokenService`), com a chave no Postgres da API. **Não existe caminho em
que um processo Node o decifre.** E a seção 10 do contrato exige mais que
decifrar: "autorização por canal a cada `subscribe`, sempre relendo o papel do
banco — não confie no `isLeader` que você mandou no `ready` cinco minutos atrás".

Três opções foram consideradas:

| Opção | Por que não / por que sim |
|---|---|
| Só rotas existentes (`GET /session` + `GET /rooms/{code}`) | Zero mudança no .NET, mas **não distingue `pending` de `approved`** — essa informação só existe em rota de líder. Trataria todo membro como aprovado, afrouxando §3. |
| Node lê o Postgres direto | Ainda precisaria do .NET para o token, e duplicaria o schema em dois projetos. |
| **Rota interna nova no .NET** ✅ | Uma chamada resolve token → `{userId, participantId, isLeader, participantStatus, displayName, avatarIndex}`. O Node não decide autorização: ele pergunta. |

Resultado: **`POST /internal/realtime/resolve`** (`Endpoints/RealtimeEndpoints.cs`,
lógica em `Services/Realtime/RealtimeSessionService.cs`). Isso preserva a regra do
contrato REST §1 — "autorização num lugar só" — mesmo com dois processos: o Node
tem a *tabela* de quem pode assinar o quê (`realtime/src/channels.ts`), mas os
três fatos de que ela depende (`isLeader`, `participantStatus`, `roomCode`) vêm
todos do banco, a cada `subscribe`.

**O token vai no corpo, não no `Authorization`.** Quem chama não é o dono da
sessão: é o serviço de WS perguntando "de quem é este token?". Usar o cabeçalho
faria a rota parecer autenticada como aquela pessoa, o que ela não é.

**Cache de 1 s** (`REALTIME_ROLE_CACHE_TTL_MS`) para absorver rajadas de
`subscribe` sem esticar a janela em que um papel obsoleto vale. `0` desliga.

---

## 2. Decisões que o contrato não fixava e o código teve que tomar

### 2.1. Autenticação antes do upgrade **e** o ticket, que só pode chegar depois

O §2 diz duas coisas que não cabem no mesmo instante: "o servidor valida o cookie
**antes** de aceitar o upgrade — conexão não autenticada nunca chega a existir";
e "quando o cookie não está disponível, o front manda o token no campo `token` do
`hello`" — que é *depois* do upgrade.

Como ficou (`realtime/src/server.ts` → `onUpgrade`):

- **Com cookie:** resolve antes do upgrade. Falhou → `401` cru no socket, sem
  handshake. É o caminho normal, e nele o contrato é cumprido ao pé da letra.
- **Sem cookie:** o upgrade acontece, mas a conexão nasce com prazo
  (`REALTIME_HELLO_TIMEOUT_MS`, 5 s) para se identificar, **não pode assinar
  nada** até o `ready`, e é fechada se o prazo passar.

É a única leitura que atende os dois parágrafos. O desvio está confinado ao caso
que só existe por causa do Safari.

### 2.2. `subscribe` chega antes de o `hello` ser resolvido

O `RealtimeProvider.tsx` manda `hello` e `subscribe` no mesmo `onopen`, sem
esperar o `ready` — e resolver o `hello` é uma ida à API. Recusar o `subscribe`
por essa corrida seria recusar uma assinatura legítima produzida pelo próprio
cliente de referência. A conexão enfileira até 8 quadros durante o estado
`authenticating` e os processa depois do `ready`
(`realtime/src/connection.ts` → `onMessage`).

### 2.3. Canal malformado responde `FORBIDDEN_CHANNEL`, não um code novo

`parseChannel` devolve `null` para `room:abc` e para `room:482913:xyz`, e o
chamador manda o mesmo `FORBIDDEN_CHANNEL` de "existe mas você não pode".
Distinguir daria ao atacante um oráculo de formatos válidos — é o mesmo raciocínio
do `RoomAccessService`, que não distingue "código malformado" de "sala não
existe". Idem para `roomCode` inválido no `hello`: `ROOM_NOT_FOUND`.

### 2.4. Segunda barreira, no sentido contrário: evento errado no canal errado

O contrato descreve a autorização de quem **assina**. Falta a simétrica: um
publicador que erre o canal. Se `submission.graded` fosse publicado em
`room:{code}`, a nota de uma pessoa iria para a turma inteira — exatamente o que a
separação de canais existe para impedir.

`isEventAllowedOnChannel` (`realtime/src/channels.ts`) tem a tabela
canal → eventos permitidos, e o hub **descarta e loga** o que não bate. Verificado
no smoke test.

### 2.5. `player.activity` é throttled por participante, não por canal

O §7 diz "throttle de 1 s no servidor, só para o líder". Throttled por canal, um
aluno digitando abafaria o sinal dos outros — e o painel do líder mostra uma linha
por pessoa. A chave do throttle inclui o `participantId`
(`THROTTLE_RULES` em `realtime/src/throttle.ts`).

O throttle acontece **duas vezes**: na entrada, a conexão descarta `activity` que
chega antes de 1 s ("é descartado se chegar mais rápido que o throttle" — §7), o
que evita publicar no Redis; e na saída, junto dos demais eventos.

### 2.6. Throttle é leading + trailing, colapsando no último valor

O primeiro evento da janela sai na hora — uma barra de progresso que só começa a
subir depois de 500 ms parece travada. Os que chegam durante a janela são
colapsados **no último** e emitidos quando ela fecha. Colapsar é correto porque
esses eventos carregam estado absoluto, não incremento: `submittedCount: 13`
sobrescreve `12` sem perda. Verificado: 10 publicações em rajada viram 2 quadros,
e o último valor chega intacto.

### 2.7. `RECONNECT` faltava na união de `RealtimeErrorCode`

O §9 exige `{"type":"error","code":"RECONNECT"}` no encerramento gracioso, mas o
code não estava em `nextjs/src/realtime/protocol.ts`. **Acrescentado lá** — é a
única mudança que esta leva fez no contrato em TypeScript. Ele é usado em dois
lugares: `SIGTERM`, e quando a API de resolução está indisponível (que não é "sua
credencial é inválida", é "não consegui perguntar" — o cliente reconecta no
backoff e tenta de novo).

### 2.8. Limites que o contrato não numera

- **16 canais por socket.** Os canais úteis a uma conexão são no máximo quatro
  (§3); dezenas só podem ser tentativa de inflar a tabela de fan-out.
- **8 quadros enfileirados** durante a autenticação (§2.2 acima).
- **`Origin` ausente** é aceita fora de produção e recusada em produção. Sem
  `Origin` não há browser, logo não há o ataque que a allowlist impede (site
  terceiro abrindo socket com o cookie da vítima); em produção é tráfego que não
  deveria existir, e em dev liberar deixa `wscat` funcionar.
- **Timeout de socket ocioso** de 45 s, com ping do servidor na metade. O cliente
  já manda `ping` a cada 20 s (§4), então um socket calado por 45 s está morto.

---

## 3. O que foi implementado, por seção do contrato

| § | Assunto | Estado |
|---|---|---|
| 2 | Handshake, `hello`/`ready`, `PROTOCOL_VERSION` | ✅ completo, inclusive o ticket |
| 3 | Quatro canais e autorização por canal | ✅ completo |
| 4 | `hello`, `subscribe`, `unsubscribe`, `ping`, `activity` | ✅ completo; qualquer outro tipo é descartado em silêncio |
| 5 | Formato das mensagens do servidor | ⚠️ o **transporte** está completo; só os eventos de lobby têm quem os produza (ver §4 abaixo) |
| 6 | `endsAt` absoluto, `ping`/`pong` para offset | ✅ o `pong` responde mesmo antes do `ready` — medir latência não depende de saber quem é |
| 7 | Throttling | ✅ `phase.progress` 500 ms, `stats.updated` 1 s, `player.activity` 1 s por participante |
| 8 | Reconexão | ✅ backoff **com jitter** (que faltava no `RealtimeProvider`); sem replay, por desenho |
| 9 | Escala horizontal e `SIGTERM` | ✅ sem estado, sem afinidade de sessão, dreno com `RECONNECT` + 1001 |
| 10 | Segurança | ✅ auth antes do upgrade, papel relido a cada `subscribe`, quadro de 8 KB, 20 msg/s, `Origin`, socket fechado na expulsão |

### Do lado .NET

| Ponto | Antes | Agora |
|---|---|---|
| `PATCH /rooms/{code}` | `// TODO(realtime)` | publica `room.settings` em `room:{code}` |
| approve | `// TODO(realtime)` | publica `participant.updated` |
| reject | `// TODO(realtime)` | publica `participant.updated` |
| `DELETE` participante | `// TODO(realtime)` | publica `participant.left` (sala) **e** `participant.removed` (privado) |
| `POST /rooms/{code}/participants` | — | publica `participant.joined` (ou `updated`, na reentrada) |

**Os quatro `TODO(realtime)` não existem mais no código.**

O quinto ponto (`participant.joined`) não estava marcado, mas sem ele o lobby não
funciona de verdade: o líder não veria ninguém chegar. Ele distingue chegada de
reentrada — a reentrada de quem já tem card na tela publica `participant.updated`,
senão o front teria que decidir sozinho entre inserir e atualizar.

`DELETE` publica **dois** eventos porque eles fazem coisas diferentes:
`participant.left` tira o card da lista de todo mundo; `participant.removed`, no
canal privado, é o que faz a pessoa saber que foi ela — e é o que leva o serviço
de WS a **fechar o socket dela**, como o §10 exige ("só mandar o evento deixa a
conexão viva recebendo eventos da sala").

### O ticket de `/realtime-ticket`, ponta a ponta

- **API:** `POST /realtime-ticket` (`RealtimeEndpoints.cs`), 32 bytes de
  `RandomNumberGenerator`, TTL de 30 s. Store em Redis com **`GETDEL`** — ler e
  apagar num comando só; com `GET` seguido de `DEL`, dois handshakes simultâneos
  com o mesmo ticket passariam os dois, que é precisamente o que "uso único"
  impede.
- **Next:** `src/app/api/realtime-ticket/route.ts` (o browser não fala com a API
  direto) + `src/lib/api/realtime.ts`.
- **Front:** o `RealtimeProvider` busca o ticket **só** quando um socket morre
  antes do `ready` por falta de sessão; num navegador que manda o cookie, a rota
  nunca é tocada.
- **WS:** ao consumir um ticket, a API devolve o **token de sessão por trás
  dele**, e a conexão passa a usar esse token para reler o papel nos `subscribe`
  seguintes. Sem isso, uma conexão autenticada por ticket não conseguiria cumprir
  o §10 — um ticket de uso único não pode ser reapresentado.

---

## 4. O que **não** foi implementado, e por quê

### Os eventos de partida não têm quem os produza

> **Atualizado:** `queue.updated` saiu desta lista — as mutações da seção 6 o
> publicam (`contract/api-queue-log.md` §3). O parágrafo abaixo continua valendo
> para os eventos de partida.

`phase.started`, `phase.paused`, `phase.progress`, `phase.ended`,
`match.finished`, `match.returned-to-lobby`, `stats.updated`,
`submission.graded` e `match.started` estão todos no §5 do
contrato. O serviço de WS **os transporta hoje** — canal, throttle e autorização
estão implementados e testados para todos. O que não existe é a rota REST que os
publica: as seções 7–10 do contrato REST não têm endpoint nenhum
(`api-implementation-status.md` §1).

Quando essas rotas existirem, publicar é uma linha:

```csharp
await realtime.PublishAsync(room.Code, RealtimeChannels.Match(room.Code), new PhaseStartedEvent(...), ct);
```

### ~~`queue.updated` manda uma revisão que o schema não guarda~~ — resolvido

O §5 manda `{ "type": "queue.updated", "revision": 7 }`, e nada no schema guardava
esse número. A seção 6 fechou isso com **um contador só**, como este documento
pedia: `rooms.QueueRevision` (migration `RoomQueueRevision`), incrementado por toda
mutação da fila e publicado no canal `room:{code}`.

O que **não** foi unificado, e deliberadamente: o `409 QUEUE_MISMATCH` do
`PUT /queue/order` continua comparando os ids enviados com os da fila, e não a
revisão. É o que o contrato REST descreve literalmente, e é o teste que de fato
protege o dado. A revisão é do transporte; o mismatch é da rota. Ver
`contract/api-queue-log.md` §3.

### Reconexão não devolve `phase.started` com o estado da fase

O §8 diz: "ao reconectar, o cliente reenvia `hello` e o servidor responde com
`phase.started` contendo o `PhaseState` completo". Isso exige que o WS saiba a
fase corrente, e ele não é dono de estado — teria que pedir à API. A rota que
daria essa resposta é `GET /matches/{id}/current-phase`, da seção 7, **que não
existe**. Enquanto não existir, o `ready` não vem acompanhado de estado de fase.
Não é uma lacuna do transporte: é a mesma dependência da seção 7.

### Ticket em memória quando não há Redis

`InMemoryRealtimeTicketStore` é o fallback sem Redis. **O ticket só é resgatável
na instância da API que o emitiu** — equivalente ao Redis com uma instância (que é
a implantação de hoje), quebrado com várias atrás de um load balancer. Configure
`CodexApi:Realtime:RedisConnectionString` antes de escalar a API.

### Rate limit da API para as rotas novas

`next-steps.md` §5 já registra que `POST /rooms` não tem rate limit.
`POST /realtime-ticket` entra na mesma lista: é uma rota que emite credencial e
não tem limite. A partição natural é a mesma da sessão.

---

## 5. Um efeito colateral que vale registrar

**`CodexJsonOptions`** (`Common/Json/CodexJsonOptions.cs`) é novo. As regras de
serialização do contrato (camelCase, `MatchMode` em kebab-case, datas em `Z`)
estavam inline no `Program.cs` enquanto o único serializador era o do HTTP. Agora
há um segundo — o publicador de realtime. Se as duas configurações divergissem, o
mesmo `ParticipantDto` sairia num formato pelo `GET` e noutro pelo WebSocket, e o
front, que usa **um parser só** para os dois (é o que o §5 do contrato exige ao
falar de `stats.updated`), quebraria apenas no caminho do tempo real. Um lugar só.

---

## 6. Como este estado foi verificado

```bash
# API
cd .NET && dotnet build && dotnet test        # 139 testes (eram 111)

# Serviço de WS
cd realtime && npm install && npm test        # 24 verificações + 3 de encerramento

# Front
cd nextjs && npx tsc --noEmit
```

Os **28 testes novos** do .NET cobrem três coisas: que cada mutação publica o
evento certo **no canal certo** (`RealtimePublishingTests`) — errar o canal produz
um evento que nunca chega na tela, sem erro nenhum no meio do caminho — e a
resolução de sessão (`RealtimeSessionServiceTests`), incluindo ticket de uso
único, ticket expirado, token expirado, líder sem participante, participante de
outra sala e `pending` vs `approved`. O terceiro grupo
(`RedisConfigurationParserTests`) é a armadilha do §6 abaixo.

O smoke test do Node (`realtime/test/`) sobe o serviço de verdade contra uma API
falsa e verifica no fio, entre outras coisas:

- `Origin` fora da allowlist e cookie inválido recusados **antes** do upgrade;
- `pending` não assina `room:{code}`; participante não assina `:leader` nem o
  canal privado de outra pessoa;
- evento individual publicado em canal coletivo é descartado;
- 10 `phase.progress` em rajada viram 2 quadros, com o último valor intacto;
- `activity` do aluno chega ao líder com nome e avatar, e **nunca** volta ao
  próprio aluno;
- `participant.removed` fecha o socket da pessoa;
- 8 KB fecha com 1009, 20 msg/s fecha com `RATE_LIMITED`, ticket reusado é
  `UNAUTHENTICATED`;
- `SIGTERM` manda `RECONNECT` + 1001 e recusa novos upgrades durante o dreno.

**Fan-out entre duas instâncias, com Redis de verdade — verificado.** Contra um
Redis 7 em Docker: duas instâncias do serviço na 4701 e 4702, um cliente WS em
cada, ambos assinando `room:482913`; o publicador **.NET** (a cadeia real
`RealtimeOptions → RedisRealtimeConnection → RedisRealtimeEventPublisher`)
publicou `participant.joined` e `room.settings`, e **as duas instâncias
entregaram**. Isso fecha três coisas de uma vez: o refcount de assinatura por
sala, a travessia .NET → Redis → Node, e o formato de serialização — o payload
chegou com `status: "approved"` e `joinedAt` terminando em `Z`, que é o que
`CodexJsonOptions` promete (§5 acima).

O arranjo era manual demais para virar `npm test` (exige Redis no ar e coordenar
dois runtimes), então não ficou versionado.

**O que continua não verificado, e por quê:**

- **`SIGTERM` via sinal real.** O Windows não tem sinais POSIX:
  `child.kill('SIGTERM')` termina o processo à força e o handler nunca roda. O
  mesmo caminho é verificado chamando `shutdown()` em processo
  (`test/shutdown.smoke.mjs`), e o teste por sinal roda normalmente em Linux.
- **Ponta a ponta pela UI com Postgres.** Depende de subir os três processos
  juntos; as peças foram verificadas isoladamente.

### Três defeitos encontrados pelos próprios testes

Registrados porque os três eram invisíveis na leitura do código:

0. **`redis://localhost:6379` na configuração do .NET não dá erro — e não
   funciona.** `ConfigurationOptions.Parse` aceita a URL e produz um host chamado
   literalmente `"redis://localhost:6379"` na porta 0, sem lançar nada. E o
   serviço Node ao lado usa exatamente esse formato, porque o ioredis exige URL.
   Ou seja: copiar o valor de um lado para o outro dá uma API que sobe normal,
   nunca conecta, e cujo único sintoma é "os eventos não chegam" — já que falha de
   publicação é engolida de propósito. `RedisConfigurationParser` normaliza os
   dois formatos (mais `rediss://` para TLS, credenciais e índice de banco), e um
   dos testes fixa o comportamento nativo: se o StackExchange.Redis um dia
   entender URLs, ele quebra e avisa que o parser virou desnecessário.

1. **`REALTIME_ROLE_CACHE_TTL_MS=0` derrubava o boot.** O valor está documentado
   como "desliga o cache" e é lido como `> 0` em `identity.ts`, mas o validador
   exigia inteiro positivo. `integer()` ganhou um `minimum` explícito — 1 por
   padrão (zero numa porta ou num limite de quadro é erro de digitação), 0 onde
   zero é opção de verdade.
2. **`loadConfig(env)` ignorava o `env` que recebia.** Os helpers liam
   `process.env` direto, então o parâmetro era decorativo — e qualquer teste que
   passasse um ambiente próprio silenciosamente usava o do processo.

---

## 7. O que muda nos outros documentos

Estes trechos ficaram desatualizados com esta leva:

- **`websocket-contract.md`**, nota de proveniência: "estado de implementação:
  nenhum" e "não há broker (Redis/Pub-Sub) configurado nem decidido" — as duas
  coisas mudaram.
- **`api-implementation-status.md`** §6 ("Realtime — arquiteturalmente ausente")
  inteiro, e a frase do resumo executivo "nenhum evento de realtime é publicado".
- **`next-steps.md`** §4 ("Decisão de arquitetura do realtime — travando"): as
  três decisões que ele lista foram tomadas, e o "escopo mínimo para desbloquear"
  que ele sugeria foi ultrapassado — o serviço existe.

Não foram reescritos nesta leva: este log é a fonte do que mudou, e reescrever os
três exigiria decidir o que mais entrou ou saiu de cada lista desde a última
revisão deles.
