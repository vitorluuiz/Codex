# api-init.md — Base do projeto .NET

Este documento registra as decisões tomadas ao criar a base .NET 10 que vai implementar a
API descrita em `api-rest.md`. É um complemento dele, não um substituto: qualquer formato de
request/response continua sendo definido lá.

## Escopo desta base

O pedido foi "criar um projeto dotnet 10 como base" — então esta primeira leva entrega:

- solução, projeto Web e projeto de testes configurados e buildando;
- o modelo de dados completo (seção 13 do `api-rest.md`) traduzido para EF Core/PostgreSQL;
- a infraestrutura transversal que toda rota vai precisar (autenticação de sessão,
  `x-service-token`, formato de erro `{code, message}`);
- **uma fatia vertical completa e funcional** (sessão + login/signup/logout) provando que o
  padrão funciona ponta a ponta, testada contra um Postgres real.

Os demais grupos de rotas (sala/lobby, fila, partida, submissões, painel do líder,
relatórios) **não foram implementados** — só o modelo de dados que eles vão usar. Ver
"O que falta" no fim deste documento.

---

## 1. Arquitetura: Minimal API + camadas simples

Um único projeto Web (`Codex.Api`), sem separação em `Domain`/`Application`/`Infrastructure`
por assembly. Para o tamanho atual do contrato (14 grupos de rotas, um único consumidor —
o servidor Next), uma solução multi-projeto ao estilo Clean Architecture adicionaria
cerimônia sem comprar nada; se o domínio crescer muito, dá pra extrair projetos depois sem
reescrever nada, já que as pastas já separam as responsabilidades:

```
src/Codex.Api/
  Program.cs                 # composição raiz: DI, pipeline HTTP
  Domain/
    Entities/                # entidades EF Core (sem dependencia de EF nos tipos)
    Enums.cs
  Data/
    AppDbContext.cs
    Configurations/          # IEntityTypeConfiguration<T>, um arquivo por entidade
    Migrations/
  Common/
    Auth/                    # token de sessao, handler de autenticacao, x-service-token
    Errors/                  # ApiException, ErrorCodes, handler global de excecao
  Contracts/                 # DTOs de request/response (formato exato do api-rest.md)
  Services/                  # regras de negocio (hoje: AuthService)
  Endpoints/                 # um MapXxxEndpoints(this IEndpointRouteBuilder) por grupo

tests/Codex.Api.Tests/       # xUnit
```

`Endpoints` mapeia 1:1 com as seções do `api-rest.md` (ex.: `SessionEndpoints` = seção 2,
`AuthEndpoints` = parte da seção 2). Quando os próximos grupos forem implementados
(`RoomEndpoints`, `QueueEndpoints`, `MatchEndpoints`, ...), a Regra é a mesma: uma classe
estática por grupo, um `Services/XxxService.cs` com a lógica, DTOs em `Contracts/`.

A solução usa o formato `.slnx` (novo formato de arquivo de solução do .NET 10) em vez do
`.sln` clássico — é o padrão que o próprio `dotnet new sln` gerou.

---

## 2. Persistência: PostgreSQL + EF Core

### Entidades e a tradução do modelo documento-orientado

O `api-rest.md` (seção 13) desenha o modelo em cima do Firestore. Traduzido para relacional:

| Firestore (doc)                        | Entidade EF Core                    |
|-----------------------------------------|--------------------------------------|
| `users/{userId}`                        | `User`                               |
| `rooms/{roomId}`                        | `Room`                               |
| `rooms/{id}/participants/{id}`          | `Participant`                        |
| `phaseSets/{setId}`                     | `PhaseSet`                           |
| `phaseSets/{id}/phases/{id}`            | `Phase`                              |
| `rooms/{id}/queue/{phaseId}` (o array "sets") | `RoomQueueSet`                 |
| `rooms/{id}/queue/{phaseId}`            | `RoomQueuePhase`                     |
| `matches/{matchId}`                     | `Match`                              |
| `matches/{id}/phases/{id}/submissions/{participantId}` | `Submission`          |

Decisões específicas:

