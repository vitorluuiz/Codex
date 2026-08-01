# api-lobby.md — Entrar numa sala e lobby (seções 3–4)

Este documento registra as decisões da implementação das **seções 3 e 4** do `api-rest.exemple.md`
sobre a base descrita em `api-init.md`. Como o `api-init.md`, ele é complemento e não substituto:
formatos de request/response continuam definidos no contrato.

A leva anterior (`api-init.md`) entregou a infraestrutura e a fatia vertical de sessão/auth.
Esta entrega o segundo grupo de rotas — e, junto com ele, a autorização baseada em recurso que o
`api-init.md` previa que "nasceria aqui".

---

## 1. Rotas implementadas

| Rota | Quem pode chamar | Resposta |
|---|---|---|
| `GET /rooms/{code}/availability` | qualquer um (com ou sem sessão) | `200 {code, capacity, requireAccount}` |
| `POST /rooms/{code}/participants` | qualquer um | `201 {participant, token, expiresIn}` |
| `GET /rooms/{code}` | líder ou participante da sala | `200 Room` |
| `GET /rooms/{code}/participants?status=` | `approved`: membros · `pending`: só líder | `200 Participant[]` |
| `PATCH /rooms/{code}` | só líder | `200 Room` |
| `POST /rooms/{code}/participants/{id}/approve` | só líder | `204` |
| `POST /rooms/{code}/participants/{id}/reject` | só líder | `204` |
| `DELETE /rooms/{code}/participants/{id}` | só líder | `204` |

Arquivos novos, seguindo o layout já estabelecido:

```
Contracts/Rooms/          RoomDto, RoomLeaderDto, ParticipantDto,
                          RoomAvailabilityResponse, JoinRoomRequest/Response, UpdateRoomRequest
Services/                 RoomAccessService, RoomService, ParticipantService
Endpoints/                RoomEndpoints, ParticipantEndpoints
Common/Json/              UtcDateTimeOffsetJsonConverter
Common/RateLimiting/      RateLimitPolicies
Data/Migrations/          20260801190154_ParticipantUniqueDisplayName
```

---

## 2. Autorização: um serviço, não um filtro de endpoint

O `api-init.md` previa a regra "é o líder desta sala" como **um filtro de endpoint** comparando
`principal.GetUserId()` com `Room.LeaderUserId`. Na hora de escrever, virou um serviço
(`RoomAccessService`) pelo motivo mais simples possível: o filtro precisaria carregar a sala para
decidir, e o handler precisa da *mesma* sala logo em seguida — seriam duas consultas pelo mesmo
registro em toda rota de líder. O serviço devolve a entidade que já carregou.

São três perguntas, e cada rota escolhe a sua:

- **`GetActiveRoomAsync`** — "existe?" Usada pelo `availability` e pelo `POST` de participante, as
  duas rotas que qualquer um pode chamar.
- **`GetRoomAsLeaderAsync`** — "quem chamou é o dono?" `403 NOT_ROOM_LEADER` caso contrário. Um
  token de participante nunca passa aqui, mesmo que o participante esteja logado, porque a seção 1
  é explícita: *rotas de líder exigem que o `userId` seja o dono da sala*.
- **`GetRoomAsMemberAsync`** — "quem chamou está nesta sala?" Líder ou participante não recusado.

Nenhum endpoint usa `RequireAuthorization()`. Sessão ausente é um estado válido em todas essas
rotas (um convidado consultando um código), e quando falta credencial o contrato pede um `code`
específico — `ACCOUNT_REQUIRED`, `NOT_ROOM_LEADER`, `ROOM_NOT_FOUND` — que um `401` vazio do
pipeline não saberia escolher.

### `GET /rooms/{code}` exige ser membro — e responde 404, não 403

O contrato não diz quem pode ler uma sala. Ele diz outra coisa, sobre a mesma rota: *"nunca confie
no front para esconder dado de líder"*. O mesmo raciocínio vale para a sala inteira — o código de 6
dígitos é a única credencial que ela tem, então quem não entrou (nem é o líder) não lê.

Quando o chamador não é membro, a resposta é `404 ROOM_NOT_FOUND` e não `403`: um 403 confirmaria
para um estranho que aquele código existe, que é exatamente o que a proteção de força bruta tenta
evitar. Bônus: a UI já tem diálogo para `ROOM_NOT_FOUND` e não tem para um 403 genérico nessa tela.

