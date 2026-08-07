# api-queue-log.md — Mutações da fila de fases (seção 6)

Registro de decisão da leva que implementou o **restante da seção 6 do
`api-rest-contract.md`**: as mutações da fila da sala (`POST`/`DELETE`/`PATCH` de
conjunto, `PATCH`/`DELETE` de fase, `PUT …/order`) e o
`GET /rooms/{code}/queue/phases/{phaseId}` do modal "Ver desafio". Era o item 1 de
`next-steps.md` — a única seção pela metade, e a tela que o líder usa antes de
toda partida.

Mesma convenção dos outros logs desta pasta: o que está aqui é **o que o contrato
não decidia** e o código precisou decidir. O que o contrato já dizia não é
repetido.

Duas coisas grandes saíram daqui e não são "da seção 6": a conversão
`DraftPhase → Phase` (§4), que a seção 7 vai consumir inteira, e a coluna de
revisão da fila (§3), que fecha o `queue.updated` do `websocket-contract.md` §5 —
o primeiro evento do contrato de WS a ganhar um produtor fora do lobby.

---

## 1. Rotas implementadas

| Rota | Método do serviço |
|---|---|
| `POST /rooms/{code}/queue/sets` | `RoomQueueService.AddSetAsync` |
| `DELETE /rooms/{code}/queue/sets/{setId}` | `RoomQueueService.RemoveSetAsync` |
| `PATCH /rooms/{code}/queue/sets/{setId}` | `RoomQueueService.UpdateSetAsync` |
| `PATCH /rooms/{code}/queue/phases/{phaseId}` | `RoomQueueService.UpdatePhaseAsync` |
| `DELETE /rooms/{code}/queue/phases/{phaseId}` | `RoomQueueService.RemovePhaseAsync` |
| `PUT /rooms/{code}/queue/order` | `RoomQueueService.ReorderAsync` |
| `GET /rooms/{code}/queue/phases/{phaseId}` | `RoomQueueService.GetPhaseDetailAsync` |

Arquivos novos: `Services/PhaseProjection.cs`, `Services/PhaseLimits.cs`,
`Contracts/Phases/PhaseContracts.cs`, `Contracts/Rooms/RoomQueueRequests.cs`,
`tests/Codex.Api.Tests/RoomQueueMutationTests.cs`,
`tests/Codex.Api.Tests/PhaseProjectionTests.cs`. Uma migration:
`RoomQueueRevision` (uma coluna `int` em `rooms`, default 0 — ver §3).

**O que foi reusado, e não reescrito:** `RoomQueueService.AppendSetAsync` (a
cópia conjunto → fila, com paleta de 8 cores e `TOO_MANY_SETS`, escrita para o
`setId` do `POST /rooms`), a sobrecarga `GetQueueAsync(roomId, ct)` — que existia
justamente para ser o corpo de resposta das mutações — e o `PhaseContent`. O
`POST /queue/sets` chama o mesmo `AppendSetAsync` que a criação de sala: com duas
implementações, a sala criada com conjunto e a sala que recebeu o conjunto depois
divergiriam na cor e no limite.

**O que mudou em código que já existia:** os limites numéricos de uma fase saíram
de dentro do `PhaseSetService` para `PhaseLimits`, porque agora há dois lugares
que gravam os mesmos três números (o editor, pela seção 5; o líder, pela fila).
Com duas cópias, o líder poderia gravar pela fila um tempo que o editor recusaria.

---

## 2. Toda mutação devolve a fila inteira — e por isso `DELETE` responde 200

