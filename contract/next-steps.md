# Próximos passos (curto prazo)

Baseado em: `contract/api-rest-contract.md`, `contract/websocket-contract.md`,
`contract/api-implementation-status.md`, e as listas "o que falta" de
`contract/api-init-log.md` §8, `contract/api-lobby-log.md` §12,
`contract/websocket-implementation-log.md` §4, `contract/api-phases-log.md` §8,
`contract/api-queue-log.md` §7 e `contract/api-resume-log.md` §7.

Ordenado por **o que destrava mais coisa primeiro** — não pela ordem numérica do
contrato.

> **Atualização desta leva:** `GET /rooms/active` entrou (`api-resume-log.md`), e
> com ela **sair da página deixou de ser caminho sem volta**: o líder retoma pelo
> perfil e qualquer um retoma pela tela de entrar, sem digitar o código. É a
> primeira rota que este projeto acrescentou ao contrato em vez de implementar —
> nenhuma seção cobria "voltar para a sala". Não trouxe migration nem bloqueio
> novo; encareceu o item 1 abaixo (sala abandonada agora vira linha na tela) e
> tirou a aba "Perfil de participante" da categoria "precisa de rota nova".
>
> **Atualização da leva anterior:** a **seção 6 inteira** foi implementada e saiu daqui
> (era o item 1) — `contract/api-queue-log.md`. Com ela, **as seções 2 a 6 do
> contrato estão completas**, exceto OAuth e a geração de fase por IA. O lobby do
> líder funciona ponta a ponta pela UI: criar conjunto, criar sala, adicionar,
> reordenar, ajustar pontos e ver o desafio.
>
> Duas coisas que ela produziu e que mudam a lista:
> - a conversão `DraftPhase → Phase` existe (`Services/PhaseProjection.cs`), então
>   a seção 7 não precisa mais escrevê-la;
> - `queue.updated` ganhou produtor e `rooms.QueueRevision` guarda a revisão, o que
>   fecha a lacuna que `websocket-implementation-log.md` §4 registrava.
>
> **O próximo grande bloco são as seções 7–9** (partida, respostas, comparação),
> que continuam fora do curto prazo pelo mesmo motivo de sempre: dependem de
> decisões de produto sobre IA e sandbox (itens 4 e a lista do fim).

---

## 1. `Room.ExpiresAt` — preencher o campo que já existe

A coluna existe no schema desde a base inicial e a busca por código já respeita
ela (`GetActiveRoomAsync` ignora sala expirada), mas nada a preenche. É pouco
código (calcular e gravar `ExpiresAt` no momento certo) e destrava:

- reciclagem de código de 6 dígitos funcionando de verdade;
- a sessão de convidado "expirar junto com a sala" (hoje é 4 h fixas, um desvio
  conhecido do contrato registrado em `api-lobby-log.md` §4).

**O custo está acumulando.** Enquanto não havia `POST /rooms`, isto era teórico:
as salas eram semeadas à mão. Agora cada sala criada segura um código de 6 dígitos
**para sempre**, porque a busca por código livre só ignora sala expirada e nada
expira. E desde `GET /rooms/active` o custo saiu do banco e chegou na tela: "sala
ativa" é "sala que ninguém encerrou", então cada sala abandonada vira uma linha de
"Voltar para a sala" que o líder lê no perfil. A rota corta em 10 linhas para o
cartão continuar útil (`api-resume-log.md` §4) — é contorno, não conserto. O `POST /rooms` deliberadamente **não** preenche `ExpiresAt` na criação —
o contrato sugere TTL a partir do *fim* da partida, e cravar 24 h da criação
mataria uma sala que ainda nem começou. A decisão continua sendo "em que momento".

---

## 2. Dois campos do contrato que nenhuma rota escreve

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

## 3. Rate limiting: IP real, e as rotas de escrita sem limite nenhum

- `contract/api-lobby-log.md` §7 documenta que o rate limit de força bruta no
  código da sala particiona por código, não por cliente — porque toda chamada vem
  do servidor do Next, então todo mundo chega do mesmo IP. Fechar isso exige o
  servidor do Next repassar o IP do browser (`x-forwarded-for` ou equivalente) e a
  API confiar nesse header quando vier junto do `x-service-token`. **Não está
  decidido no contrato ainda** — precisa alinhamento entre quem mantém o Next e
  quem mantém a API antes de codar.
- **`POST /rooms`, `POST /phase-sets` + `PUT /phase-sets/{setId}/draft`,
  `POST /realtime-ticket` e as mutações de `/rooms/{code}/queue/*` não têm
  rate limit nenhum.** (`GET /rooms/active` também não, mas é leitura resolvida
  por sessão com teto de 10 linhas — entra junto, sem urgência própria.) As primeiras criam ou reescrevem registro em massa (uma
  conta em loop enche a tabela de salas e, junto com o item 1, consome o espaço de
  códigos de 6 dígitos permanentemente; um loop no editor grava fases sem teto),
  e `realtime-ticket` emite credencial. As da fila são as mais leves da lista —
  exigem líder, então o estrago possível é na própria sala de quem chamou —, mas a
  partição natural de todas é a mesma (`userId`/sessão, que todas exigem) e sai
  numa leva só. **Não depende** da decisão de IP acima.

