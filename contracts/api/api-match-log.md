# api-match-log.md — A partida (seções 7 a 10)

Registro de decisão da leva que implementou as **fatias A e B** de
`match-implementation-model.md`: começar a partida, a fase corrente, o
envio e a correção, a comparação, o placar, o pódio e os controles do líder.

Mesma convenção dos outros logs desta pasta: o que está aqui é **o que o contrato
não decidia** e o código precisou decidir. O que o contrato já dizia não é repetido.

> **Este log tem um documento irmão.** `match-implementation-model.md` foi escrito
> **antes**, enumerando as decisões em aberto e recomendando uma resposta para cada.
> Este registra o que de fato foi decidido — e a §9 lista onde a implementação
> **divergiu** daquele modelo, que é a parte que vale ler se você leu o outro.

---

## 1. Rotas implementadas

| Seção | Rota | Método do serviço |
|---|---|---|
| 7 | `POST /rooms/{code}/match` | `MatchService.StartAsync` |
| 7 | `GET /rooms/{code}/match` | `MatchService.GetByRoomAsync` |
| 7 | `GET /matches/{id}/current-phase` | `MatchService.GetCurrentPhaseAsync` |
| 8 | `POST …/phases/{phaseId}/submissions` | `SubmissionService.SubmitAsync` |
| 8 | `POST …/phases/{phaseId}/ready` | `SubmissionService.MarkReadyAsync` |
| 9 | `GET …/phases/{phaseId}/comparison` | `SubmissionService.GetComparisonAsync` |
| 9 | `GET /matches/{id}/scoreboard/me` | `SubmissionService.GetScoreboardAsync` |
| 9 | `GET /matches/{id}/podium` | `MatchService.GetPodiumAsync` |
| 10 | `GET …/phases/{phaseId}/stats` | `MatchService.GetStatsAsync` |
| 10 | `POST /matches/{id}/advance` | `MatchService.AdvanceAsync` |
| 10 | `POST /matches/{id}/pause` | `MatchService.SetPausedAsync` |
| 10 | `POST …/phases/{phaseId}/restart` | `MatchService.RestartPhaseAsync` |
| 10 | `POST /matches/{id}/finish` | `MatchService.FinishAsync` |
| 10 | `POST /matches/{id}/return-to-lobby` | `MatchService.ReturnToLobbyAsync` |
| 10 | `DELETE /matches/{id}/participants/{id}` | `MatchService.RemovePlayerAsync` |

Arquivos novos: `Services/MatchAccessService.cs`, `MatchService.cs`,
`SubmissionService.cs`, `MatchStatsService.cs`, `MatchEventPublisher.cs`,
`PhaseGrading.cs`, `SubmissionProjection.cs`, `Endpoints/MatchEndpoints.cs`,
`Contracts/Matches/*` (3 arquivos), e três arquivos de teste
(`MatchLifecycleTests`, `SubmissionTests`, `MatchStatsTests`). Uma migration:
`MatchRuntime`.

**Fora do escopo, por decisão:** `POST …/run` (precisa de sandbox), a correção de
`text`/`code` por IA, e o modo `self-paced` — as três da fatia C.

**O que foi reusado, e não reescrito:** `PhaseProjection.ToPhase` (a conversão
`DraftPhase → Phase` escrita na seção 6 é literalmente o corpo de `current-phase`),
`RoomAccessService` para tudo que entra pelo código da sala, `PhaseContent` para ler
gabarito, `LabelFormatter` para os rótulos dos baldes de tempo, e a guarda
`MATCH_ALREADY_STARTED` da fila — que **esta leva é a primeira a fazer disparar**.

---

## 2. A tela obrigou a seção 10 a entrar junto

`src/app/sala/[code]/partida/page.tsx` busca no servidor, durante o render e sem
`try/catch`: `getRoom` → `getMatch` → `getCurrentPhase` → e então `getPhaseStats`
(líder) ou `getMyScoreboard` (aluno).

É a mesma forma do defeito que `api-implementation-status.md` §2 registrava sobre o
lobby: **rota ausente aqui não degrada um bloco, derruba a página inteira.** Por
isso `GET …/stats` (seção 10) e `GET …/scoreboard/me` (seção 9) entraram na mesma
leva que a seção 7 — sem elas ninguém abre a tela.

O contraste que decidiu o resto do recorte: `comparison` e `podium` são carregados
**sob demanda** (`loadPhaseComparisonAction`, `loadPodiumAction`), não no render.
Eles degradariam uma tela em vez de derrubar a página — e é por isso que poderiam
ter esperado.

---

## 3. O que o schema não tinha: a migration `MatchRuntime`

`Match` modelava a partida, mas não o **estado de execução** dela.

| Coluna | Tabela | Por quê |
|---|---|---|
| `CurrentPhaseStartedAt` | `matches` | minuendo de `elapsedSeconds`, que a seção 8 manda calcular no servidor |
| `CurrentPhaseEndsAt` | `matches` | o `endsAt` absoluto do contrato de WS §6; `null` = pausada |
| `CurrentPhaseEndedAt` | `matches` | torna o fechamento idempotente — ver §4 |
| `PausedSecondsLeft` | `matches` | ao pausar o `endsAt` vira `null` e o instante original não serve para retomar |
| `ReadyAt` | `submissions` | o `readyCount` do painel |

