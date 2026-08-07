# api-phases-log.md — Conjuntos de fases e editor (seção 5)

Registro de decisão da leva que implementou a **seção 5 do `api-rest-contract.md`**:
a biblioteca de conjuntos (`GET /phase-sets`) e o editor de rascunho
(`GET/POST/PUT/PATCH/DELETE` de conjunto). Era o item 1 de `next-steps.md` — "o
maior bloco de UI parado esperando API", e a rota que faltava para existir
`PhaseSet` no banco sem semear via SQL.

Mesma convenção dos outros logs desta pasta: o que está aqui é **o que o contrato
não decidia** e o código precisou decidir. O que o contrato já dizia não é
repetido.

**Esta é a primeira leva que precisa entender o `ContentJson`.** Até agora ele
tinha sido só gravado à mão e copiado literal para a fila da sala. É de longe a
decisão mais consequente daqui, e está na §2.

---

## 1. Rotas implementadas

| Rota | Arquivo |
|---|---|
| `GET /phase-sets?scope=&q=` | `Endpoints/PhaseSetEndpoints.cs` · `PhaseSetService.ListAsync` |
| `GET /phase-sets/{setId}/draft` | `PhaseSetService.GetDraftAsync` |
| `POST /phase-sets` | `PhaseSetService.CreateAsync` |
| `PUT /phase-sets/{setId}/draft` | `PhaseSetService.ReplaceDraftAsync` |
| `PATCH /phase-sets/{setId}` | `PhaseSetService.RenameAsync` |
| `DELETE /phase-sets/{setId}` | `PhaseSetService.DeleteAsync` |
| `POST /phase-sets/phases/generate` | **não implementada** — ver §8 |

Arquivos novos: `Services/PhaseSetService.cs`, `Services/PhaseContent.cs`,
`Contracts/PhaseSets/PhaseSetDraftContracts.cs`,
`Endpoints/PhaseSetEndpoints.cs`, `tests/Codex.Api.Tests/PhaseSetServiceTests.cs`.
**Nenhuma migration:** o schema já modelava `PhaseSet`/`Phase` desde a base
inicial — esta leva é handler HTTP sobre tabela que já existia.

`PhaseSetSummaryDto` e `LabelFormatter.EditedLabel` foram reusados como estavam,
não reescritos: o `GET /phase-sets` devolve exatamente o mesmo formato que os
`sets` do `GET /users/{userId}/profile` já devolviam.

---

## 2. A decisão central: **o que fica gravado é a forma de autoria**

O contrato desenha duas formas da mesma fase (tabela da seção 5): `Phase`, o que
a partida consome (gabarito escondido, frase já quebrada em segmentos, alternativas
com id), e `DraftPhase`, o que o autor digita (o gabarito é o próprio conteúdo, a
frase é texto com `___`, nada foi normalizado). O contrato diz que são formatos
diferentes; **não diz qual dos dois vive no banco.**

Fica gravada a de **autoria** (`Services/PhaseContent.cs`), e a de partida será
derivada na saída, quando a seção 7 existir. O motivo é que só a de autoria é
superset:

- de `question: "Ao ___ os termos"` dá para produzir os `segments`; dos `segments`
  não dá para saber se o autor escreveu `___` ou `PALAVRA`;
- de `options: string[]` + `correctIndexes` dá para produzir `options: {id,label}[]`
  + `correctOptionId`; do inverso, uma alternativa com id não volta a ser índice
  estável (e o editor reordena alternativas).

Gravar a forma de partida obrigaria a guardar as duas — que é o jeito garantido de
elas divergirem depois de uma edição.

**Consequência para a seção 6:** `RoomQueueService.AppendSetAsync` copia o
`ContentJson` literal, então a fila de uma sala guarda o mesmo formato. O
`GET /rooms/{code}/queue/phases/{phaseId}` (modal "Ver desafio", a única rota da
seção 6 que devolve gabarito) vai ler daqui e converter — é o primeiro consumidor
da conversão que ainda não existe.

O JSON gravado é camelCase e omite nulo, de propósito: as chaves são as mesmas do
contrato, então quem abrir a coluna no `psql` lê o que vê na tela, e uma fase de
quiz não grava sete campos vazios de outros kinds.

### O corpo que sai é a união discriminada de `types.ts`

`DraftPhaseDto` é **um tipo só para as duas direções** (o único campo que muda é o
`Id`: o editor manda `draft_*`, o servidor devolve o definitivo — por isso ele é
`string` e não `Guid`). Os campos por kind são anuláveis e marcados com
`JsonIgnore(WhenWritingNull)`, então uma `QuizDraftPhase` sai com
`options`/`correctIndexes` e **sem** `blanks`, nem como `null` — que em `types.ts`
não seria uma `QuizDraftPhase` válida. Há um teste que afirma isso sobre o JSON
serializado, e não sobre o objeto: é no corpo que o front quebraria.