**Participante `pending` também lê a sala** — é dela que sai o nome do líder no texto "Aguardando
… iniciar a partida" que o aluno vê enquanto espera aprovação.

---

## 3. Resolver o código da sala

`Room.Code` não é único no schema (decisão do `api-init.md`, seguindo a seção 13: códigos de 6
dígitos são reciclados quando a sala expira). A consequência prática aparece agora: `"482913"` pode
existir várias vezes na tabela, e a busca precisa decidir qual vale.

`GetActiveRoomAsync` resolve para **a sala mais recente com aquele código que ainda não expirou**
(`ExpiresAt == null || ExpiresAt > now`). Isso faz a reciclagem funcionar sem nenhum job de
limpeza: uma sala expirada some da busca no instante em que expira, mesmo que a linha continue no
banco.

Código fora do formato (não são exatamente 6 dígitos) nem chega ao banco — é `404 ROOM_NOT_FOUND`
igual. Um `400` daria ao atacante um sinal diferente entre "malformado" e "não existe", e o front
nunca produz um código malformado de qualquer forma.

---

## 4. Seção 3 — entrar numa sala

### As quatro checagens rodam duas vezes, de propósito

O contrato desenha um fluxo de dois passos "porque os erros precisam aparecer em telas diferentes".
Isso é **conveniência de UX, não autorização**: o passo 1 (`availability`) pode simplesmente não ter
sido chamado, ou ter sido chamado 30 segundos antes de a sala encher. Por isso `EnsureJoinableAsync`
vive no `RoomService` e é chamado pelas duas rotas — o `POST` nunca confia que o `GET` rodou.

A ordem é a que faz sentido: existir → estar aberta → aceitar quem não tem conta → ter vaga.

### `ROOM_FULL`: pendente ocupa vaga, recusado não

O contrato não define o que conta para a capacidade. A escolha: **vaga ocupada = participante não
recusado**, isto é, `pending` + `approved`.

Pendente conta porque ele já está na fila de aprovação e vira `approved` com um clique — ignorá-lo
deixaria a sala estourar a capacidade no momento em que o líder aprovasse todo mundo. Recusado não
conta porque não vai voltar sozinho, e segurar a vaga dele puniria a sala por uma decisão que o
líder já tomou.

Isso tem um efeito secundário no `approve`: readmitir alguém recusado é o único caminho que
*aumenta* a ocupação, então é o único que precisa checar `ROOM_FULL` de novo. Os demais aprovam
alguém que já estava contado.

### Sala encerrada reusa `ROOM_LOCKED`

Uma sala com `status: finished` não aceita mais ninguém. O contrato não tem um `code` para "a
partida acabou", e inventar um significaria uma tela nova que ninguém desenhou — então ela responde
`423 ROOM_LOCKED`, cujo diálogo ("Sala fechada") descreve a situação com precisão.

Sala `running` **continua aceitando** entrada: chegar atrasado numa aula é normal, e o líder já tem
o `locked` para impedir isso quando quiser.

### `USERNAME_TAKEN` é garantia do banco, não só um `SELECT`

A checagem no serviço é um `SELECT` seguido de um `INSERT` — duas pessoas mandando o mesmo nome no
mesmo instante passam pelas duas. Quem decide de fato é um **índice único parcial** novo:

```sql
CREATE UNIQUE INDEX ix_participants_room_display_name_unique
  ON participants ("RoomId", "DisplayNameNormalized")
  WHERE "Status" <> 'Rejected';
```

Duas decisões embutidas aí:

- **Comparação sem diferenciar maiúsculas.** "Ana" e "ana" na mesma lista são dois cards que o líder
  não consegue distinguir — que é exatamente o que `USERNAME_TAKEN` existe para evitar. Postgres não
  aceita expressão (`lower(...)`) num índice declarado pelo EF, então `DisplayNameNormalized` é uma
  coluna **gerada pelo banco** (`GENERATED ALWAYS AS (lower("DisplayName")) STORED`). Nenhum código
  lê esse valor; ela existe só para sustentar o índice.
- **Parcial.** Recusado não segura o nome: quem foi recusado sai da lista, e o nome volta a ficar
  livre para outra pessoa (ou para a mesma tentando de novo).