**O que deliberadamente não virou coluna:** qual é a fase corrente (é
`CurrentPhaseIndex` casando com o `OrderIndex` da fila, que fica congelada durante a
partida), "a fase X já fechou?" (derivável), `totalPlayers` e pontuação acumulada.

### `ReadyAt` mora na submissão

No front o botão só é alcançável na tela de comparação coletiva, e só se chega lá
depois de responder — ready sem envio não existe. Uma tabela `match_phase_readies`
descreveria o mesmo fato com uma FK a mais. De brinde, o `restart` "zera envios e
cronômetro" apagando as submissões, e leva os readies junto sem código extra.

**Se um dia der para marcar pronto sem responder, esta decisão precisa virar tabela.**

### Um índice que a tradução Firestore → relacional tinha perdido

O índice único de submissão era `(RoomQueuePhaseId, ParticipantId)`. No Firestore do
contrato o documento mora em
`matches/{matchId}/phases/{phaseId}/submissions/{participantId}` — ou seja, "uma vez"
sempre foi **uma vez por partida**. A migration inicial traduziu sem o escopo.

Consequência que só apareceu agora que existe uma segunda partida: o líder volta ao
lobby, recomeça, e o **primeiro** envio de quem já tinha jogado aquela fase seria
recusado pelo banco — um `500`, e só em Postgres, porque o InMemory dos testes não
tem índice. A chave agora é `(MatchId, RoomQueuePhaseId, ParticipantId)`, e o mesmo
escopo foi dado ao índice de `Score` que serve histograma e pódio. Verificado por
HTTP contra Postgres (§8).

---

## 4. A fase fecha preguiçosamente, e é `CurrentPhaseEndedAt` que faz isso funcionar

**A decisão:** não há job nem timer. `MatchService.CloseExpiredPhaseAsync` é chamado
por quem passar depois do fim do cronômetro — uma leitura de `current-phase`, um
envio, o `advance` do líder.

A idempotência é o ponto todo, e ela precisa de estado: sem `CurrentPhaseEndedAt`,
toda leitura feita depois do fim republicaria `phase.ended`, e uma turma de 28 pessoas
recarregando a página viraria 28 eventos. Com a coluna, só o primeiro publica.

Duas consequências que valem registrar:

- **`current-phase` é uma leitura que grava.** É o preço do modelo preguiçoso, e o
  efeito é limitado a uma coluna de data e a um evento.
- **O fechamento grava o instante contratual** (o próprio `EndsAt`), não "agora": o
  fim da fase é quando o relógio virou, não quando alguém reparou.

**A garantia que de fato importa não depende disso.** Recusar envio atrasado sai da
comparação com `CurrentPhaseEndsAt` no próprio envio — sem job, sem evento, sem
coluna. O fechamento preguiçoso decide só *quando o evento sai*.

**O buraco conhecido:** se o relógio virar e ninguém chamar nada, `phase.ended` não
sai. Em `live` isso é invisível — o contador do aluno é local e o líder é quem move a
partida —, e o evento só move a tela de quem está em `waiting`, que hoje são apenas
`text`/`code` (as duas sem corretor). Um `BackgroundService` fecharia o buraco e não
mudaria nada do que está escrito: viraria mais um chamador do mesmo método.

---

## 5. A regra de ouro segue a fase, não o papel de quem pediu

`includeAnswers` de `PhaseProjection` é `true` **quando a fase fechou**, e `false`
antes disso — para todo mundo, **inclusive o líder**.

O motivo não é zelo: **este mesmo `PhaseStateDto` viaja dentro do `phase.started`**,
que vai por `room:{code}:match`, um canal coletivo. Uma regra por papel aqui viraria
vazamento lá, e a autorização de canal não ajudaria — o canal é legítimo.

O líder não fica sem a resposta: ele a tem pelo modal "Ver desafio"
(`GET /rooms/{code}/queue/phases/{phaseId}`, que a seção 6 deixou sem a guarda de
lobby exatamente para funcionar durante a partida) e pelo `answerDistribution` do
painel, que vai pelo canal dele.

**Efeito colateral na tela, conhecido e não corrigido:** o `QuizFeedback` do aluno lê
`phase.correctOptionId` do estado que ele já tinha carregado. Como a fase estava
aberta quando aquele estado chegou, o campo não veio, e a tela mostra "Sua resposta
foi registrada." em vez de "Resposta correta: 4/6". Um clique depois, a comparação
mostra a resposta certa (`correctAnswerLabel`), que é o caminho que o contrato
desenha. Fechar isso é conserto de front (refazer o `GET` ao receber `phase.ended`).

---

## 6. A correção lê `correctIndexes`, nunca `correctOptionId`

Repetido de `api-queue-log.md` §4 porque é a armadilha mais cara desta fatia, e agora
há teste travando os **dois** lugares onde ela morde:

- **a correção** (`PhaseGrading.IsQuizCorrect`) — corrigir pelo campo singular
  reprovaria quem marcou a segunda alternativa certa;
- **o `answerDistribution` do painel** — marcar só a primeira mostraria ao líder uma
  barra vermelha para uma resposta que o próprio sistema aceitou.

`correctAnswerLabel` do `comparison` lista **todas** as certas ("4/6 / 8/12"): ali não
há campo singular do contrato limitando, e mostrar uma só mentiria para quem marcou a
outra.

---

## 7. As outras decisões, em ordem de quanto custam se estiverem erradas