O mesmo teste afirma `"fromAI"` (e não `"fromAi"`). A política camelCase do .NET
só mexe no primeiro caractere, então bate com `types.ts` — mas isso é sorte de
duas convenções coincidirem, não desenho, e por isso está fixado por teste.

---

## 3. `scope` decide o filtro **e** o rótulo

`source` é relativo a quem olha, não é atributo do conjunto — regra que o perfil
(`api-implementation-status.md` §2) já tinha fixado. No `GET /phase-sets` isso
tem uma consequência direta: `scope` não escolhe só *quais* conjuntos entram, ele
escolhe *como cada linha é descrita*. `owned` sai com `updatedLabel` ("editado há
2 dias") e `authorName: null`; `community` sai com `authorName` e
`updatedLabel: null`.

**A aba comunidade esconde os conjuntos do próprio usuário.** Eles já estão
inteiros na aba "meus". Sem isso o mesmo conjunto apareceria duas vezes no mesmo
seletor, com rótulos diferentes, e o autor teria que descobrir sozinho que são o
mesmo. O custo é que o autor não vê o próprio conjunto "como a comunidade vê" —
que não é uma tela que exista.

Outras decisões desta rota:

- **`scope` ausente é `owned`.** O seletor abre em "meus conjuntos".
- **`scope` desconhecido é `400 VALIDATION_ERROR`**, não cai no padrão em
  silêncio: devolver a biblioteca do próprio usuário para quem pediu
  `?scope=todos` seria um `200` respondendo outra pergunta.
- **`owned` sem conta é `403 ACCOUNT_REQUIRED`** (mesmo critério do
  `GET /users/me/profile`); `community` **sem conta responde normalmente** — é uma
  biblioteca pública, e não há sujeito a resolver.
- **Teto de 50 linhas.** O contrato não pagina esta rota e o seletor não tem
  "carregar mais" — mesmo critério do histórico de partidas do perfil. É o `q`
  que faz a biblioteca da comunidade caber na resposta.
- **Busca com `ToLower().Contains()`**, e não `EF.Functions.ILike`: o `ILike` só
  existe no provedor Npgsql e os testes rodam em InMemory. No Postgres traduz para
  `lower(title) LIKE lower(...)`, que é o que o seletor precisa.

---

## 4. Rota de autor: quem não é dono leva **404**, não 403

Todas as rotas de conjunto, exceto o `GET` da lista, passam por
`PhaseSetService.FindOwnedAsync`, que responde `404 PHASE_SET_NOT_FOUND` para
quem não é o dono — inclusive para o conjunto `community` de outra pessoa.

Não é o mesmo critério das rotas de sala (`403 NOT_ROOM_LEADER`), e a diferença é
proposital: numa sala, quem chega com o código já sabe que ela existe — o código
*é* o convite. Um id de conjunto não é convite de nada, e responder 403
confirmaria a existência de um rascunho privado para quem varresse ids, sem dar
ao autor legítimo nenhuma ação a mais.

Conjunto `community` de outro autor continua **utilizável** (`POST /rooms` com
`setId` já o aceitava, e continua aceitando) — o que 404 aqui nega é abrir o
**editor** dele.

**Id malformado também é 404**, e não 400: para quem está olhando, um id que não
resolve é um conjunto que não existe. É por isso que a rota recebe `{setId}` como
`string` em vez de `{setId:guid}` — com a restrição de rota, um id torto viraria
404 do roteador **com corpo vazio**, fora do formato `{code, message}` do
contrato. Mesmo motivo do `{userId}` do perfil.

---

## 5. O `PUT` preserva o id de fase que já tinha um

O contrato só exige que ids `draft_*` voltem trocados pelos definitivos. Apagar
tudo e reinserir cumpriria a letra — e daria um id novo a cada gravada.

`RoomQueuePhase.SourcePhaseId` é a única pista de qual fase da biblioteca originou
a fase jogada numa partida. Com ids trocados a cada save, essa pista apontaria
para um id que não existe mais depois da primeira correção de digitação. Então:

- fase cujo `id` é um `Guid` que **pertence a este conjunto** é atualizada no
  lugar;
- `draft_*`, id ausente, ou id de fase **de outro conjunto** nasce como fase nova
  (adotar o id alheio seria roubar a fase de outra pessoa — há teste);
- o id só é consumido uma vez, então duas fases do corpo reivindicando a mesma
  linha não fazem a segunda sobrescrever a primeira em silêncio;
- o que não veio no corpo foi apagado no editor e é removido.

A ordem é a do array e nada mais: `OrderIndex` é reescrito como a posição no
corpo, que é o que faz não existir campo de posição para sair de sincronia com o
rail.

**Renomear conta como editar** (`PATCH` mexe no `UpdatedAt`), senão a lista
reordenaria de um jeito que o autor não explica.

---

## 6. O que é validado — e o que é deliberadamente deixado passar

O contrato lista três validações que "o servidor precisa repetir (a UI já impede,
mas isso não é garantia)". Elas estão implementadas, mais duas da mesma família e
os limites de coluna:

