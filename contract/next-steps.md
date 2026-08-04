# Próximos passos (curto prazo)

Baseado em: `contract/api-rest-contract.md`, `contract/websocket-contract.md`,
`contract/api-implementation-status.md`, as listas "o que falta" de
`contract/api-init-log.md` §8 e `contract/api-lobby-log.md` §12, e no estado atual do
working tree do Next (`src/app/conjunto/`, `src/components/set-editor/` já
existem sem backend que os alimente).

Ordenado por **o que destrava mais coisa primeiro** — não pela ordem numérica do
contrato.

> **Atualização desta leva:** os itens 1 (`POST /rooms`) e 3 (perfil) da versão
> anterior desta lista foram implementados e saíram daqui. O que era "o único
> bloqueador entre o front e uma demonstração ponta a ponta" não é mais: dá para
> criar sala pela UI, sem SQL manual. O bloqueador passou a ser a seção 5 — e por
> um motivo novo, descrito no item 1 abaixo.
>
> **Depois disso:** `GET /rooms/{code}/queue` foi implementado fora de ordem,
> porque a falta dele estava **derrubando a tela de lobby do líder** — a página
> busca a fila durante o render no servidor, então o `404` do roteador virava
> erro de render, e não um bloco vazio. O item 3 abaixo encolheu para as
> mutações.

---

## 1. Seção 5 — Conjuntos de fases (biblioteca + editor)

**Por quê primeiro:** é o maior bloco de UI parado esperando API
(`src/app/conjunto/`, `src/components/set-editor/`, `src/lib/actions/phaseSets.ts`
— todos no working tree, não commitados). E, desde esta leva, ele bloqueia mais
do que a própria tela: **sem rota de criação de conjunto, não existe `PhaseSet`
no banco**, então o `setId` do `POST /rooms` e a lista `sets` do perfil só têm o
que mostrar se alguém semear via SQL. Duas rotas prontas estão andando meio
vazias por falta desta.

**Rotas:** `GET /phase-sets`, `GET /phase-sets/{id}/draft`, `POST /phase-sets`,
`PUT /phase-sets/{id}/draft`, `PATCH /phase-sets/{id}`, `DELETE /phase-sets/{id}`.

**O que já está pronto e é para reusar, não reescrever:**
- `PhaseSetSummaryDto` + `PhaseSetSource` (`Contracts/PhaseSets/`) — é o mesmo
  formato que o `GET /phase-sets` devolve. Cuidado com a semântica já decidida:
  `source` é **relativo a quem olha**, não é atributo do conjunto.
- `LabelFormatter.EditedLabel` — o `updatedLabel` ("editado há 2 dias") já sai
  formatado e testado.
- `RoomQueueService.AppendSetAsync` — a cópia conjunto → fila, para o item 3.

**O que fica para depois, de propósito:** `POST /phase-sets/phases/generate`
(geração por IA) depende de escolher um provedor/modelo — pode ficar de fora da
primeira fatia sem travar o resto do editor (o front deveria degradar
graciosamente sem o botão "Gerar com IA", não é um requisito de bloqueio).

**Atenção ao contrato:** `Phase` (visão de partida, gabarito escondido) e
`DraftPhase` (visão de editor, gabarito visível) são formatos **diferentes** da
mesma entidade — não é só filtrar campos de um DTO único, os dois têm shape
diferente por `kind` (ver tabela na seção 5 do contrato). Esta é a primeira leva
que precisa de fato **entender** o `ContentJson`: até agora ele foi só gravado e
copiado literal.

---

## 2. Escrever `audience` em algum lugar

**Por quê está na lista:** `users.Audience` existe no schema e sai em
`GET /session` e no perfil, mas **nenhuma rota escreve o campo** — toda conta
nasce `teacher`. É um dado do contrato servido com valor fixo, e o front já
decide vocabulário com ele ("Participantes" vs. "Candidatos"), então um recrutador
vê a tela errada hoje.