`ParticipantService` traduz a violação dessa constraint de volta em `409 USERNAME_TAKEN`, olhando o
**nome** da constraint para não confundir com qualquer outra unicidade que a tabela venha a ter.

### Reentrada de quem tem conta

**Isto é um desvio explícito do contrato.** Pelo texto, `POST /rooms/{code}/participants` sempre
cria; o mesmo usuário voltando à mesma sala esbarraria em `USERNAME_TAKEN` com o próprio nome, ou
criaria um segundo card no lobby.

Quando o chamador está autenticado e já tem um participante não-recusado naquela sala, a rota
**reassume esse participante** (atualizando nome e avatar) em vez de criar outro. O status não é
tocado: quem já era `approved` continua aprovado, quem era `pending` continua esperando.

Para convidado não existe reentrada — ele não tem identidade estável entre requests, então
recarregar a página é sempre um participante novo. Essa assimetria é inerente a não ter conta, não
uma escolha.

### O token do participante

`{token, expiresIn}` tem o mesmo papel do `AuthResponse` do login: o servidor do Next grava no
cookie `codex_session`. `expiresIn` é `14400` (4 h), de `CodexApi:GuestParticipantLifetimeHours`,
batendo com o exemplo do contrato.

**Limitação:** a seção 1 diz que a sessão do convidado "expira junto com a sala", e 4 h fixas não
são isso. `Room.ExpiresAt` existe no schema mas nada preenche esse campo ainda (continua na lista
do `api-init.md`); quando alguém preencher, o lugar de corrigir é o cálculo de `expiresAt` no
`ParticipantService.JoinAsync`.

---

## 5. O token passou a cobrir os dois sujeitos ao mesmo tempo

O `api-init.md` registrou que `SessionTokenPayload` carrega usuário **ou** participante, "nunca os
dois". A seção 3 obriga a rever isso: quando alguém **com conta** entra numa sala, os dois fatos são
simultâneos — continuar sendo "a Marina" e ser "o participante p_9 da sala 482913". Emitir só o
participante deslogaria a pessoa da própria conta no ato de entrar numa sala.

Então o token emitido pelo `POST` de participante preserva o `userId` do chamador quando ele existe.
Duas consequências:

- **`GET /session` mudou.** Antes, se havia `userId`, ele respondia `(user, null, null)`. Agora os
  três campos são independentes: um aluno logado dentro de uma sala recebe `user` **e**
  `participantId` **e** `roomCode`. O lobby precisa do `participantId` para saber qual card é o
  "você". O exemplo do contrato (user preenchido, `participantId: null`) continua correto — é o caso
  de quem está logado e fora de qualquer sala.
- **A sessão de conta encurta para 4 h ao entrar numa sala**, porque o token novo substitui o
  anterior e usa a duração de participante. Aceitável por ora, mas é um efeito colateral real: quem
  marcou "lembrar de mim" (30 dias) e entrou numa sala volta a ter 4 h. Consertar exige ou dois
  cookies separados no servidor do Next, ou carregar a expiração original no payload para preservá-la
  — nenhum dos dois vale a complexidade antes de alguém reclamar.

---

## 6. Contrato JSON: duas correções

### `matchMode` em kebab-case (fecha a ressalva do `api-init.md`)

O `api-init.md` seção 5 deixou registrado que `"mode": "self-paced"` não sairia certo pelo
`JsonStringEnumConverter` camelCase global (viraria `"selfPaced"`), e que isso precisaria de
tratamento quando os endpoints de partida chegassem. **Chegou antes**: `matchMode` faz parte do
payload de `GET /rooms/{code}`, na seção 4.

A correção é um converter específico registrado **antes** do geral (converters são avaliados em
ordem; invertido, o camelCase pegaria `MatchMode` primeiro):

```csharp
options.SerializerOptions.Converters.Add(new JsonStringEnumConverter<MatchMode>(JsonNamingPolicy.KebabCaseLower));
options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
```

Verificado: `"matchMode":"self-paced"` com `"status":"running"` na mesma resposta.

### Datas terminam em `Z`

Todos os exemplos do contrato usam `"2026-07-29T14:02:11Z"`; o padrão do System.Text.Json para
`DateTimeOffset` é `+00:00`. Os dois são ISO-8601 válido e o `Date` do JS aceita ambos, mas cumprir
o contrato à risca custa um converter de 20 linhas.