| Regra | Fonte |
|---|---|
| `options` entre 2 e 6 | contrato |
| `correctIndexes` nunca vazio, nunca todas as alternativas | contrato |
| `blanks.length` igual ao número de lacunas de `question` | contrato |
| `correctIndexes` sem repetidos e dentro de `options` | daqui — `[0,0]` em 2 alternativas passaria na checagem de "todas" por acidente de contagem |
| palavra de `blanks` tem que estar em `words` | daqui — lacuna cuja resposta não está no banco é fase que ninguém acerta |
| `title`/`name` 1–160, `basePoints` 0–10 000, `timeSeconds` 5–3 600, `pointsMultiplier` 0,1–10, até 50 fases | daqui — colunas e sanidade |

**O que não é validado: campo em branco.** Enunciado vazio, alternativa vazia,
lacuna sem palavra escolhida — tudo passa. Isto é um *rascunho*: o editor cria a
fase com enunciado vazio (`defaultDraftPhase` em `set-editor/phaseKinds.tsx`) e o
autor sai da tela no meio. Um conjunto que só pode ser salvo quando estiver
perfeito é um conjunto que se perde.

A linha que separa as duas listas: o que é **contraditório** não passa (um quiz
em que qualquer clique acerta, um gabarito posicional com mais entradas do que
lacunas); o que é **incompleto** passa. Quem cobra fase completa deveria ser o
início da partida (seção 7), não o salvamento — e isso ainda não existe, fica
registrado como pendência.

**Conjunto sem nenhuma fase é válido** pelo mesmo motivo: o editor salva o título
antes de escrever a primeira fase, e a biblioteca mostra "0 fases" sem problema.

### Contar lacuna igual ao editor

`PhaseContent.CountBlanks` espelha `BLANK_PATTERN` (`/___|PALAVRA/`) do
`phaseKinds.tsx`: varredura da esquerda para a direita, `___` tentado antes de
`PALAVRA`. O gabarito é posicional, então servidor e editor **têm** que contar as
mesmas lacunas — contar diferente aqui rejeitaria um rascunho que a tela mostra
como válido. O caso que decide o algoritmo é `"____"` (quatro underscores): uma
lacuna e um caractere sobrando, nos dois lados. Tem teste.

---

## 7. Um conjunto novo nasce **privado**

`Visibility` é `Private` na criação. Publicar na comunidade é uma ação separada, e
**o contrato não tem rota que faça isso** — nem no `PATCH /phase-sets/{setId}`
(que "só renomeia") nem em lugar nenhum. Ninguém publica sem pedir, então o
default é o fechado.

Efeito colateral que vale saber: **a aba "Comunidade" responde `[]` em qualquer
instalação**, e vai continuar respondendo até existir a rota de publicar (ou
alguém rodar `UPDATE phase_sets SET "Visibility" = 'Community'`). A rota está
completa; o dado é que não nasce. É a mesma situação de `matches` no perfil.
Entrou em `next-steps.md`.

---

## 8. O que esta leva **não** faz

### `POST /phase-sets/phases/generate` (geração por IA)

Fora por decisão anterior (`next-steps.md`, item 1): depende de escolher provedor
e modelo, o que ninguém decidiu. O editor degrada — some o botão "Gerar com IA", o
resto da tela funciona. A rota não está registrada: chamá-la é 404 do roteador.

Nota de desenho para quem for implementá-la: a fase gerada **não é persistida** —
ela volta como `DraftPhase` com `fromAI: true` e só vai para o banco quando o
autor salvar o conjunto. Ou seja, a rota não toca em `PhaseSetService`; ela produz
um `DraftPhaseDto` e devolve. `fromAI` é campo do autor e trafega intacto pelo
save (tem teste), então nada mais precisa mudar aqui.

### Cache HTTP de 60 s no `GET /phase-sets`

O contrato pede (`seção 1`, "as únicas rotas cacheáveis"). Não foi feito: nenhuma
rota do projeto tem cabeçalho de cache ainda, e fazer só esta criaria um padrão
sem os outros. Continua em `next-steps.md`.

### Rate limit