- **Campos por "kind" (quiz/fill/text/code) viram uma coluna `jsonb` (`ContentJson` /
  `AnswerJson`), não colunas individuais.** Uma fase `code` e uma fase `quiz` não têm quase
  nenhum campo em comum; modelar como colunas esparsas geraria uma tabela com 15+ colunas
  majoritariamente nulas. A camada de serviço (a ser escrita quando os endpoints de fase
  forem implementados) serializa/desserializa de acordo com `Kind`.
- **"A fila copia a fase, não referencia" (decisão 1 da seção 13) foi levada a sério no
  schema**: `RoomQueueSet.SourcePhaseSetId` e `RoomQueuePhase.SourcePhaseId` são `Guid`
  simples, **sem FK**. Servem só de linhagem/auditoria. Isso impede que editar um `PhaseSet`
  depois altere uma partida em andamento — e também significa que apagar um `PhaseSet` nunca
  pode falhar por causa de uma sala antiga referenciando ele.
- **"1 envio por pessoa por fase" (decisão 2 da seção 13) é um índice único** em
  `Submission` (`RoomQueuePhaseId`, `ParticipantId`), não uma checagem em código — a mesma
  garantia que o doc pede do Firestore (`create` falhando se já existe), só que via
  constraint do Postgres.
- **`Room.Code` tem índice, mas não é único.** O doc explica que códigos de 6 dígitos são
  reciclados quando a sala expira; então unicidade *global* estaria errada — o que precisa
  ser único é "código entre as salas ativas agora", e isso é responsabilidade de quem gera o
  código (ainda não implementado), não do schema.
- **IDs são `Guid` (via `Guid.CreateVersion7()`, sequencial no tempo — bom para localidade de
  índice no Postgres), não os ids curtos do tipo `"u_1"`/`"p_9"` usados nos exemplos do doc.**
  Esses ids curtos são só ilustração no documento; um `Guid` real serializa como string e
  cumpre o contrato (`"id": "019fb4..."`), mas vale avisar o time de frontend que o formato
  não é o dos exemplos.
- **Enums são armazenados como texto** (`.HasConversion<string>()`) em vez de inteiro — mais
  legível numa consulta manual, custo irrelevante no volume de dados esperado.
- **Índices** replicam a tabela da seção 13 (`rooms.code`; `participants` por
  `RoomId+Status+JoinedAt`; `phase_sets` por `OwnerId+UpdatedAt` e por `Visibility+Title`) e
  adicionam o que a seção 13 não cobre mas os outros endpoints vão precisar (ex.:
  `RoomQueuePhase` por `RoomId+OrderIndex` para servir `GET /queue` já ordenado).

### O que não foi modelado (de propósito)

O próprio `api-rest.md` já trata como especulativo/futuro:

- **Relatórios (seção 11)** — "não há tela pronta ainda". Nenhuma entidade `Report`/`Job`.
- **CMS da landing (seção 12)** — "hoje mora em `src/content/landing.ts`... se virar CMS".
  Nenhuma entidade.

Quando esses recursos saírem do campo "se/quando", modelar as entidades correspondentes é
trabalho de uma sessão futura, não desta base.

---

## 3. Autenticação

### Token de sessão: opaco via Data Protection, não JWT

O `Authorization: Bearer <token>` do doc só precisa ser lido por este mesmo backend — "o
browser nunca fala com a API diretamente" (seção 1). Não há necessidade de um formato
verificável por terceiros. Por isso o token é opaco: um JSON (`SessionTokenPayload`:
`UserId?`, `ParticipantId?`, `RoomCode?`, `ExpiresAt`) protegido com
`Microsoft.AspNetCore.DataProtection` (`SessionTokenService`). Isso evita trazer uma
biblioteca de JWT e gerenciar chave assimétrica só para reimplementar o que o Data Protection
já resolve. Trocar para JWT mais tarde (ex.: se um outro serviço precisar validar o token de
forma independente) exige mudar só essa classe — o resto do código depende da interface
`ISessionTokenService`, não do formato.

**Limitação conhecida:** o token é stateless — não existe uma tabela de sessões para revogar
antes do `expiresIn`. Por isso `POST /auth/logout` hoje só devolve `204` (o cliente descarta
o cookie); não há invalidação server-side de fato. Se isso virar um requisito real
(ex.: "derrubar sessão de um usuário banido imediatamente"), o caminho é introduzir uma
tabela `sessions` com uma flag de revogação, checada em `SessionTokenService.TryValidate` —
uma mudança isolada, não uma reescrita.