---

## 4. `POST /phase-sets/phases/generate` — a última rota da seção 5

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

- **Seções 7–9 (partida, respostas, comparação)** — maior fatia restante, e agora
  a única grande. A dependência de código sumiu (a fila existe, e a conversão
  `DraftPhase → Phase` que a seção 7 precisaria escrever já está em
  `Services/PhaseProjection.cs`, com `includeAnswers` para a "regra de ouro"); o
  que segura são decisões de produto que as seções anteriores não têm — IA para
  corrigir `text`, sandbox de execução para `code`.
  **Duas coisas a ler antes de começar:** `api-queue-log.md` §4 (o que a conversão
  deriva com padrão e por quê, e a divergência `correctIndexes` → `correctOptionId`
  que a correção da seção 8 **não** pode ignorar) e §5 (a guarda de `lobby` nas
  mutações da fila, que é a seção 7 que vai fazer disparar de verdade).
  **Efeito colateral conhecido:** enquanto não existir, `matches` do
  `GET /users/{id}/profile` responde `[]` sempre — a rota está pronta, o dado é
  que não nasce.
- **Os eventos de partida do realtime não têm produtor.** `phase.started`,
  `stats.updated`, `submission.graded`, `match.finished` e companhia já têm
  transporte, canal, throttle e autorização implementados e testados no serviço de
  WS; o que falta é a rota REST que os dispare, o que é exatamente o item acima.
  Não há decisão pendente aqui, só código que depende de outro código.
  (`queue.updated` saiu desta lista: as mutações da seção 6 o publicam, e
  `rooms.QueueRevision` guarda o número.)
- **O `SetPicker` do lobby manda o id errado para remover conjunto da fila.** É
  bug de front, não de API, e por isso não foi corrigido junto:
  `PhaseSetsPanel.tsx` chama `removeSetFromQueueAction` com o id do `PhaseSet` de
  origem onde a rota espera o id da linha da fila (o painel ao lado usa o certo).
  Hoje isso vira um `404 PHASE_SET_NOT_FOUND` — nada é apagado por engano —, e o
  check "já adicionado" nunca aparece no seletor. Consertar exige decidir se o
  seletor é *toggle* (e o payload da fila precisa expor o id de origem) ou só
  adiciona. Detalhe em `api-queue-log.md` §7.
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
- **Job de limpeza de TTL** — depende do item 1 acima estar resolvido primeiro.
- **`400 VALIDATION_ERROR` para corpo JSON malformado** — hoje todas as rotas
  respondem `500 INTERNAL_ERROR` nesse caso (ver `api-implementation-status.md`
  §3). Não é urgente porque o front é tipado e nunca produz esse corpo, mas o
  conserto é um `IExceptionHandler` para `BadHttpRequestException`. Ganhou uma
  ocorrência nova com a seção 5: `kind` fora dos quatro valores conhecidos estoura
  no conversor de enum, antes de qualquer validação do app. A seção 6 **não**
  acrescentou ocorrências: os ids dela trafegam como `string` no corpo justamente
  para o erro cair na regra do app (`404`/`409` do contrato) em vez de no
  desserializador — o que é contorno de caso a caso, não o conserto.
- **Rota para o participante sair sozinho** — lacuna 2 do `api-lobby-log.md` §10,
  ainda de pé: só o líder remove, então quem fecha a aba ocupa vaga para sempre.
  É a última peça que falta deste conjunto: fechar a aba já tem volta
  (`GET /rooms/active`) e ser expulso já tem saída (`api-resume-log.md` §9); sair
  por vontade própria é o único dos três sem rota. O caminho de saída inteiro já
  existe — `DELETE /rooms/{code}/participants/{id}` apaga a linha, publica os dois
  eventos, o WS fecha o socket e o front redireciona. O que falta é **quem pode
  chamar**: hoje é rota de líder, e o participante precisaria poder removê-lo a
  si mesmo (ou uma rota irmã que só aceite o próprio id).
- **A aba "Perfil de participante"** continua sendo um placeholder. Deixou de
  precisar de rota nova: `GET /rooms/active` já devolve as salas com
  `role: "participant"`, já reconhece quem entrou logado pelo `UserId` do
  `Participant` (com teste), e o `ProfileView` já filtra por `role` em vez de
  assumir que tudo é do líder. O que falta é decidir o **resto** da aba
  (desafios praticados, pontuação, conquistas — nada disso existe no contrato),
  não a lista de salas. Detalhe em `api-resume-log.md` §7.