**É pouco código, mas precisa de decisão de produto antes:** onde a pessoa
escolhe? O contrato não tem esse campo nem no corpo do `POST /auth/signup` nem no
do `PATCH /users/me`, e não há tela desenhada que pergunte. As opções são
acrescentar o campo a uma dessas duas rotas (mudança de contrato, pequena) ou
criar o passo de onboarding que falta (mudança de produto, maior).

---

## 3. Seção 6 — Mutações da fila de fases (líder)

**Por quê depois da seção 5, não antes:** toda a fila é "cópia de fases de um
`PhaseSet`" — sem endpoints de conjunto, não há o que copiar. A leitura furou
essa ordem porque quebrava tela; as mutações não têm essa urgência.

**A leitura já está pronta:** `GET /rooms/{code}/queue`
(`Endpoints/RoomQueueEndpoints.cs`), rota de líder, fila vazia respondendo `200`
com duas listas vazias. As decisões de formato que ela fixou — `setId` é o id da
linha da fila e não o do `PhaseSet` de origem, duas listas paralelas, ordem pelo
`OrderIndex` da fase — valem para o resto da seção; ver
`api-implementation-status.md` §2.

**E metade da escrita também:** `RoomQueueService.AppendSetAsync` já resolve a
paleta de 8 cores sem repetir na sala, o limite de 8 conjuntos
(`TOO_MANY_SETS`), a ordenação contínua entre conjuntos e a cópia literal do
`ContentJson`. `POST /rooms/{code}/queue/sets` deve chamar esse mesmo método — se
reimplementar, a sala criada com conjunto e a sala que recebeu o conjunto depois
passam a divergir.

**O que falta:** `POST`/`DELETE`/`PATCH` de conjunto, `PATCH`/`DELETE` de fase,
`PUT /queue/order` e o `GET /queue/phases/{phaseId}` do modal "Ver desafio" — a
única rota da seção que devolve gabarito, e a primeira que precisa **entender** o
`ContentJson` por `kind` (mesma dependência do item 1).

**Atenção:** todas as mutações devolvem a fila inteira recalculada (não é
REST "puro" por design — é para não haver refetch por clique). Esse corpo de
resposta já existe: `RoomQueueService.GetQueueAsync(roomId, ct)`, a sobrecarga
sem checagem de acesso, escrita justamente para isso.

**Uma decisão que a primeira mutação vai ter que tomar:** `PUT /queue/order`
responde `409 QUEUE_MISMATCH` quando a lista de ids não bate com a fila atual —
é o primeiro controle de concorrência otimista do projeto, e o contrato não diz
se a comparação é pelo conjunto de ids enviado ou por um número de revisão. O
`websocket-contract.md` §5 já manda `revision` no `queue.updated`, mas **nada no
schema guarda essa revisão hoje**.

---

## 4. Decisão de arquitetura do realtime — travando, mesmo sem endpoint novo

**Por quê isto entra na lista de curto prazo mesmo não sendo uma rota:** as
seções 3–4 já implementadas têm `// TODO(realtime)` no código esperando esta
decisão, e cada seção nova (5, 6, 7...) vai adicionar mais pontos de publicação
pendentes. Adiar essa decisão só aumenta a dívida.

**O que precisa ser decidido** (nenhuma opção foi escolhida ainda, ver
`websocket-contract.md`, nota de proveniência):
1. Broker: Redis Pub/Sub (mais simples de operar) vs. Cloud Pub/Sub.
2. Quem chama o broker: a própria API .NET publica direto após o `SaveChanges`,
   ou existe uma fila intermediária/webhook?
3. Iniciar o projeto do serviço de WebSocket em si — hoje **não existe nenhum
   código** para ele, só o contrato de protocolo.

**Sugestão de escopo mínimo para desbloquear:** não é preciso implementar o
serviço de WS inteiro agora. Bastaria (a) decidir o broker, (b) fazer a API
.NET publicar nos 3 pontos já marcados com `TODO(realtime)`, para que quando o
serviço de WS existir, ele já tenha eventos para consumir.

---

## 5. Rate limiting: IP real, e agora também `POST /rooms`

Duas lacunas na mesma área:

- `contract/api-lobby-log.md` §7 documenta que o rate limit de força bruta no código
  da sala particiona por código, não por cliente — porque toda chamada vem do
  servidor do Next, então todo mundo chega do mesmo IP. Fechar isso exige o
  servidor do Next repassar o IP do browser (`x-forwarded-for` ou equivalente) e
  a API confiar nesse header quando vier junto do `x-service-token`. **Não está
  decidido no contrato ainda** — precisa alinhamento entre quem mantém o Next e
  quem mantém a API antes de codar.
- **`POST /rooms` não tem rate limit nenhum.** É novo desta leva e é a primeira
  rota que *cria* registro sem limite: uma conta em loop enche a tabela de salas
  e, junto com o item 6 abaixo, consome o espaço de códigos de 6 dígitos
  permanentemente. Partição natural é o `userId`, que a rota já exige — não
  depende da decisão de IP acima.

---

## 6. `Room.ExpiresAt` — preencher o campo que já existe

A coluna existe no schema desde a base inicial e a busca por código já respeita
ela (`GetActiveRoomAsync` ignora sala expirada), mas nada a preenche ainda.
Curto prazo porque é pouco código (calcular e gravar `ExpiresAt` no momento
certo — criação da sala? início da partida? fim da partida?) e destrava:
- reciclagem de código de 6 dígitos funcionando de verdade;
- a sessão de convidado "expirar junto com a sala" (hoje é 4h fixas, um desvio
  conhecido do contrato registrado em `api-lobby-log.md` §4).

**Subiu de prioridade nesta leva.** Enquanto não havia `POST /rooms`, isto era
teórico: as salas eram semeadas à mão. Agora cada sala criada segura um código de
6 dígitos **para sempre**, porque a busca por código livre só ignora sala
expirada e nada expira. O `POST /rooms` deliberadamente **não** preenche
`ExpiresAt` na criação — o contrato sugere TTL a partir do *fim* da partida, e
cravar 24h da criação mataria uma sala que ainda nem começou. A decisão continua
sendo "em que momento", e agora ela tem custo acumulando.

---

## O que fica deliberadamente fora do curto prazo

Registrado aqui para não ser esquecido, mas não é a próxima coisa a fazer:

- **Seções 7–9 (partida, respostas, comparação)** — maior fatia restante, mas
  depende de decisões de produto que as seções anteriores não têm (IA para
  corrigir `text`, sandbox de execução para `code`). Só faz sentido atacar
  depois que conjuntos + fila (itens 1 e 3) existirem de ponta a ponta.
  **Efeito colateral conhecido:** enquanto não existir, `matches` do
  `GET /users/{id}/profile` responde `[]` sempre — a rota está pronta, o dado é
  que não nasce.
- **Seção 10 (painel do líder)** — depende inteiramente da seção 7 existir
  primeiro (não há fase corrente para ter estatística de).
- **Seção 11 (relatórios)** — o próprio contrato registra que não há tela
  pronta ainda. Note que os números do relatório resumido (`accuracyRate`,
  `durationLabel`, `avgScore`) já são calculados no `UserProfileService` para a
  linha do histórico — a rota de relatório deveria ler do mesmo lugar, não
  recalcular.
- **OAuth (`POST /auth/oauth/{provider}/authorize`)** — precisa decisão de
  produto (quais provedores: Google/Microsoft/GitHub) antes de qualquer código.
- **Cache HTTP** (`phase-sets` 60s, `marketing/landing` 300s) — sem valor até
  as rotas que ele cachearia existirem.
- **Job de limpeza de TTL** — depende do item 6 acima estar resolvido primeiro.
- **`400 VALIDATION_ERROR` para corpo JSON malformado** — hoje todas as rotas
  respondem `500 INTERNAL_ERROR` nesse caso (ver `api-implementation-status.md`
  §3). Não é urgente porque o front é tipado e nunca produz esse corpo, mas o
  conserto é um `IExceptionHandler` para `BadHttpRequestException`.
- **Rota para o participante sair sozinho** — lacuna 2 do `api-lobby-log.md` §10,
  ainda de pé: só o líder remove, então quem fecha a aba ocupa vaga para sempre.