### `CodexSessionAuthenticationHandler`

Resolve o token em claims (`codex:user_id` **ou** `codex:participant_id` +
`codex:room_code`, nunca os dois — como o doc descreve o "quem está falando" dual). Token
ausente ou inválido vira `AuthenticateResult.NoResult()`, não `Fail()`: isso é o que permite
`GET /session` responder `200` com tudo `null` em vez de `401` quando não há sessão válida
(exigência explícita da seção 2). Endpoints que *precisam* de autenticação vão usar
`.RequireAuthorization()` explicitamente — nenhum foi implementado ainda porque nenhum dos
endpoints desta base exige sessão obrigatória.

Autorização de "é o líder desta sala" (usada nas rotas de líder, seções 4/6/7/10) não foi
modelada como `AuthorizationPolicy` ainda porque nenhum endpoint que precisa dela existe
nesta base — ela é baseada em recurso (precisa saber qual sala a rota está tocando), então
vai nascer junto com `RoomEndpoints`, provavelmente como um filtro de endpoint que compara
`principal.GetUserId()` com `Room.LeaderUserId`.

### `x-service-token`

Middleware separado (`ServiceTokenMiddleware`), roda antes de tudo. **Falha fechado**: se
`CodexApi:ServiceToken` não estiver configurado, a API recusa (500) em vez de aceitar
qualquer chamada — prefiro quebrar em dev sem segredo configurado a rodar em produção sem
essa checagem por engano. Comparação em tempo constante
(`CryptographicOperations.FixedTimeEquals`). `/health` é isento (endpoint de infraestrutura,
sem contexto de sessão).

### Chaves do Data Protection: persistidas no próprio Postgres

`AddDataProtection().PersistKeysToDbContext<AppDbContext>()`. Sem isso, cada instância/reinício
da API geraria uma chave nova e invalidaria os tokens emitidos antes — inviável assim que
houver mais de uma instância rodando. A alternativa comum é um key ring externo (Redis, Blob
Storage); optei por reaproveitar o Postgres que já existe no projeto para não introduzir uma
peça de infra nova só para isso.

---

## 4. Erros: `{code, message}` sempre

- `ApiException(statusCode, code, message)` — serviços lançam isso para qualquer falha de
  regra de negócio.
- `ErrorCodes` — constantes para todos os códigos da tabela da seção 1 **e** os citados ao
  longo do documento (`TOO_MANY_SETS`, `QUEUE_MISMATCH`, `PHASE_CLOSED` etc.), para não
  duplicar strings quando os outros endpoints forem escritos.
- `ApiExceptionHandler : IExceptionHandler` (padrão do ASP.NET Core 8+) — captura
  `ApiException` e devolve `{code, message}` no status certo; qualquer outra exceção não
  tratada vira `500 INTERNAL_ERROR` genérico e vai pro log (a UI trata isso como falha de
  rede, conforme a seção 1 do doc).
- `AddProblemDetails()` está registrado só porque `UseExceptionHandler()` exige alguma
  configuração de fallback para inicializar — na prática nunca é usado, já que
  `ApiExceptionHandler` sempre trata a exceção primeiro.

---

## 5. Contrato JSON

- camelCase (padrão do ASP.NET Core).
- Enums serializam como string camelCase (`JsonStringEnumConverter` global). **Ressalva:**
  o doc usa kebab-case em pelo menos um lugar (`"mode": "self-paced"`), que camelCase não
  reproduz (viraria `"selfPaced"`). Isso não afeta nada implementado nesta base (o único enum
  exposto é `UserPlan`, todo em palavra única), mas quem implementar `MatchEndpoints` vai
  precisar de um `JsonNamingPolicy` específico para esse campo — ou trocar `MatchMode` por
  strings simples no DTO em vez de reusar o enum.

---

## 6. Pacotes principais