Efeito colateral aceito: a precisão **na resposta** cai para segundos. Nenhum exemplo do doc tem
fração e nada no front ordena por timestamp (ordenação é sempre do servidor). O que está gravado no
Postgres continua completo.

---

## 7. Rate limiting — e por que ele ainda é fraco

`RATE_LIMITED` era item 6 da lista "o que falta" do `api-init.md`, mas o único uso documentado dele
é "proteção de força bruta **no código da sala**" — ou seja, é parte do contrato da seção 3, então
entrou agora. Janela fixa, 30 tentativas/minuto (`CodexApi:RoomCodeAttemptsPerMinute`), aplicada ao
`availability` e ao `POST` de participante, que compartilham a mesma partição.

**A partição é o código da sala, não o cliente — e essa é a limitação importante.** Quem chama é
sempre o servidor do Next (seção 1), então todos os alunos chegam do mesmo IP: limitar por IP
puniria a turma inteira junto. Por código, uma sala específica não pode ser martelada, mas alguém
varrendo *muitos* códigos diferentes cai numa partição nova a cada tentativa e passa por baixo —
que é justamente o formato de um ataque de força bruta ao espaço de códigos.

Fechar isso exige identificar o cliente final: o servidor do Next teria que repassar o IP do browser
num header (`x-forwarded-for` ou equivalente), e a API teria que confiar nele por vir junto do
`x-service-token`. **Isso não está no contrato** e é um ponto para alinhar com quem escreve o front.

O limitador rejeita antes de qualquer código do app rodar, então ele mesmo escreve o `{code,
message}` — o `ApiExceptionHandler` nunca vê essas requests.

---

## 8. Códigos de erro fora da tabela do contrato

A tabela da seção 1 só cataloga erros que têm diálogo próprio na UI. Dois casos que o front não
consegue produzir jogando normalmente precisavam de resposta mesmo assim:

| `code` | Quando |
|---|---|
| `VALIDATION_ERROR` (400) | `displayName` vazio ou > 80 chars, `avatarIndex` negativo, `capacity` fora de 1–500, `?status=` diferente de `approved`/`pending` |
| `PARTICIPANT_NOT_FOUND` (404) | id de participante que não existe **ou** existe em outra sala |

Ambos caem no tratamento genérico de falha da UI ("qualquer outra falha a UI trata como `network`"),
que é o comportamento correto para um bug de integração.

`PARTICIPANT_NOT_FOUND` é `404` e não `403` pelo mesmo motivo do `GET /rooms/{code}`: para o líder
desta sala, um participante de outra sala simplesmente não existe.

---

## 9. Detalhes menores, decididos sem o contrato

- **`?status=` ausente assume `approved`.** É o que o lobby do jogador pede, e é o único valor que
  qualquer membro pode ver — um default que vazasse a fila de espera seria a falha errada de se ter.
  `?status=rejected` não é aceito: não está no contrato e nenhuma tela mostra recusados.
- **A lista sai ordenada por `joinedAt`**, aproveitando o índice `(RoomId, Status, JoinedAt)` que já
  existia desde o `api-init.md`.
- **`PATCH` aceita diminuir `capacity` abaixo de quem já está na sala.** Só fecha a porta para novos
  (`ROOM_FULL`); expulsar gente para caber no número novo seria destrutivo e não está em lugar nenhum
  do contrato.
- **Os três campos do `PATCH` são independentes.** O exemplo do doc manda os três juntos, mas os
  toggles da UI de líder são separados, então `null` significa "não mexe" e não "apaga".
- **`RoomLeaderDto` tem só `id` e `name`.** Email e plano do líder não aparecem em nenhum pixel.
- **`approve`/`reject` são idempotentes**; `DELETE` apaga a linha, `reject` a mantém com
  `status: rejected`. É o que faz o nome e a vaga do recusado voltarem a ficar livres.

---

## 10. O que esta leva **não** faz

- **Nenhum evento de realtime é publicado.** O contrato pede `room.settings` no `PATCH`,
  `participant.updated` no approve/reject e `participant.left` no delete. O canal WebSocket mora num
  projeto Node separado (decisão registrada no `api-init.md`) e **como esse projeto vai saber que
  algo mudou continua não decidido**. Os três pontos estão marcados com `// TODO(realtime)` no
  código, exatamente onde a publicação entra.
