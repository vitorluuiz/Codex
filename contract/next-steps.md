# Próximos passos (curto prazo)

Baseado em: `contract/api-rest-contract.md`, `contract/websocket-contract.md`,
`contract/api-implementation-status.md`, e as listas "o que falta" de
`contract/api-init-log.md` §8, `contract/api-lobby-log.md` §12,
`contract/websocket-implementation-log.md` §4 e `contract/api-phases-log.md` §8.

Ordenado por **o que destrava mais coisa primeiro** — não pela ordem numérica do
contrato.

> **Atualização desta leva:** a **seção 5 inteira** (biblioteca de conjuntos +
> editor) foi implementada e saiu daqui, menos a geração por IA — que ficou de
> fora de propósito e virou o item 5. Com isso some a última dependência de dado
> semeado por SQL: dá para criar conjunto, criar sala com ele e ver a fila, tudo
> pela UI. O que era o item 1 desta lista há duas levas ("o maior bloco de UI
> parado esperando API") não existe mais.
>
> **Também saiu:** o antigo item 4 (decisão de arquitetura do realtime). As três
> decisões que ele listava foram tomadas e o serviço existe —
> `contract/websocket-implementation-log.md`. O que sobrou dele está no item 1
> (a revisão da fila) e na lista do fim (eventos de partida sem produtor).

---

## 1. Seção 6 — mutações da fila de fases (líder)

**Por quê primeiro:** é a única seção pela metade, é a tela que o líder usa antes
de toda partida, e **não tem mais nenhuma dependência pendente** — a leitura já
existe, a cópia conjunto → fila já existe, e os conjuntos que ela copia agora
nascem pela UI.

**O que já está pronto e é para reusar, não reescrever:**
- `GET /rooms/{code}/queue` (`Endpoints/RoomQueueEndpoints.cs`) e as decisões de
  formato que ela fixou: `setId` é o id da linha da fila e não o do `PhaseSet` de
  origem, duas listas paralelas, ordem pelo `OrderIndex` da fase. Ver
  `api-implementation-status.md` §2.
- `RoomQueueService.AppendSetAsync` — resolve a paleta de 8 cores sem repetir na
  sala, o limite de 8 conjuntos (`TOO_MANY_SETS`), a ordenação contínua entre
  conjuntos e a cópia literal do `ContentJson`. `POST /rooms/{code}/queue/sets`
  **deve chamar esse mesmo método**: se reimplementar, a sala criada com conjunto
  e a sala que recebeu o conjunto depois passam a divergir.
- `RoomQueueService.GetQueueAsync(roomId, ct)` — a sobrecarga sem checagem de
  acesso, escrita justamente para ser o corpo de resposta das mutações ("todas as
  mutações desta seção devolvem a fila inteira recalculada" — não é REST "puro"
  por design, é para não haver refetch por clique).
- `Services/PhaseContent.cs` — o formato do `ContentJson`, agora que a seção 5 o
  escreve de verdade.

**O que falta:** `POST`/`DELETE`/`PATCH` de conjunto, `PATCH`/`DELETE` de fase,
`PUT /queue/order` e o `GET /queue/phases/{phaseId}` do modal "Ver desafio".

**As duas coisas que esta seção vai ter que decidir:**

1. **A conversão `DraftPhase` → `Phase`.** O `GET /queue/phases/{phaseId}` é a
   única rota da seção que devolve gabarito, e o `ContentJson` guarda a forma de
   *autoria* (decisão da seção 5, `api-phases-log.md` §2). Alguém precisa escrever
   a conversão: quebrar o enunciado do `fill` em `segments`, dar id a cada
   alternativa do quiz, resolver `languages` do `code`. É a mesma conversão que a
   seção 7 vai precisar — escreva num lugar só.
2. **`PUT /queue/order` responde `409 QUEUE_MISMATCH`** quando a lista de ids não
   bate com a fila atual. É o primeiro controle de concorrência otimista do
   projeto, e o contrato não diz se a comparação é pelo conjunto de ids enviado ou
   por um número de revisão. O `websocket-contract.md` §5 já manda `revision` no
   `queue.updated`, mas **nada no schema guarda essa revisão hoje** — e é esta
   seção que precisa publicar esse evento (é o único do §5 sem produtor que não
   depende das seções 7–10).

---

## 2. `Room.ExpiresAt` — preencher o campo que já existe

A coluna existe no schema desde a base inicial e a busca por código já respeita
ela (`GetActiveRoomAsync` ignora sala expirada), mas nada a preenche. É pouco
código (calcular e gravar `ExpiresAt` no momento certo) e destrava:

- reciclagem de código de 6 dígitos funcionando de verdade;
- a sessão de convidado "expirar junto com a sala" (hoje é 4 h fixas, um desvio
  conhecido do contrato registrado em `api-lobby-log.md` §4).

**O custo está acumulando.** Enquanto não havia `POST /rooms`, isto era teórico:
as salas eram semeadas à mão. Agora cada sala criada segura um código de 6 dígitos
**para sempre**, porque a busca por código livre só ignora sala expirada e nada
expira. O `POST /rooms` deliberadamente **não** preenche `ExpiresAt` na criação —
o contrato sugere TTL a partir do *fim* da partida, e cravar 24 h da criação
mataria uma sala que ainda nem começou. A decisão continua sendo "em que momento".

---

## 3. Dois campos do contrato que nenhuma rota escreve

Mesma forma de problema, duas ocorrências: o schema tem a coluna, o `GET` serve o
valor, a UI decide coisas com ele — e **nada nunca o muda**.

- **`users.Audience`** (`"teacher" | "recruiter"`): toda conta nasce `teacher`. O
  front já troca vocabulário com ele ("Participantes" vs. "Candidatos"), então um
  recrutador vê a tela errada hoje. O contrato não tem o campo nem no corpo do
  `POST /auth/signup` nem no do `PATCH /users/me`, e não há tela que pergunte. As
  opções são acrescentar o campo a uma dessas duas rotas (mudança de contrato,
  pequena) ou criar o passo de onboarding que falta (mudança de produto, maior).
- **`phase_sets.Visibility`**: todo conjunto nasce `Private` e não há rota que
  publique na comunidade. Consequência direta: a aba "Comunidade" do seletor de
  conjuntos responde `[]` em qualquer instalação, embora
  `GET /phase-sets?scope=community` esteja implementado e testado. O contrato não
  define essa rota — o `PATCH /phase-sets/{setId}` "só renomeia".

Os dois precisam de **decisão de produto antes de código**, e por isso estão
juntos aqui em vez de espalhados.

---

## 4. Rate limiting: IP real, e três rotas de escrita sem limite nenhum

- `contract/api-lobby-log.md` §7 documenta que o rate limit de força bruta no
  código da sala particiona por código, não por cliente — porque toda chamada vem
  do servidor do Next, então todo mundo chega do mesmo IP. Fechar isso exige o
  servidor do Next repassar o IP do browser (`x-forwarded-for` ou equivalente) e a
  API confiar nesse header quando vier junto do `x-service-token`. **Não está
  decidido no contrato ainda** — precisa alinhamento entre quem mantém o Next e
  quem mantém a API antes de codar.
- **`POST /rooms`, `POST /phase-sets` + `PUT /phase-sets/{setId}/draft`, e
  `POST /realtime-ticket` não têm rate limit nenhum.** As três primeiras criam ou
  reescrevem registro em massa (uma conta em loop enche a tabela de salas e, junto
  com o item 2, consome o espaço de códigos de 6 dígitos permanentemente; um loop
  no editor grava fases sem teto), e a última emite credencial. A partição natural
  das quatro é o `userId`/sessão, que todas exigem — **não depende** da decisão de
  IP acima.

---

## 5. `POST /phase-sets/phases/generate` — a última rota da seção 5

Ficou de fora da leva da seção 5 de propósito: depende de escolher provedor e
modelo de IA, decisão que ninguém tomou. O editor degrada sem ela — some o botão
"Gerar com IA" e o resto da tela funciona —, então nunca foi bloqueio.

Duas coisas facilitam quando alguém pegar: a fase gerada **não é persistida**
(volta como `DraftPhase` com `fromAI: true` e só vai ao banco quando o autor salvar
o conjunto, então a rota não toca no `PhaseSetService`), e `fromAI` já trafega
intacto pelo save, com teste. Ou seja: é uma rota que só chama o modelo e monta um
`DraftPhaseDto`.

É também a primeira das três decisões de IA do produto — as outras duas são a
correção de resposta `text` e o sandbox de execução do `code` (seções 8–9).
Escolher provedor aqui provavelmente escolhe para as outras.

---

## O que fica deliberadamente fora do curto prazo

Registrado aqui para não ser esquecido, mas não é a próxima coisa a fazer:

- **Seções 7–9 (partida, respostas, comparação)** — maior fatia restante, mas
  depende de decisões de produto que as seções anteriores não têm (IA para
  corrigir `text`, sandbox de execução para `code`). Só faz sentido atacar depois
  que as mutações da fila (item 1) existirem.
  **Efeito colateral conhecido:** enquanto não existir, `matches` do
  `GET /users/{id}/profile` responde `[]` sempre — a rota está pronta, o dado é
  que não nasce.
- **Os eventos de partida do realtime não têm produtor.** `phase.started`,
  `stats.updated`, `submission.graded`, `match.finished` e companhia já têm
  transporte, canal, throttle e autorização implementados e testados no serviço de
  WS; o que falta é a rota REST que os dispare, o que é exatamente o item acima.
  Não há decisão pendente aqui, só código que depende de outro código.
- **Seção 10 (painel do líder)** — depende inteiramente da seção 7 existir
  primeiro (não há fase corrente para ter estatística de).
- **Seção 11 (relatórios)** — o próprio contrato registra que não há tela pronta
  ainda. Note que os números do relatório resumido (`accuracyRate`,
  `durationLabel`, `avgScore`) já são calculados no `UserProfileService` para a
  linha do histórico — a rota de relatório deveria ler do mesmo lugar, não
  recalcular.
- **OAuth (`POST /auth/oauth/{provider}/authorize`)** — precisa decisão de produto
  (quais provedores: Google/Microsoft/GitHub) antes de qualquer código.
- **Cache HTTP** (`phase-sets` 60 s, `marketing/landing` 300 s) — deixou de ser
  hipotético: a rota que ele cachearia existe agora. Continua fora porque nenhuma
  rota do projeto tem cabeçalho de cache, e fazer só esta criaria um padrão de um
  item só.
- **Job de limpeza de TTL** — depende do item 2 acima estar resolvido primeiro.
- **`400 VALIDATION_ERROR` para corpo JSON malformado** — hoje todas as rotas
  respondem `500 INTERNAL_ERROR` nesse caso (ver `api-implementation-status.md`
  §3). Não é urgente porque o front é tipado e nunca produz esse corpo, mas o
  conserto é um `IExceptionHandler` para `BadHttpRequestException`. Ganhou uma
  ocorrência nova com a seção 5: `kind` fora dos quatro valores conhecidos estoura
  no conversor de enum, antes de qualquer validação do app.
- **Rota para o participante sair sozinho** — lacuna 2 do `api-lobby-log.md` §10,
  ainda de pé: só o líder remove, então quem fecha a aba ocupa vaga para sempre.