| Pacote | Por quê |
|---|---|
| `Npgsql.EntityFrameworkCore.PostgreSQL` | provider Postgres |
| `Microsoft.EntityFrameworkCore.Design` | `dotnet ef migrations` |
| `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore` | persistir chaves de sessão no Postgres |
| `Microsoft.AspNetCore.OpenApi` (+ `Microsoft.OpenApi` fixado em `2.7.5`) | `/openapi` em dev, documento do contrato pro time consumidor. A versão do `Microsoft.OpenApi` foi fixada manualmente porque a que a cadeia de dependências trazia por padrão (`2.0.0`) tem uma CVE (`GHSA-v5pm-xwqc-g5wc`, DoS por referência circular); `2.7.5` é o primeiro patch na série 2.x |

`PasswordHasher<User>` (hash de senha) e `IDataProtectionProvider` já vêm no shared
framework do ASP.NET Core — não precisaram de pacote extra.

---
## 7. Como rodar localmente

```bash
# 1. segredos (nunca em appsettings.json)
cd src/Codex.Api
dotnet user-secrets set "ConnectionStrings:Default" "Host=localhost;Port=5432;Username=postgres;Password=<senha>;Database=codex"
dotnet user-secrets set "CodexApi:ServiceToken" "<qualquer-string-secreta-de-dev>"

# 2. banco (crie o database antes; dotnet ef nao cria o database, so as tabelas)
createdb -h localhost -U postgres codex
dotnet ef database update --project src/Codex.Api --startup-project src/Codex.Api

# 3. rodar
dotnet run --project src/Codex.Api
```

Testado de ponta a ponta nesta sessão contra um Postgres 18 local: `/health`,
`/auth/signup` (+ `409` em email duplicado), `/session` (autenticado e anônimo),
`/auth/login` (sucesso, senha errada, `rememberMe`) e a rejeição por `x-service-token`
ausente — todos responderam exatamente como descrito no `api-rest.md`.

`dotnet test` roda os testes de unidade (xUnit, EF Core InMemory para `AuthService`,
`EphemeralDataProtectionProvider` para `SessionTokenService`) sem precisar de Postgres.

---

## 8. O que falta (fora do escopo desta base)

Ordem sugerida, seguindo a numeração do `api-rest.md`:

1. **`POST /auth/oauth/{provider}/authorize`** — não implementado; precisa decisão de quais
   provedores priorizar (Google/Microsoft/GitHub) e onde guardar client id/secret por
   provedor.
2. **Seção 3-4 (entrar em sala, lobby)** — `RoomEndpoints`, `ParticipantEndpoints`; é aqui
   que a policy de autorização "é o líder" nasce.
3. **Seção 5-6 (biblioteca de fases, fila da sala)** — `PhaseSetEndpoints`, `QueueEndpoints`;
   inclui a lógica de cópia PhaseSet→RoomQueueSet e atribuição de cor da paleta fixa de 8
   tons sem repetir na sala.
4. **Seção 7-9 (partida, respostas, comparação)** — a parte mais sensível: filtrar gabarito
   por papel em `GET /matches/{id}/current-phase`, correção síncrona vs. assíncrona
   (`text`/`code` dependem de IA/execução de testes — nenhuma dessas integrações existe
   ainda), sandbox para `POST .../run`.
5. **Seção 10 (painel do líder)** — agregados de `stats`; considerar se computar on-the-fly
   basta para o volume esperado ou se precisa de contadores incrementais como o doc sugere
   para o Firestore.
6. **Rate limiting** (`RATE_LIMITED`, força bruta no código da sala) — nada configurado;
   candidato natural para `Microsoft.AspNetCore.RateLimiting` (já no shared framework).
7. **Cache** (`phase-sets` 60s, `marketing/landing` 300s) — nenhuma política de cache HTTP
   configurada ainda.
8. **Job de limpeza de TTL** (`rooms.expiresAt`) — a coluna existe, mas nada preenche ou
   consome esse campo ainda.

**Fora do escopo por decisão do usuário:** a camada de realtime (WebSocket/eventos como
`room.settings`, `phase.started`, `submission.graded`) fica num projeto Node.js separado.
Como esse projeto vai saber que algo mudou (ler o Postgres direto, uma fila, um webhook
chamado por esta API) ainda não foi decidido — é um ponto de integração para alinhar quando o
projeto Node existir.
