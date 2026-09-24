# Próximos passos (curto prazo)

Baseado em: `contract/api-rest-contract.md`, `contract/websocket-contract.md`,
`contract/api-implementation-status.md`, e as listas "o que falta" de
`contract/api-init-log.md` §8, `contract/api-lobby-log.md` §12,
`contract/websocket-implementation-log.md` §4, `contract/api-phases-log.md` §8,
`contract/api-queue-log.md` §7, `contract/api-resume-log.md` §7 e
`contract/api-match-log.md` §12.

Ordenado por **o que destrava mais coisa primeiro** — não pela ordem numérica do
contrato.

> **Atualização desta leva: as seções 7 a 10 foram implementadas** (`api-match-log.md`)
> — partida, respostas, comparação e painel do líder. Era "a maior fatia restante, e
> agora a única grande" desta lista, e saiu daqui. **Uma aula de quiz/fill roda do
> lobby ao pódio pela UI.** O que ela muda nesta lista:
>
> - **o item 1 encolheu**: `POST /matches/{id}/finish` grava `Room.ExpiresAt` =
>   `finishedAt + 24 h`, então o caminho feliz do TTL funciona e a sala encerrada some
>   sozinha de `GET /rooms/active`. Sobra a **sala abandonada**, que nunca teve
>   partida e por isso não tem instante de "fim" onde pendurar o TTL;
> - **`matches` do perfil deixou de sair vazio** — acendeu sozinha, sem tocar no
>   `UserProfileService`, como estava previsto;
> - **os eventos de partida ganharam produtor**; sobram `submission.graded` (depende
>   da IA) e `player.activity` (nasce no cliente);
> - **o item 3 não cresceu**: `POST …/submissions` já é limitado a um por pessoa por
>   fase pelo índice único do banco, e o resto da fatia é leitura;
> - **três consertos de front** entraram na lista do fim, junto do bug do `SetPicker`.
>
> Ficaram fora, por decisão: `POST …/run` (sandbox), a correção de `text`/`code` (IA)
> e o modo `self-paced` — que hoje responde `409 MODE_NOT_AVAILABLE` porque **não
> existe caminho de avanço para o aluno nem no contrato, nem no front, nem no serviço
> de WS** (`api-match-log.md` §7.2).
>
> **Leva de correção sobre ela** (`api-match-log.md` §11), depois de a partida rodar de
> verdade: a partida passou a **encerrar sozinha quando a fila acaba**, a fase vencida
> passa a fechar por um cutucão do cliente (mantendo a decisão de não ter job), o pódio
> sobrevive ao F5 e o envio atrasado virou "Tempo esgotado" em vez de erro. Isso trouxe
> uma coluna nova (`Participant.InResultsSince`, migration `ParticipantInResults`) e uma
> rota que o contrato não tem, `POST /rooms/{code}/participants/me/return`: encerrar
> deixou de arrastar a turma ao lobby, então o lobby precisa saber quem ainda não voltou —
> e quem não voltou **não conta como jogador** da partida seguinte.
>
> **Segunda rodada, só de tela** (`api-match-log.md` §11.7): o encerramento automático
> funcionava no banco e a tela o desfazia — a continuação do envio que fechou a última
> fase apagava o pódio que os eventos já tinham posto ali. O pódio virou **terminal** no
> `ChallengeShell`, e o fim da partida deixou de depender do WebSocket: o cliente busca
> `GET …/podium` sozinho quando a última fase fecha, e o corpo de `POST …/finish` — que a
> rota sempre devolveu — passou a ser usado em vez de descartado.
>
> **Terceira rodada** (`api-match-log.md` §11.8): encerrar a partida marcava a **sala**
> como `Finished`, um estado terminal que some de `/rooms/active`, recusa entrada e trava
> a fila. Deliberado, passava; automático, matava a sala a cada partida — e a segunda
> partida batia em `MATCH_ALREADY_STARTED` sem caminho de volta. Encerrar passou a encerrar
> só a partida; `RoomStatus.Finished` **voltou a não ter escritor**, e "encerrar a sala"
> vira item de produto.
>
> **Atualização da leva anterior:** `GET /rooms/active` entrou (`api-resume-log.md`), e
> com ela **sair da página deixou de ser caminho sem volta**: o líder retoma pelo
> perfil e qualquer um retoma pela tela de entrar, sem digitar o código. É a
> primeira rota que este projeto acrescentou ao contrato em vez de implementar —
> nenhuma seção cobria "voltar para a sala". Não trouxe migration nem bloqueio
> novo; encareceu o item 1 abaixo (sala abandonada agora vira linha na tela) e
> tirou a aba "Perfil de participante" da categoria "precisa de rota nova".
>
> **Atualização de duas levas atrás:** a **seção 6 inteira** foi implementada e saiu daqui
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

---

## 1. `Room.ExpiresAt` — falta a **sala abandonada**

Metade deste item saiu com a seção 7. `POST /matches/{id}/finish` grava
`ExpiresAt = finishedAt + 24 h`, que é exatamente o TTL que a seção 13 sugere, e é o
primeiro (e único) lugar do sistema que escreve esse campo. Com isso, a sala que
**terminou uma partida** expira, o código de 6 dígitos volta a circular, e ela some
sozinha de `GET /rooms/active` — que já ignorava `Status == Finished`.

**O que sobrou é a sala que nunca começou.** Quem cria uma sala e fecha a aba (ou
volta ao lobby e some) continua segurando um código para sempre, porque não existe
instante de "fim" para pendurar o TTL. É o caso que ainda vira uma linha de "Voltar
para a sala" no perfil do líder; o teto de 10 linhas daquela rota continua sendo
contorno (`api-resume-log.md` §4).