### 7.1 A partida é o portão que cobra fase completa

`POST /rooms/{code}/match` valida **todas** as fases da fila e recusa com
`409 INCOMPLETE_PHASE` (code novo) nomeando a fase. É o que `api-phases-log.md` já
tinha marcado: "rascunho incompleto salva; quem deveria cobrar fase completa é o
início da partida".

Sem o portão, a correção precisaria de uma regra para gabarito vazio em cada tipo — e
as três respostas possíveis (reprovar todo mundo, aprovar todo mundo, pular a fase)
são erradas de jeitos diferentes. Com ele, a correção assume gabarito presente.

O que conta como incompleta: enunciado vazio; `quiz` com menos de duas alternativas ou
sem índice correto válido; `fill` sem lacuna ou com lacuna sem palavra; `text` sem
`expectedAnswer`; **`code` sem `testCases`** — e não sem `expectedAnswer`, porque quem
corrige código são os testes, e são eles também que viram os exemplos da tela.

Todas as fases, e não só a primeira: descobrir na fase 6 seria descobrir no meio da aula.

### 7.2 `self-paced` é recusado com `409 MODE_NOT_AVAILABLE`

O modo está no contrato e o lobby tem o botão, mas **não existe caminho de avanço para
o aluno em lugar nenhum**: a seção 10 lista `advance` como rota de líder,
`Match.CurrentPhaseIndex` é um número só para a partida inteira, o front não tem
chamada que avance a si mesmo, e a allowlist do serviço de WS
(`realtime/src/channels.ts`) **descartaria** um `phase.started` no canal privado — ou
seja, `self-paced` custa também mudança no projeto Node.

Rodar como "live" prometendo o contrário é pior que recusar. **Falta o ajuste de
front** (desabilitar "Permitir início" com o tooltip correspondente); hoje o botão
existe e devolve 409.

### 7.3 Pontuação

`score = round(basePoints × pointsMultiplier × acerto × bônusDeTempo)`, com tudo em
`decimal` e `MidpointRounding.AwayFromZero` — em `double`, ou com o arredondamento
bancário padrão do .NET, dois alunos com a mesma resposta sairiam com pontuações
diferentes por 1. Há teste com um empate exato (82,5) para travar isso.

**`segundosRestantes` vem de `endsAt − submittedAt`, e não de
`timeSeconds − elapsedSeconds`:** senão uma pausa do líder no meio da fase comeria o
bônus da turma inteira. `elapsedSeconds` fica **literal como o contrato define**
(`submittedAt − phaseStartedAt`), incluindo tempo pausado — é o "tempo de resposta"
que o painel mostra. As duas contas divergem de propósito.

`fill` é tudo-ou-nada, como o contrato manda ("1/0 em quiz e fill"). A comparação
ignora caixa e espaço em volta, e **não** ignora acento — não precisa: as palavras vêm
de um banco que o aluno seleciona, ele não as digita.

### 7.4 `text` e `code` são aceitos e ficam pendentes