`POST /phase-sets` e `PUT .../draft` são rotas que **criam e reescrevem registro**
sem limite nenhum — a mesma lacuna já registrada para `POST /rooms` e
`POST /realtime-ticket`. A partição natural é o `userId`, que as três exigem. Não
depende da decisão de IP repassado pelo Next (`api-lobby-log.md` §7).

### Realtime

Nenhum evento é publicado por estas rotas, e está certo: `websocket-contract.md`
§5 não tem evento de biblioteca de conjuntos. O editor é uma tela de uma pessoa
só. `queue.updated` continua sendo assunto das **mutações da fila** (seção 6), que
não são estas.

---

## 9. O que acendeu junto

Três coisas que já estavam escritas e estavam andando vazias:

- **`POST /rooms` com `setId`** agora tem conjunto para copiar sem SQL manual.
  Verificado ponta a ponta: criar conjunto → criar sala com ele → `GET /queue`
  devolvendo as fases copiadas.
- **`sets` do `GET /users/{userId}/profile`** — a lista existia e só tinha o que
  mostrar se alguém semeasse via SQL.
- **`src/app/conjunto/` e `src/components/set-editor/` no front** — o maior bloco
  de UI parado. As seis rotas que `src/lib/api/phaseSets.ts` e
  `src/lib/actions/phaseSets.ts` chamam existem agora, exceto `generate`.

Um detalhe de serialização que aparece nesta seção como já aparecia na fila:
`pointsMultiplier` sai como `1` no corpo do `POST` (o decimal ainda está em
memória) e como `1.00` no `GET` seguinte (veio de `numeric(5,2)`). É o mesmo
número em JSON e o front tipa como `number` — mas quem comparar dois payloads vai
ver a diferença.

---

## 10. Como este estado foi verificado

```bash
cd .NET && dotnet build && dotnet test    # 183 testes (eram 139)
```

Os **44 testes novos** (`PhaseSetServiceTests`) cobrem a listagem nos dois
escopos, a busca, o round-trip dos quatro kinds, a preservação de id no `PUT`, a
tentativa de adotar fase alheia, cada validação acima (inclusive as que
deliberadamente passam), e as quatro rotas de autor recusando conjunto de outra
pessoa. Rodam em EF InMemory, sem Postgres.

**Ponta a ponta contra o Postgres 18 local**, com a API no ar e `x-service-token`:
criação com os quatro kinds e ids `draft_*` voltando como `Guid`; `GET` do
rascunho com cada kind trazendo só os campos do seu tipo (`fill` com
`blanks: ["multiplicar", null]`, ou seja, lacuna vazia sobrevivendo);
`?scope=owned` com `updatedLabel`; `?scope=owned&q=FUNCOES` achando
`"Fracoes & Funcoes Basicas"` (busca case-insensitive); `?scope=community` visto
por **outra conta**, trazendo `authorName: "Marina Duarte"` e `updatedLabel: null`
(o conjunto foi publicado por `UPDATE` direto, porque não há rota que publique);
`PUT` mantendo o id da fase que ficou e apagando as três removidas; `PATCH`
devolvendo `PhaseSetSummary` com `phaseCount` atualizado; `POST /rooms` com o
`setId` e a fila copiada; `DELETE` respondendo `204`, **levando as fases junto
(cascade real do Postgres, que o InMemory não exercita)** e deixando a fila da
sala intacta — que é o que o contrato promete ao dizer que a fila copia em vez de
referenciar.

Erros verificados no fio: `scope=todos` → `400 VALIDATION_ERROR`;
`scope=owned` sem sessão → `403 ACCOUNT_REQUIRED`; `correctIndexes` marcando todas
→ `400`; `blanks` fora do número de lacunas → `400`; conjunto alheio no `GET
/draft` e no `DELETE` → `404 PHASE_SET_NOT_FOUND`; id malformado → o mesmo `404`
no formato do contrato; rascunho apagado → `404`.

---

## 11. O que muda nos outros documentos

- **`api-implementation-status.md`** — atualizado nesta leva: as seis rotas da
  seção 5, a contagem de rotas, a lacuna "front esperando seção 5" (resolvida) e
  a nota do §4 de que "a camada que serializa por tipo ainda não foi escrita" (foi).
- **`next-steps.md`** — atualizado nesta leva: o item 1 (seção 5) saiu; as
  mutações da fila (seção 6) passaram a ser o primeiro item, agora sem
  dependência nenhuma pendente.
- **`api-rest-contract.md`** — não foi tocado. Vale registrar duas coisas que ele
  não define e que o código passou a assumir: **não existe rota para publicar um
  conjunto na comunidade** (§7 acima) e **`POST /phase-sets` não diz o que
  responder a convidado** (respondemos `403 ACCOUNT_REQUIRED`, como as outras
  rotas de conta).