A decisão que falta é **qual prazo vale para uma sala sem partida**. Um TTL a partir
de `CreatedAt` (24 h?) é o candidato óbvio, e agora é seguro de um jeito que não era
antes: com a seção 7 no ar, `finish` reescreve `ExpiresAt` quando a partida acaba,
então cravar um prazo na criação não mata mais uma aula que estava só demorando a
começar — que era exatamente a objeção que segurava este item.

Ainda destrava a sessão de convidado "expirar junto com a sala" (hoje 4 h fixas, um
desvio conhecido registrado em `api-lobby-log.md` §4), e continua sendo pré-requisito
do job de limpeza.

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
correção de resposta `text` e o sandbox de execução do `code` (seção 8, e as duas
únicas coisas que faltam para as seções 7–10 estarem completas). Escolher provedor
aqui provavelmente escolhe para as outras.

---

## O que fica deliberadamente fora do curto prazo

Registrado aqui para não ser esquecido, mas não é a próxima coisa a fazer:

- **O modo `self-paced`** — o único pedaço das seções 7–10 que ficou de fora por
  motivo estrutural, e não por IA. Hoje `POST /rooms/{code}/match` responde
  `409 MODE_NOT_AVAILABLE`, porque **não existe caminho de avanço para o aluno em
  lugar nenhum**: a seção 10 lista `advance` como rota de líder,
  `Match.CurrentPhaseIndex` é um número só, o front não tem chamada que avance a si
  mesmo, e a allowlist de `realtime/src/channels.ts` descartaria um `phase.started`
  no canal privado. Custa uma coluna (`Participant.CurrentPhaseIndex`), um
  significado por modo para `POST …/ready`, e **mudança no projeto Node** — que é o
  que o separa do resto. Enquanto isso, o botão "Permitir início" do lobby precisa
  ficar desabilitado.
- **`POST …/run` e a correção de `text`/`code`** — as duas dependem das decisões de
  IA e sandbox do item 4. Sem elas, `text` e `code` são aceitos e ficam em
  `grading: "pending"` para sempre, que é o estado que o contrato descreve; e o botão
  "Executar" da tela de código precisa ser escondido, como já se faz com "Gerar com
  IA". Junto vem o produtor de `submission.graded`, o único evento de partida do
  contrato de WS que continua sem um.
- **Três consertos de front ainda abertos** (`api-match-log.md` §12), todos mudança de
  UI e nenhum de API:
  1. `/sala/{code}/partida` aberto direto pela URL numa sala **sem partida** quebra o
     render — `GET /rooms/{code}/match` responde `404 MATCH_NOT_FOUND` e a página não
     trata. É a mesma forma do defeito que já derrubou o lobby do líder uma vez;
  2. o botão de `self-paced` precisa ficar desabilitado enquanto o modo responder 409;
  3. o feedback individual mostra "Sua resposta foi registrada." em vez da resposta
     certa, porque o estado da fase foi carregado com ela ainda aberta (a "regra de
     ouro" impede o gabarito de sair antes). O conserto é refazer o `GET` ao receber
     `phase.ended` — o caminho de "Tempo esgotado" já faz isso e recebe o gabarito
     junto, mas quem respondeu a tempo continua com o estado antigo. A resposta certa
     já aparece um clique depois, na comparação.
- **O `SetPicker` do lobby manda o id errado para remover conjunto da fila.** É
  bug de front, não de API, e por isso não foi corrigido junto:
  `PhaseSetsPanel.tsx` chama `removeSetFromQueueAction` com o id do `PhaseSet` de
  origem onde a rota espera o id da linha da fila (o painel ao lado usa o certo).
  Hoje isso vira um `404 PHASE_SET_NOT_FOUND` — nada é apagado por engano —, e o
  check "já adicionado" nunca aparece no seletor. Consertar exige decidir se o
  seletor é *toggle* (e o payload da fila precisa expor o id de origem) ou só
  adiciona. Detalhe em `api-queue-log.md` §7.
- ~~**Seção 10 (painel do líder)**~~ — saiu desta lista: entrou **junto** com a seção
  7, e não depois dela como este item previa. O motivo é que a tela de partida busca
  `GET …/stats` no render do servidor, sem `try/catch` — sem a rota, o líder não
  abriria a tela de jeito nenhum (`api-match-log.md` §2).
- **Seção 11 (relatórios)** — o próprio contrato registra que não há tela pronta
  ainda. Note que os números do relatório resumido (`accuracyRate`,
  `durationLabel`, `avgScore`) já são calculados no `UserProfileService` para a
  linha do histórico — a rota de relatório deveria ler do mesmo lugar, não
  recalcular.
- ~~**OAuth (`POST /auth/oauth/{provider}/authorize`)**~~ — saiu desta lista: os três
  provedores entraram (`api-oauth-log.md`). O que ficou de fora de propósito é a tela de
  gerenciamento de vínculos no perfil — hoje dá para conectar um provedor, não para ver nem
  desconectar os que já estão. Enquanto ela não existe, quem entrou por provedor e nunca
  cadastrou senha depende do provedor para sempre.
- **Cache HTTP** (`phase-sets` 60 s, `marketing/landing` 300 s) — deixou de ser
  hipotético: a rota que ele cachearia existe agora. Continua fora porque nenhuma
  rota do projeto tem cabeçalho de cache, e fazer só esta criaria um padrão de um
  item só.
- **Job de limpeza de TTL** — depende do item 1 acima estar resolvido primeiro.
  Ganhou meio motivo a mais para existir: agora **há** salas com `ExpiresAt`
  preenchido (as que terminaram partida), e nada as apaga — elas só somam a ser
  ignoradas pelas consultas.
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