Comportamento exato do contrato ("voltam com `grading: pending`… o resultado chega
depois pelo evento `submission.graded`"). Sem corretor, o pendente é permanente por
enquanto, e a tela mostra "sua resposta está sendo avaliada" — que é o que de fato
está acontecendo. Quando a decisão de IA vier, entra um corretor e o produtor de
`submission.graded`; nada desta leva é reescrito.

`code` só aceita a linguagem **habilitada** (`js`): as outras aparecem "Em breve" na
tela, e aceitar código numa delas seria a promessa de executá-lo.

### 7.5 O ciclo de status da sala, e o TTL que ele finalmente preenche

| Rota | `Room.Status` | `Match.Status` | Outro efeito |
|---|---|---|---|
| `POST /rooms/{code}/match` | `Lobby → Running` | `Running` | grava `MatchMode`; **trava a fila** |
| `pause` | inalterado | `Running ↔ Paused` | `EndsAt = null` / recalculado |
| `finish` | `Running → Finished` | `Finished` | `FinishedAt`; **`ExpiresAt = FinishedAt + 24 h`** |
| `return-to-lobby` | `Running → Lobby` | `Finished` | destrava a fila; **não** marca TTL |

**`finish` é o primeiro lugar do sistema que escreve `Room.ExpiresAt`** — o item 1 de
`next-steps.md`, aberto desde a base inicial. Não fecha o problema inteiro (sala
abandonada no lobby continua sem TTL), mas tira o caminho feliz da lista: sala que
terminou a partida passa a expirar, e o código de 6 dígitos volta a circular. Como
`GET /rooms/active` já ignorava `Status == Finished`, a sala encerrada some sozinha do
"Voltar para a sala" — sem uma linha de código nova, e com teste.

`return-to-lobby` **encerra** o `Match` em vez de suspendê-lo: é o que o faz entrar no
histórico do perfil (`FinishedAt != null`) e o que destrava a fila, que é o único
motivo de voltar ao lobby. Começar de novo cria outro `Match`.

`finish` é idempotente — o botão fica na tela a partida inteira, e dois cliques não
podem mover o TTL para a frente.

### 7.6 Os números que o contrato mostra e não define

| Número | Como é calculado |
|---|---|
| `totalPlayers` | participantes `Approved` (o líder não joga, não conta) |
| `accuracyRate` | sobre os **corrigidos**, não sobre a turma — senão a taxa cairia sozinha a cada `text` pendente |
| `avgScore` / `teamAvgScore` | soma por participante ÷ **total de aprovados**, com zero para quem não respondeu |
| `percentile` | % dos **outros** que enviaram e pontuaram menos; sozinha na fase, 100 |
| `histogram` | uma barra por envio até 15; acima disso, 15 baldes com a média de cada um |
| `correctAnswerLabel` | quiz: todas as certas; fill: as palavras; text: `expectedAnswer`; code: `null` |
| `podium` | top 3 por soma; empate desempata por menor tempo somado, depois por `joinedAt` |
| `responseTimeBuckets` | 4 fatias iguais de `timeSeconds`, rótulos prontos em `LabelFormatter` |
| `avatarUrl` | sempre `null` — o schema só tem `avatarIndex` e não há upload em lugar nenhum |

**A média incluir quem não respondeu não é detalhe:** numa fase em que 5 de 28
responderam, as duas contas diferem por um fator de 5, e o aluno leria que está muito
abaixo da turma estando na frente dela.

**Restrição não óbvia, com teste próprio:** o `ChallengeShell` sobrescreve
`scoreboard.avgScore` com `stats.teamAvgScore` ao receber `stats.updated`. Os dois
**têm** de ser o mesmo número por construção, e por isso ambos saem do mesmo
`MatchTotalsAsync`. Hoje a substituição nem é observável (o aluno não assina o canal do
líder), o que só torna a divergência mais fácil de introduzir sem ninguém ver.

### 7.7 `PHASE_ALREADY_SUBMITTED` é checado **antes** de `PHASE_CLOSED`

Encontrado por um teste que falhou. Quando o último aluno responde, a fase fecha na
hora — então um segundo clique dele cairia em `PHASE_CLOSED`, e a tela diria "a fase
acabou" a quem na verdade já tinha respondido. Numa sala de um aluno só,
`PHASE_ALREADY_SUBMITTED` nunca aconteceria.

Das duas verdades, "você já respondeu" é a que descreve o que a pessoa fez.

### 7.8 Escolhas menores, agrupadas

- **`advance` publica `phase.ended` antes de `phase.started`.** Quem estava esperando
  sai da tela de espera e o evento seguinte o leva à fase nova; invertida, a transição
  se perderia.
- **`restart` só aceita a fase corrente** (`409 PHASE_CLOSED`). Reiniciar uma fase já
  passada moveria a partida para trás — o que `INVALID_DIRECTION` proíbe no modo ao
  vivo, por outra porta.
- **`advance` depois da última fase é `409 INVALID_DIRECTION`**, e não um encerramento
  automático: o caminho para terminar é `finish`, que é o que o botão da tela faz.
- **`MatchAccessService` é serviço irmão do `RoomAccessService`**, e não um método a
  mais nele: a chave de entrada é outra (`matchId`, não `code`), e um serviço com duas
  chaves teria a tabela de autorização dobrada.
- **`finish` devolve o pódio** em vez de `204`: é o mesmo pódio que o
  `match.finished` leva para a turma, e duas leituras poderiam discordar.
- **`AnswerDto` é o formato de entrada, de saída e de armazenamento.** Gravar uma
  forma e servir outra criaria duas verdades sobre a resposta de alguém.

---

## 8. Erros

| Situação | Resposta |
|---|---|
| fila vazia | `409 EMPTY_QUEUE` |
| ninguém aprovado | `409 NO_PLAYERS` |
| fase sem gabarito utilizável | `409 INCOMPLETE_PHASE` (**novo**) |
| `mode: "self-paced"` | `409 MODE_NOT_AVAILABLE` (**novo**) |
| sala já em partida | `409 MATCH_ALREADY_STARTED` |
| `matchId` inexistente, malformado, ou de sala de que não sou membro | `404 MATCH_NOT_FOUND` (**novo**) |
| não é o líder, em rota de líder | `403 NOT_ROOM_LEADER` |
| segundo envio na mesma fase | `409 PHASE_ALREADY_SUBMITTED` |
| envio tarde, ou em fase que não é a corrente | `409 PHASE_CLOSED` |
| `comparison` de fase aberta **ou futura** | `409 PHASE_STILL_OPEN` |
| `previous` no modo `live`, ou avançar além da última | `409 INVALID_DIRECTION` |
| `answer.kind` errado, `optionId` inexistente, `blanks` de tamanho errado, linguagem não habilitada, `ready` sem ter respondido | `400 VALIDATION_ERROR` |

Sete dos onze codes **já existiam** em `ErrorCodes.cs`, escritos por antecipação nas
levas anteriores. Os três novos entram na parte reservada aos erros que o front não
produz jogando normalmente.

Duas escolhas que se repetem das seções anteriores: **id malformado é 404, não 400**,
e **quem não é membro leva 404, não 403** — a partida não é mais pública que a sala que
a contém. Uma nova: o **líder** chamando rota de jogador (enviar, comparar, placar)
leva `404 MATCH_NOT_FOUND`, porque ele não joga.

---

## 9. Onde a implementação divergiu do modelo escrito antes

Três pontos, todos descobertos lendo o front ou escrevendo teste:

1. **`includeAnswers` para o líder.** O modelo (§4, decisão 6) dizia
   `current-phase` do líder → `true`. Virou **`false` até a fase fechar, para todos**,
   quando ficou claro que o mesmo payload viaja no `phase.started` de um canal
   coletivo. Ver §5.
2. **Uma coluna a mais.** O modelo (§3.1) listava três colunas de cronômetro.
   `CurrentPhaseEndedAt` entrou como quarta: sem ela, "fechamento isolado e
   idempotente" não tinha onde guardar o "já fechei". Ver §4.
3. **`code` incompleto.** O modelo dizia "`text`/`code` sem `expectedAnswer`". Para
   `code` virou **sem `testCases`** — exigir `expectedAnswer` bloquearia uma fase de
   código legitimamente escrita pelo editor, que nem pergunta esse campo. Ver §7.1.

O resto saiu como planejado, incluindo as quatro decisões que o usuário confirmou
antes de a implementação começar (recusar `self-paced`, fechamento preguiçoso isolado,
portão de fase incompleta, `text`/`code` pendentes).

---

## 10. Como esta leva foi verificada

```bash
dotnet ef database update --project src/Codex.Api --startup-project src/Codex.Api
dotnet test          # 329 testes (eram 248) — 81 novos
```

**81 testes novos**, em `MatchLifecycleTests`, `SubmissionTests` e `MatchStatsTests`.
Os que cobrem decisão, e não mecânica: quiz de duas respostas certas aceito (e a
distribuição do painel marcando as duas); pausa não comendo o bônus de tempo;
`elapsedSeconds` vindo do relógio do servidor; a regra de ouro para líder **e** aluno;
a fila travando ao começar a partida; `finish` gravando `ExpiresAt` e sumindo de
`GET /rooms/active`; `phase.ended` publicado **uma** vez em três leituras seguidas;
fase incompleta barrando o início; e o arredondamento de pontuação num empate exato.

⚠️ **Verificação parcial, como nas levas anteriores.** Os 329 testes rodam em EF
InMemory, que não tem índice — então o índice único de submissão **sob concorrência**
(dois cliques simultâneos da mesma pessoa) continua sem teste. A checagem em código
devolve o `409` do contrato; o índice é quem decide a corrida.

**O que foi exercitado por HTTP contra um Postgres real**, sem SQL manual em nenhum
ponto — o que esta leva conseguiu e as duas anteriores não:

- a partida inteira: signup → conjunto → sala → dois alunos entram e são aprovados →
  `POST /match` → `current-phase` → dois envios → painel → comparação → placar →
  `ready` → pause/resume → `finish` → pódio;
- os erros: `NO_PLAYERS`, `MODE_NOT_AVAILABLE`, `VALIDATION_ERROR` (modo desconhecido),
  `MATCH_ALREADY_STARTED` (a fila travada), `PHASE_ALREADY_SUBMITTED`,
  `PHASE_STILL_OPEN`, `NOT_ROOM_LEADER`, `INVALID_DIRECTION` (as duas variantes);
- a **segunda partida na mesma sala**, com o mesmo aluno reenviando a mesma fase — o
  caso que o índice antigo transformaria em `500`, e que passou a `201`;
- os efeitos fora da partida: `GET /rooms/active` respondendo `[]` depois do `finish`,
  o histórico do perfil acendendo com `avgScore: 50` e `accuracyRate: 50`, e a sala em
  `status: finished`.

O log da API não registrou nenhuma exceção não tratada vinda das rotas de partida.

> **Confirmação incidental de um desvio conhecido:** um corpo com bytes fora de UTF-8
> (erro do script de teste, não da API) respondeu `500 INTERNAL_ERROR` e não
> `400 VALIDATION_ERROR` — a mesma lacuna que `api-implementation-status.md` §3
> registra para corpo JSON malformado. O conserto continua sendo um `IExceptionHandler`
> para `BadHttpRequestException`.

---

## 11. A leva de correção: o fim da partida

Quatro defeitos relatados juntos depois de a partida rodar de verdade. Os dois primeiros
são de servidor e mudaram o modelo; os dois últimos são de tela.

### 11.1 A partida nunca acabava

O contrato define `finish` como ação do líder e não diz o que acontece quando a fila
se esgota. O resultado era um beco: a última fase fechava, a turma via a comparação e
ficava esperando um passo que não existia — `advance` recusa depois da última fase, e
o único caminho era o líder achar "Encerrar partida".

**Agora a última fase que fecha encerra a partida.** Vale para os dois jeitos de fechar
(o último envio e o cronômetro vencido), porque o fechamento passou a ter um **ponto
único** — `MatchService.ClosePhaseAsync` —, chamado pelos três gatilhos que existem.
Antes dele, o encerramento automático teria de ser lembrado em cada um; o esquecido
seria justamente o do cronômetro, que é o que ninguém testa à mão.

`finish` continua existindo e continua sendo do líder: é como se encerra **antes** da
última fase. Ele passou a publicar `match.finished` **só na transição** — senão o líder
clicando numa partida que já se encerrou sozinha mandaria um segundo evento para a turma.

### 11.2 A fase nunca fechava por tempo

Consequência conhecida do fechamento preguiçoso (§4): sem job, se ninguém chamar a API
depois do fim do relógio, `phase.ended` não sai. Documentado como "invisível em `live`" —
e não era: quem não respondeu ficava na tela do desafio com 00:00, e quem já tinha
respondido ficava esperando.

**O conserto manteve a decisão de não ter job.** Quando o cronômetro local chega a zero,
o cliente chama `GET /matches/{id}/current-phase` — a leitura que já fechava a fase
preguiçosamente. Todo cliente cutuca, e isso é de propósito: basta um navegador aberto
para a turma inteira destravar, o servidor é idempotente (só o primeiro fecha e publica)
e cada cliente só chama uma vez por fase. A resposta também é usada, então a tela anda
mesmo com o WebSocket fora do ar.

Quem não respondeu vai para uma tela **"Tempo esgotado"** (`TimeUpScreen`), separada do
feedback individual porque aquele é construído em torno de uma submissão que aqui não
existe — fingir uma vazia obrigaria os quatro tipos de desafio a tratar campos nulos que
nunca são nulos em nenhum outro caminho. O gabarito não aparece nela: sai na comparação,
que é o único lugar por onde ele chega ao aluno.

### 11.3 O pódio sumia no F5

`partida/page.tsx` redirecionava para o lobby quando `match.status === 'finished'` — o
que fazia sentido enquanto a partida só acabava por decisão do líder, e passou a apagar
o resultado no primeiro reload. Agora partida encerrada **é** o pódio: a página busca
`GET /matches/{id}/podium` e a tela abre nele.

### 11.4 Enviar depois do tempo estourava erro não tratado

O `409 PHASE_CLOSED` subia como rejeição dentro do `startTransition` e caía no boundary
de erro do Next.

O conserto tem um detalhe que vale registrar: **`ApiError` não sobrevive à fronteira de
uma Server Action** — o Next serializa a exceção e o cliente recebe um erro opaco, sem
`code`. Um `instanceof` do outro lado nunca seria verdadeiro. Por isso `submitAnswerAction`
passou a **traduzir** o caso em um resultado (`{ status: 'phase-closed' }`) em vez de
relançar. Qualquer outra falha continua subindo.

### 11.5 O que isso obrigou a mudar no modelo

Encerrar deixou de arrastar a turma de volta ao lobby: cada um sai do pódio quando
quiser. Isso exigiu saber **quem ainda não voltou** — daí a coluna
`Participant.InResultsSince` (migration `ParticipantInResults`), marcada para todos os
aprovados no encerramento e limpa por `POST /rooms/{code}/participants/me/return`, a
primeira rota do projeto que um participante chama sobre a própria linha.

**Não é adorno de tela.** Quem está nos resultados não conta como jogador: sem isso, uma
aba esquecida no pódio entraria no `totalPlayers` da partida seguinte e a regra "todos
enviaram" nunca fecharia uma fase — exatamente o defeito de 11.2, um nível acima.

> **A armadilha que isso criou, e que um teste pegou:** o pódio da partida que acabou de
> terminar é calculado sobre os jogadores dela — que são, por construção, exatamente as
> pessoas marcadas como "nos resultados". Aplicar o filtro em toda leitura esvaziava o
> pódio sempre. Por isso `MatchStatsService.ApprovedPlayersAsync` decide pelo estado da
> partida: **em andamento** exclui quem está nos resultados, **encerrada** inclui todo
> mundo.

Duas consequências menores: `return-to-lobby` passou a **limpar o `ExpiresAt`** que o
`finish` tinha marcado (sem isso a sala morreria em 24 h — viva na tela, expirada no
banco), e o cliente só obedece ao `match.returned-to-lobby` quando **não** está no pódio;
nas outras telas o evento continua querendo dizer "o professor encerrou isto aqui".

**Edge conhecido:** quem volta ao lobby no meio de uma partida já em andamento passa a
contar a partir dali, e o `totalPlayers` daquela fase sobe. A fase ainda fecha pelo
cronômetro. Travar o conjunto de jogadores no início da partida exigiria uma tabela de
participação, que não existe.

### 11.6 Verificação desta leva

`dotnet test` — **340 testes** (eram 329), 11 novos em `MatchEndingTests`. Três testes
existentes mudaram porque codificavam o comportamento antigo, e um deles apontou o
defeito do pódio vazio antes de ele chegar à tela.

Exercitado por HTTP contra Postgres real, com a migration aplicada: os dois jogadores
respondendo a última fase → partida `finished` sozinha, pódio com os dois, `current-phase`
ainda respondendo `200` (o caminho do F5); `me/return` respondendo `204` e idempotente;
`403 ACCOUNT_REQUIRED` sem sessão de participante; `NO_PLAYERS` ao tentar iniciar com
todos ainda no pódio; `totalPlayers: 1` na partida seguinte com um dos dois ainda nos
resultados; e a sala voltando a aparecer em `GET /rooms/active` depois do
`return-to-lobby`. Nenhuma exceção não tratada no log.

### 11.7 A segunda rodada: "a partida não está sendo finalizada"

O mesmo sintoma, relatado de novo. Desta vez a resposta estava no banco: **todas as
partidas de teste terminaram sozinhas**, `Finished`, na última fase, com
`FinishedAt - CurrentPhaseEndedAt` na casa dos 5 ms. O servidor de 11.1 estava certo; a
tela é que desfazia o fim.

A corrida, no aluno que responde por último da última fase:

| | |
|---|---|
| 1 | clique → `POST /submissions` sai; a tela ainda é `challenge` |
| 2 | servidor fecha a fase, encerra a partida, publica `phase.ended` e `match.finished` **e só então responde** |
| 3 | `phase.ended` chega → tela vira `timeup` — quem respondeu vira "tempo esgotado" |
| 4 | `match.finished` chega → tela vira `podium` ✔ |
| 5 | o `await` do passo 1 retorna → `setScreen('individual')` — **apaga o pódio** |

O passo 5 é literalmente o conserto de "o último a enviar fica travado na espera": ele
assumia que ninguém mexeria na tela durante o `await`. Com o encerramento automático,
alguém passou a mexer — e a ordem "publica, depois responde" (§WS 1: nunca publicar
antes do `SaveChanges`) garante que o evento chegue primeiro.

Três mudanças, todas de tela:

- **O pódio é terminal.** Toda troca de tela passa por um `goTo` que se recusa a sair de
  `podium`. É a invariante que faltava: o fim da partida disputa com respostas HTTP em
  voo, e quem chega depois não pode desfazê-lo.
- **O fim da partida não depende do WebSocket.** Quando a última fase fecha, o cliente
  busca `GET /matches/{id}/podium` por conta própria (uma vez por partida), e
  `POST /finish` passou a ter seu corpo **usado** em vez de descartado — a rota devolve o
  pódio justamente porque quem clicou "Encerrar" é quem vai mostrá-lo. Quem fecha a
  última fase é sempre alguém com uma requisição HTTP em andamento; essa resposta chega
  mesmo com o serviço de tempo real fora do ar, e é a única garantia que existe.
- **Quem está enviando não vê "Tempo esgotado"** (passo 3). O `phase.ended` que a própria
  pessoa causou chega antes da resposta do envio dela.

> **A lição, que é a mesma de §11.2 e da expulsão em api-resume-log.md §9:** a API publica
> certo e o cliente é que não acompanha. Aqui com um agravante — o conserto anterior virou
> a causa do seguinte, porque ele foi escrito quando fechar a fase ainda não podia
> encerrar a partida.

Verificado por HTTP contra Postgres real depois da mudança: partida de duas fases com
`advance` no meio → `status: "finished"` sozinha no último envio, pódio com 200 pontos,
`POST /finish` numa partida já encerrada respondendo `200` **com o corpo do pódio** (o
que a tela agora consome) e `current-phase` ainda em `200`. `dotnet test` segue em 340 —
nenhum C# mudou nesta rodada. `npm run typecheck` limpo.

### 11.8 Encerrar a partida estava matando a sala

Terceira rodada, e a mais séria: o líder voltava ao lobby e `POST /rooms/{code}/match`
respondia **`409 MATCH_ALREADY_STARTED`** — "esta sala já tem uma partida em andamento".
O banco mostrou o tamanho do estrago: **das 12 salas que rodaram partida, nenhuma jamais
voltou ao lobby.** Todas presas em `Finished`.

**`RoomStatus.Finished` é um estado terminal, e eu o tornei automático.** Ele some de
`GET /rooms/active`, recusa entrada nova (`ROOM_LOCKED`) e trava a fila
(`MATCH_ALREADY_STARTED`) — três guardas escritas quando *nada* tirava a sala do lobby
(o próprio comentário de `GetEditableRoomAsync` diz isso). Enquanto encerrar era um botão
deliberado do líder, "o professor fechou a aula" era leitura defensável. Quando o fim da
fila passou a encerrar sozinho (§11.1), **toda partida terminada passou a matar a sala** —
e não havia caminho de volta em lugar nenhum: nem pelo perfil (some de `/rooms/active`),
nem digitando o código.

Duas causas, uma em cada lado:

- **API:** `FinishCoreAsync` marcava `Room.Status = Finished`. Não marca mais. Encerra a
  **partida**; a **sala** segue `Running` — a turma continua reunida, olhando para o
  pódio — e quem a devolve ao lobby é `return-to-lobby`. O TTL de 24 h continua sendo
  marcado (é um "ninguém tocou nisto depois do pódio", não um encerramento), e agora
  `StartAsync` também o **apaga**: começar uma partida é a prova mais forte de que a sala
  não foi abandonada.
- **Front:** o "Continuar jogando" do pódio nunca chamava `return-to-lobby`. Para o
  participante ele chamava `me/return`; para o líder, só navegava. O líder tem esse botão
  na barra superior — mas **a barra some quando o pódio ocupa a tela inteira**, e com o
  encerramento automático o pódio virou a saída normal da partida. O único caminho
  restante era justamente o que não avisava o servidor.

> **O padrão, de novo:** a mudança de §11.1 não quebrou nada que ela tocasse. Quebrou
> três guardas escritas anos-luz antes, que dependiam de uma premissa — "sala só sai do
> lobby por decisão do líder" — que ela invalidou sem citar.

`RoomStatus.Finished` volta a não ter escritor, como era antes desta fatia. Se o produto
quiser "encerrar a sala" de verdade, isso é uma ação explícita do líder, e não um efeito
colateral de terminar uma partida — anotado em §12.

**Verificado por HTTP contra Postgres real, o caminho relatado inteiro:** partida de duas
fases acaba sozinha → sala em `running` (não `finished`) e ainda em `/rooms/active` →
aluno `me/return` `204` → líder `return-to-lobby` `204` → sala em `lobby` → **`POST
/rooms/{code}/match` cria a segunda partida** (era aqui que estourava) → segunda partida
também encerra sozinha, com pódio. `dotnet test`: **341** (dois testes reescritos porque
codificavam a sala morrendo, um novo para o caminho de duas partidas). Nenhuma exceção
não tratada no log.

---

## 12. O que esta leva **não** resolveu

- **`POST …/run`** — precisa de sandbox com limite de CPU/memória. Implementar sem ele
  seria executar código arbitrário de aluno no processo da API. O botão "Executar" da
  tela de código não tem rota; **falta escondê-lo no front**, como já se faz com
  "Gerar com IA".
- **Correção de `text` e `code`** — mesma decisão de provedor de IA de
  `POST /phase-sets/phases/generate`. Com ela vem o produtor de `submission.graded`,
  que é o único evento de partida do contrato de WS que continua sem produtor
  (`player.activity` nasce no cliente e nunca terá um na API).
- **`self-paced`** — ver §7.2. Custa `Participant.CurrentPhaseIndex`, um significado
  por modo para `POST …/ready`, e uma mudança em `realtime/src/channels.ts`.
- **Três consertos de front já feitos**, porque eram defeitos de verdade e não
  degradações. Os três têm a mesma forma: a API estava certa e quem a consumia é que
  não acompanhava.

  **(a) O painel do líder oferecia "Próxima fase" na última fase.** Clicar ali chama
  `advance`, que responde `409 INVALID_DIRECTION` — o caminho para terminar é
  `finish`. O `LeaderDashboard` recebia `isFirstPhase` (para desabilitar "Fase
  anterior") e nunca recebeu o simétrico; `ChallengeShell` já calculava `isLastPhase`
  e só o entregava à tela do aluno, que **já fazia a troca certa** ("Ver pódio" no
  lugar de "Próxima fase", em `CollectiveFeedbackScreen`). O painel virou o único
  lugar sem a troca. Corrigido passando `isLastPhase` e trocando o botão por
  "Encerrar partida"; o líder cai no pódio pelo `match.finished`, que ele já assina.

  **(b) Quem enviava por último ficava preso na tela de espera**, aguardando
  envios que já tinham acontecido.

  A causa é uma corrida, e ela vem de um fato desta API que vale conhecer:
  **`phase.ended` é publicado *antes* de o `POST …/submissions` responder** — é a
  mesma chamada que fecha a fase. Como o evento chega pelo WebSocket (Redis → serviço
  de WS → browser) e a resposta volta pelo caminho mais longo (API → servidor do Next
  → browser), o evento quase sempre ganha. Quando ele chegava, o `ChallengeShell`
  ainda estava na tela do desafio, e o handler de `phase.ended` só tira quem está em
  `waiting` — então não fazia nada. A resposta então chegava e colocava a pessoa em
  `waiting`, de onde nenhum evento futuro a tiraria.

  Atinge **exatamente** quem envia por último: os outros já estão em `waiting` quando
  o evento chega. O conserto é do cliente (`ChallengeShell.tsx`): a fase que fechou
  fica marcada num `ref` — e não em `state`, porque quem precisa lê-lo é o `await` do
  envio, que rodaria com o valor capturado no clique. De quebra, o envio ganhou um
  `finally` para `setSubmitting(false)`: sem ele, um envio que falhasse (a fase
  fechando entre abrir a tela e clicar) deixava o botão morto.

  **Nenhuma linha de API mudou** — é o mesmo formato do defeito de expulsão no lobby
  registrado em `api-resume-log.md` §9: a API publicava certo, quem escutava é que
  errava.

  **(c) O pódio chegava e era apagado** pela continuação do envio que o causou — ver
  §11.7. É (b) cobrando juros: o conserto de (b) foi escrito quando fechar a fase ainda
  não podia encerrar a partida.

- **Três consertos de front**, encontrados ao ligar as rotas e não corrigidos aqui
  porque são mudança de UI:
  1. `/sala/{code}/partida` aberto direto pela URL numa sala sem partida quebra o
     render — `GET /rooms/{code}/match` responde `404 MATCH_NOT_FOUND` e a página não
     trata. Precisa redirecionar para o lobby.
  2. o botão "Permitir início" (self-paced) precisa ficar desabilitado enquanto o modo
     responder 409.
  3. o feedback individual mostra "Sua resposta foi registrada." em vez da resposta
     certa, porque o estado da fase foi carregado com ela aberta (§5).
- **Rate limiting** — esta leva **não acrescenta item** à lista de `next-steps.md` §3:
  `POST …/submissions` já é limitado a um por pessoa por fase pelo índice único, e o
  resto da fatia é leitura. A única rota da partida com sugestão explícita de limite no
  contrato é `run`, que não existe.
- **Seção 11 (relatórios)** — continua fora, e ganha um argumento a mais: os agregados
  do relatório resumido já existem no `UserProfileService`, e a rota deveria ler do
  mesmo lugar em vez de recalcular.
- **TTL de sala abandonada no lobby** — `finish` resolveu só o caminho feliz. Sala que
  nunca começou partida continua segurando o código para sempre, e o job de limpeza
  continua sem existir.
- **"Encerrar a sala" não existe como ação** — e depois de §11.8 `RoomStatus.Finished`
  voltou a não ter escritor. As três guardas que dependem dele (`/rooms/active`,
  `EnsureJoinableAsync`, `GetEditableRoomAsync`) continuam corretas e inertes. Se o
  produto quiser fechar uma sala de verdade, é um botão do líder — nunca um efeito
  colateral de terminar uma partida, que foi exatamente o erro corrigido lá.