O contrato pede ("todas as mutações desta seção devolvem a fila inteira
recalculada"), então nenhum `DELETE` daqui responde `204`. A consequência de
desenho é que o front redesenha a fila e os conjuntos com a resposta do próprio
clique: cor e índice são decididos no servidor, e o cliente que tentasse
recalculá-los erraria na primeira remoção.

A forma de toda mutação é a mesma, e está escrita uma vez no `RoomQueueService`:
resolve a sala como líder → exige lobby (§5) → muta → `SaveAndPublishAsync`
(grava, incrementa a revisão, publica) → devolve `GetQueueAsync(room.Id)`.

### Renumeração depois de toda remoção

`AppendSetAsync` calcula a próxima posição **contando** as linhas existentes.
Isso só funciona se `OrderIndex` for contíguo, então remover do meio renumera
0..n−1 (fases e conjuntos), preservando a ordem relativa. Sem isso, apagar a fase
do meio e adicionar um conjunto novo daria a ele uma posição já ocupada, e a fila
passaria a ter duas fases empatadas com uma ordem que só o banco decide.

Corolário testado: remover um conjunto **devolve a cor e a vaga** à paleta — sem
isso, 8 adições e 8 remoções travariam a sala para sempre.

### Tirar a última fase de um conjunto tira o conjunto

O contrato não diz. A linha vazia que sobraria não é neutra: ocupa uma das 8
vagas e uma das 8 cores, e o painel a mostraria como "0 fases" sem nada a fazer
com ela. Sumir descreve o que de fato aconteceu — não há mais nada daquele
conjunto na fila — e o líder pode adicioná-lo de novo.

### O mesmo conjunto pode entrar duas vezes

Não há checagem de duplicata, e isso é consequência de uma decisão anterior, não
uma nova: `setId` na resposta é o id da **linha da fila**, não o do `PhaseSet` de
origem. Duas linhas distintas, com cores distintas, cada uma removível sozinha.
Uma sala que repete um conjunto para uma segunda rodada é uso legítimo; o teto de
8 continua valendo.

### `PATCH` de conjunto é edição em massa, não um padrão guardado

"Aplica os três valores a todas as fases daquele conjunto de uma vez" — e só. Uma
fase adicionada depois não herda nada. Guardar o valor na linha do conjunto
criaria uma segunda verdade sobre os pontos de uma fase, e a fila já tem a dela,
que é a que a partida executa.

Nos dois `PATCH` (de conjunto e de fase) **campo ausente é campo inalterado**,
inclusive nos três do conjunto, que o contrato mostra sempre juntos: um `PATCH`
que zera o que você omitiu é um `PUT` com outro nome.

---

## 3. `QUEUE_MISMATCH` por ids, `revision` por coluna

Eram as duas pontas que `next-steps.md` deixou explicitamente em aberto, e elas
**não** foram fechadas com o mesmo número.

**O `409 QUEUE_MISMATCH` compara o conjunto de ids enviado com o da fila.** É o
que o contrato descreve literalmente ("a lista precisa conter exatamente os ids
atuais") e é o teste que de fato protege o dado: se a outra aba adicionou,
removeu ou trocou de conjunto, os ids não batem e a reordenação para. A comparação
conta os elementos antes de comparar os distintos — `["a","a"]` tem os mesmos ids
distintos que `["a"]` e não descreve fila nenhuma. Um id malformado no meio da
lista cai no mesmo 409, e não num 500 do desserializador: um id que não parseia
**é** um id que não está na fila. (Por isso `phaseIds` é `string[]` no contrato de
entrada, e não `Guid[]`.)

O caso que escapa é o de duas reordenações simultâneas sobre a mesma fila: a
última vence. O resultado é uma ordem que alguém escolheu, não um embaralhamento
— e fechar isso exigiria `revision` no corpo do `PUT`, que é mudança de contrato
na rota e o front atual não manda.

**A `revision` do `queue.updated` é `rooms.QueueRevision`**, coluna nova. Ela
existe só para o evento, e **não** é trava de concorrência. Cresce em *toda*
mutação da seção 6, inclusive nas que não mudam a quantidade de fases (o `PATCH`
de pontuação): um número que às vezes repete faria o cliente descartar uma
mudança real achando que já a tinha visto.

O evento vai para o canal `room:{code}` — o `websocket-contract.md` §5 lista
`queue.updated` em "Lobby" — e leva só o número, "a fila só interessa ao líder, e
ele é quem acabou de mudá-la". Quem ganha com isso é a **segunda aba do líder**, a
que não clicou.

Isto fecha a lacuna registrada em `websocket-implementation-log.md` §4
("`queue.updated` manda uma revisão que o schema não guarda"), e resolve as duas
pontas com um contador só, como aquele documento pedia.

---

## 4. A conversão `DraftPhase → Phase` mora em `PhaseProjection`

O `GET /queue/phases/{phaseId}` é a única rota da seção 6 que devolve gabarito, e
o que está gravado é a forma de **autoria** (decisão da seção 5,
`api-phases-log.md` §2). Alguém tinha que escrever a conversão; ela está em
`Services/PhaseProjection.cs`, num lugar só, porque a seção 7
(`GET /matches/{matchId}/current-phase`) precisa exatamente da mesma. Duas
conversões separadas dariam ao líder uma prévia diferente do que o aluno joga —
que é o bug que o modal existe para evitar.

`includeAnswers` é **parâmetro obrigatório**, e não um default: ninguém deriva uma
fase sem responder "esta saída pode conter gabarito?". Para a seção 6 é sempre
`true` (rota de líder); para a seção 7 será `false` enquanto a fase estiver
aberta — a "regra de ouro".

### O que a conversão não consegue ler, porque não está gravado

**`code` é o caso.** O `CodePhase` do contrato pede `title`, `difficulty`, `tags`,
`statement`, `examples`, `fileName` e `languages[]`; o editor da seção 5 só
pergunta `question`, `starterCode` e `testCases`. Os que faltam são derivados com
padrão, em vez de acrescentados ao editor — acrescentá-los seria mudança da seção
5 do contrato e tela nova, e a fase de código funciona sem eles:

| Campo | De onde sai |
|---|---|
| `title` | o nome da fase (é o único campo de título que o autor digita) |
| `statement` | o `question` gravado |
| `difficulty` | `"medium"` fixo — o meio dos três valores, não empurra para nenhum extremo |
| `tags` | `[]` |
| `examples` | parse do texto livre de `testCases` (abaixo) |
| `fileName` | `solucao.` + extensão da linguagem habilitada |
| `languages` | catálogo do servidor: `js` habilitada com o `starterCode` do autor, `py` desabilitada |

O catálogo de linguagens é do servidor porque **não existe no front**: `types.ts`
descreve o formato (`CodeLanguage`) e nada o preenche. São exatamente as duas do
exemplo do contrato, e só a primeira habilitada — habilitar mais é promessa de
executar código naquela linguagem, e o sandbox de execução (seção 8) não existe
nem foi decidido. Só a habilitada recebe o código inicial do autor: não existe
tradução de starter code entre linguagens.

`examples` é lido no formato que o **placeholder do editor** ensina
(`Entrada: … / Saída: …`, `set-editor/PhaseForm.tsx`) — é a única coisa que
orienta o autor, já que o contrato diz que o formato é livre e "o servidor é quem
interpreta". Linha em formato desconhecido é ignorada; entrada sem saída vira
exemplo com saída vazia, para o autor ver na tela que ficou pela metade.

Quando o produto quiser que o autor escolha dificuldade e linguagem, o lugar de
mudar é o editor, e o `PhaseProjection` passa a só ler. Há teste travando cada um
desses padrões, exatamente para que mudá-los seja deliberado.

### Ids de alternativa são posicionais

`o1`, `o2`, … (os ids do exemplo do contrato), derivados da posição. O que está no
banco são índices — `options` é `string[]` e o gabarito é `correctIndexes` —,
então não há id de alternativa para carregar. Ser determinístico é o que faz a
submissão do aluno (`answer.optionId`, seção 8) poder ser conferida depois contra
o mesmo gabarito, sem uma tabela de ids.

Reordenar as alternativas no editor troca o significado dos ids; isso é inofensivo
para uma fase já copiada para a fila, e é exatamente por isso que a cópia existe.

### Uma perda conhecida: `correctIndexes` (plural) → `correctOptionId` (singular)

O editor aceita **mais de uma** alternativa certa (a validação da seção 5 só proíbe
"nenhuma" e "todas"), e o contrato só tem lugar para uma: `correctOptionId`,
singular, em `types.ts` e na seção 6. Sai a primeira.

**Consequência para a seção 8:** quem for implementar a correção precisa ler
`correctIndexes` do `ContentJson`, e **não** este campo — senão reprova um aluno
que marcou a segunda resposta certa. Fechar a divergência de vez exige decidir se
o produto quer quiz de múltipla resposta; se quiser, o campo do contrato é que
precisa virar lista.

### `fill`: segmentos com a mesma varredura da validação

A quebra do enunciado em `segments` usa a mesma varredura de
`PhaseContent.CountBlanks` (`___` tentado antes de `PALAVRA`, esquerda para a
direita). Isso não é higiene: o gabarito é posicional, então contar lacunas de um
jeito na validação e quebrar de outro na saída daria uma fase cujo
`correctWords[i]` não corresponde à lacuna `i` da tela.

Trecho de texto sai trimado e trecho vazio não entra, porque `.sentence` é um flex
com `gap: 8px` (`FillChallenge.module.css`) — o espaçamento é do CSS, e um segmento
só com espaços viraria um item invisível ocupando um gap a mais.

Lacuna ainda em branco vira `""` em `correctWords`, e não some: sumindo, a segunda
palavra do gabarito passaria a responder pela primeira lacuna.

---

## 5. A fila trava quando a sala sai do lobby

O contrato não fala nisso — a seção 7 nem existe ainda. As mutações respondem
`409 MATCH_ALREADY_STARTED` quando `room.Status` não é `lobby`, porque a seção 14
lista "todas as de `/queue/*`" só no lobby do líder e porque reordenar a fila
embaixo de uma partida em andamento moveria a fase corrente por baixo dos alunos.

Como **nada hoje tira a sala de `lobby`**, a guarda não muda nenhum comportamento
existente: ela está aqui para a seção 7 encostar sem precisar lembrar de
escrevê-la. `MATCH_ALREADY_STARTED` é código novo, fora da tabela da seção 1 —
está na parte do `ErrorCodes` reservada aos erros que o front não consegue
produzir jogando normalmente.

O `GET` do detalhe da fase **não** tem essa guarda: ler o desafio não muda nada, e
conferir a fase durante a partida é o próprio ponto de haver uma prévia do líder.

---

## 6. Erros

| Situação | Resposta |
|---|---|
| não é o líder (inclusive participante aprovado e anônimo) | `403 NOT_ROOM_LEADER` |
| código de sala que não resolve | `404 ROOM_NOT_FOUND` |
| `setId` inexistente, malformado, ou de conjunto privado de outra pessoa | `404 PHASE_SET_NOT_FOUND` |
| `setId` de linha de fila de **outra sala** | `404 PHASE_SET_NOT_FOUND` |
| `phaseId` inexistente, malformado, ou de outra sala | `404 PHASE_NOT_FOUND` (novo) |
| nono conjunto | `409 TOO_MANY_SETS` |
| ids divergentes no `PUT …/order` | `409 QUEUE_MISMATCH` |
| sala fora do lobby | `409 MATCH_ALREADY_STARTED` (novo) |
| número fora de faixa, nome vazio, `expectedAnswer` em `quiz`/`fill` | `400 VALIDATION_ERROR` |

Duas escolhas que se repetem das seções anteriores: **id malformado é 404, não
400** (para quem está olhando, um id que não resolve é um recurso que não existe),
e toda busca por id **filtra por `RoomId`** — o id da fase da fila é global, então
sem isso o líder de uma sala leria e editaria a fase da fila de outra.

`expectedAnswer` mandado para um `quiz` ou `fill` é `VALIDATION_ERROR`, e não um
campo ignorado em silêncio: quem o mandou acha que gravou um gabarito.

---

## 7. O que esta leva **não** resolveu

- **`POST /phase-sets/phases/generate`** (seção 5) continua fora: depende de
  escolher provedor de IA. Nada aqui mudou isso.
- **Rate limit.** Nenhuma rota desta seção tem limite. Elas exigem líder, então o
  estrago possível é na própria sala do autor da chamada — mas a partição natural
  (`userId`) é a mesma da lista de `next-steps.md`, e vale fazer junto.
- **A conversão inversa** (`Phase → DraftPhase`) não existe e não faz falta: nada
  no produto edita uma fase da fila de volta para a biblioteca.
- **Um bug do front**, encontrado ao ligar as rotas e **não corrigido aqui** (é
  mudança de UI, não de API): em `PhaseSetsPanel.tsx`, o `SetPicker` chama
  `removeSetFromQueueAction(roomCode, set.id)` com o id do **`PhaseSet` de
  origem**, enquanto a rota espera o id da linha da fila — e compara
  `selectedIds` (ids de fila) com `set.id` pelo mesmo engano, então o check "já
  adicionado" nunca aparece na lista de conjuntos. O painel de conjuntos logo ao
  lado usa o id certo (`set.setId`). Com a API no ar isso vira um `404
  PHASE_SET_NOT_FOUND` — nada é apagado por engano —, mas o botão do seletor não
  funciona como remover. Consertar exige decidir uma coisa de produto: o seletor é
  um *toggle* (e aí o payload da fila precisa expor o id de origem) ou só
  adiciona (e aí o mesmo conjunto pode entrar duas vezes de propósito, que é o que
  a API já permite).