- **`Room.ExpiresAt` continua sem ser preenchido por ninguém.** A busca por código já respeita o
  campo, então o dia em que algo preencher, a expiração passa a funcionar sem outra mudança.
- **Sem cache HTTP.** Nada nestas duas seções é cacheável — a seção 1 é explícita: "tudo que é de
  partida ou lobby é `no-store`".

### Lacunas do próprio contrato

Duas coisas que a seção 4 pressupõe mas nenhuma seção do `api-rest.exemple.md` define:

1. **Não existe rota para criar uma sala.** As seções 1–14 descrevem a sala sendo consultada,
   editada, preenchida de fases e jogada, mas nada a cria — não há `POST /rooms` em lugar nenhum, e o
   mapa "tela → rotas" da seção 14 também não lista uma. Não inventei a rota: um `POST /rooms` meu
   provavelmente conflitaria com o que o contrato vai definir (quem gera o código de 6 dígitos e como
   se garante que ele é único entre as salas ativas é uma decisão de produto, não de implementação).
   **Consequência prática: hoje não há como criar uma sala pela API.** A verificação abaixo semeou a
   sala direto no Postgres. Essa é a próxima coisa a destravar.
2. **Não existe rota para o participante sair sozinho.** Só o líder remove (`DELETE …/{id}`, rota de
   líder). Um aluno que fecha a aba fica `approved` para sempre e continua ocupando vaga.

---

## 11. Como verificar

```bash
dotnet ef database update --project src/Codex.Api --startup-project src/Codex.Api
dotnet test          # 48 testes, sem precisar de Postgres
dotnet run --project src/Codex.Api
```

`dotnet test` cobre as duas seções em `RoomServiceTests` e `ParticipantServiceTests` (37 testes
novos) usando EF InMemory, como os testes de auth. **O que esses testes não cobrem:** o índice único
parcial, porque InMemory não tem índices — o que eles exercitam é a checagem do serviço. A constraint
em si foi verificada contra o Postgres real.

Rodado ponta a ponta nesta sessão contra um Postgres 18 local, com a sala semeada via SQL: as 8
rotas nos caminhos felizes e em `ROOM_NOT_FOUND` (código inexistente, malformado, e não-membro
lendo a sala), `ROOM_LOCKED`, `ACCOUNT_REQUIRED` (no `availability` e no `approve`), `ROOM_FULL`,
`USERNAME_TAKEN` (incluindo com caixa diferente), `NOT_ROOM_LEADER` (no `PATCH` e no
`?status=pending`), `VALIDATION_ERROR`, `PARTICIPANT_NOT_FOUND` e `RATE_LIMITED` — mais a reentrada
do usuário logado devolvendo o mesmo participante, `GET /session` trazendo user e participante
juntos, o nome do recusado voltando a ficar livre, e `"matchMode":"self-paced"` no formato do
contrato.

---

## 12. O que falta agora

A lista do `api-init.md` seção 8, atualizada:

1. ~~Seção 3–4 (entrar em sala, lobby)~~ — feito.
2. ~~Rate limiting~~ — feito para o código da sala, com a ressalva da seção 7 acima.
3. **Rota de criação de sala** — bloqueia todo o resto na prática (ver lacuna 1 acima); precisa de
   decisão de contrato antes de código.
4. **`POST /auth/oauth/{provider}/authorize`** — segue não implementado.
5. **Seção 5–6 (biblioteca de fases, fila da sala)** — `PhaseSetEndpoints`, `QueueEndpoints`;
   inclui a cópia PhaseSet→RoomQueueSet e a paleta fixa de 8 cores sem repetir na sala.
6. **Seção 7–9 (partida, respostas, comparação)** — filtrar gabarito por papel, correção síncrona vs.
   assíncrona, sandbox do `POST …/run`.
7. **Seção 10 (painel do líder)** — agregados de `stats`.
8. **Cache** (`phase-sets` 60 s, `marketing/landing` 300 s).
9. **Job de limpeza de TTL** (`rooms.expiresAt`).
10. **Integração com o projeto de realtime** — os `TODO(realtime)` desta leva são os primeiros
    pontos concretos que dependem dessa decisão.
