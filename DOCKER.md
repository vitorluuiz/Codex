# Docker

Como rodar o MVP inteiro (`web`, `realtime`, `api`, `postgres`, `redis`) via
Docker Compose, e o porquê de cada decisão nos Dockerfiles. Para rodar sem
Docker (processos nativos), veja o [`README.md`](README.md).

---

## Visão geral

```
docker-compose.yml
├── postgres/Dockerfile   FROM postgres:16-alpine   (+ init/ opcional)
├── redis/Dockerfile      FROM redis:7-alpine       (+ redis.conf)
├── .NET/Dockerfile       build .NET 10 SDK → runtime ASP.NET 10 alpine
├── realtime/Dockerfile   build Node 20 → runtime Node 20 alpine
└── nextjs/Dockerfile     build Node 20 → runtime standalone Next.js
```

Todos os 5 serviços sobem na mesma rede (`codex`) e se enxergam pelo nome do
serviço (`postgres`, `redis`, `api`), nunca por `localhost` — `localhost`
dentro de um container é o próprio container.

| Serviço | Porta no host | Porta interna |
|---|---|---|
| `web` (Next.js) | `3000` | `3000` |
| `api` (.NET) | `5282` | `8080` |
| `realtime` (Node) | `4001` | `4001` |
| `postgres` | `5433` | `5432` |
| `redis` | `6379` | `6379` |

**Por que Postgres publica `5433` e não `5432`:** em máquinas com um Postgres
nativo instalado (comum em Windows), a porta padrão já está ocupada e o
Docker some silenciosamente atrás dele — a conexão parece cair no container,
mas na verdade autentica contra o Postgres errado. Isso só afeta acesso via
`localhost` a partir do host; entre containers a comunicação continua em
`postgres:5432`.

---

## Dockerfiles

### `nextjs/Dockerfile`

Build multi-stage em 3 fases (`deps` → `builder` → `runner`), usando o
[output `standalone`](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
do Next.js (habilitado em `next.config.ts`). A imagem final não carrega
`node_modules` nem o código-fonte, só o bundle traçado pelo Next
(`.next/standalone` + `.next/static` + `public`) — bem menor que rodar
`next start` puro.

**`NEXT_PUBLIC_*` é build arg, não env var de runtime.** O Next.js embute
essas variáveis no bundle do browser durante `next build`; se fossem passadas
só em `environment:` no compose, o processo do servidor as veria, mas o
JavaScript que chega ao navegador não. Por isso:

```dockerfile
ARG NEXT_PUBLIC_REALTIME_URL
ENV NEXT_PUBLIC_REALTIME_URL=${NEXT_PUBLIC_REALTIME_URL}
```

vem antes do `COPY . .` + `npm run build`, e o `docker-compose.yml` passa o
valor via `build.args`, não via `environment`. **Consequência prática:** mudar
`NEXT_PUBLIC_REALTIME_URL` no `.env` exige rebuildar a imagem
(`docker compose build web`) — reiniciar o container sozinho não pega o valor
novo.

O container roda como usuário não-root (`nextjs`, uid 1001).

### `realtime/Dockerfile`

Multi-stage: builda TypeScript (`tsc`) numa fase com `devDependencies`, e a
fase final reinstala só `dependencies` de produção (`npm ci --omit=dev`) antes
de copiar o `dist/` compilado. Container roda como usuário não-root
(`realtime`, uid 1001).

### `.NET/Dockerfile`

Duas fases: `sdk:10.0-alpine` para `dotnet restore` + `dotnet publish`, depois
`aspnet:10.0-alpine` (runtime, sem SDK) só com o output do publish. Escuta em
`:8080` internamente (`ASPNETCORE_URLS=http://+:8080`) — o compose mapeia isso
para `5282` no host pra bater com o resto da documentação do projeto. Container
roda como usuário não-root (`codex`).

**Migrations do EF Core ficam fora do Dockerfile de propósito** (decisão
tomada ao montar este setup): o container só builda e roda a API. Aplicar
schema num banco de produção automaticamente no boot de um container é
arriscado — dois replicas subindo ao mesmo tempo podem disputar a mesma
migration. Migrations continuam manuais, veja [Migrations](#migrations-do-ef-core).

### `postgres/Dockerfile` e `redis/Dockerfile`

Wrappers finos sobre as imagens oficiais — existem principalmente para dar a
cada serviço seu próprio Dockerfile versionado (em vez de referenciar a
imagem oficial direto no compose) e para ter um lugar óbvio de estender:

- `postgres/init/*.sql` roda em `/docker-entrypoint-initdb.d/` **só na
  primeira inicialização** (volume de dados vazio). Hoje é só um placeholder;
  é onde entrariam `CREATE EXTENSION` ou schemas extras antes das migrations
  do EF Core.
- `redis/redis.conf` liga append-only file (`appendonly yes`) e limita memória
  (`maxmemory 256mb`, `allkeys-lru`). A senha **não** fica no `.conf` — é
  injetada em runtime via `--requirepass` no `command:` do compose, lida de
  `REDIS_PASSWORD`.

---

## `docker-compose.yml`

### Variáveis e segredos

Nada de segredo fica hardcoded em Dockerfile ou compose. Tudo vem de um
`.env` na raiz (não versionado — está no `.gitignore`), com `.env.example`
como referência. Copie e preencha antes do primeiro `up`:

```bash
cp .env.example .env
```

| Variável | Usada por | Observação |
|---|---|---|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `postgres` | cria o banco/role na primeira subida |
| `REDIS_PASSWORD` | `redis`, `api`, `realtime` | ver nota abaixo sobre o healthcheck |
| `API_SERVICE_TOKEN` | `api`, `realtime`, `web` | precisa ser **idêntico** nos três — é o mesmo segredo descrito no `README.md` |
| `NEXT_PUBLIC_REALTIME_URL` | `web` (build arg) | exige rebuild da imagem se mudar |
| `SESSION_COOKIE_NAME` | `web`, `realtime` | precisa bater nos dois lados |
| `REALTIME_ALLOWED_ORIGINS` | `realtime` | CORS do handshake do WebSocket |
| `OAUTH_REDIRECT_BASE_URL` | `api` | origem do **Next** (`http://localhost:3000` em dev), não a da API — é para lá que o provedor devolve o browser |
| `OAUTH_{GOOGLE,MICROSOFT,GITHUB}_CLIENT_ID` / `_SECRET` | `api` | opcionais e independentes: vazio desliga só aquele provedor (`501 OAUTH_PROVIDER_NOT_CONFIGURED`) |

**Pegadinha do `REDIS_PASSWORD`:** o serviço `redis` usa a senha de duas
formas — como argumento do `command:` (`--requirepass "${REDIS_PASSWORD}"`,
resolvido pelo Compose no host) e dentro do healthcheck
(`redis-cli -a $${REDIS_PASSWORD} ping`, resolvido **dentro do container**).
Para a segunda funcionar, `REDIS_PASSWORD` também precisa estar em
`environment:` do serviço — só em `command:` não é suficiente, porque
`command:` não define variável de ambiente nenhuma para outros processos
lerem.

### Ordem de subida

```
postgres ──┐
           ├─▶ api ──▶ realtime ──▶ web
redis ─────┘
```

`api` e `realtime` esperam `postgres` e `redis` ficarem `healthy`
(`depends_on: condition: service_healthy`), não só "started" — isso evita a
API tentar conectar num Postgres que ainda está inicializando.

### Rede e volumes

- Rede `codex` (bridge) compartilhada pelos 5 serviços.
- Volume nomeado `postgres_data` persiste os dados entre `docker compose down`
  / `up`. Só é apagado com `docker compose down -v`.

---

## Rodando

```bash
cp .env.example .env        # preencher POSTGRES_PASSWORD, REDIS_PASSWORD, API_SERVICE_TOKEN
docker compose up -d --build
```

### Migrations do EF Core

O container da API não migra sozinho. Num banco novo (primeira subida, ou
depois de `down -v`), rode do host, com [`dotnet-ef`](https://learn.microsoft.com/ef/core/cli/dotnet)
instalado:

```bash
cd .NET/src/Codex.Api
ConnectionStrings__Default="Host=localhost;Port=5433;Database=<POSTGRES_DB>;Username=<POSTGRES_USER>;Password=<POSTGRES_PASSWORD>" \
  dotnet ef database update --project . --startup-project .
```

Sem isso, a API sobe mas quebra no primeiro request que toca o banco
(`relation "DataProtectionKeys" does not exist` é o sintoma mais comum).

### Conferindo

```bash
curl http://localhost:3000/                          # 200
curl http://localhost:5282/health                     # {"status":"ok"}
curl http://localhost:4001/health

docker compose ps                                     # todos "healthy" ou "running"
docker compose logs -f api                             # logs de um serviço
```

### Encerrando

```bash
docker compose down       # para e remove containers; mantém postgres_data
docker compose down -v    # idem, e também apaga os dados do Postgres
```

---

## Quando não funcionar

| Sintoma | Causa provável |
|---|---|
| `redis` fica `unhealthy` e derruba `api`/`realtime` | `REDIS_PASSWORD` vazio ou ausente do `.env` |
| Conexão do host com Postgres falha com senha errada mesmo com `.env` certo | outro Postgres nativo ocupando `5432` — use a porta `5433` do compose, não `5432` |
| `relation "DataProtectionKeys" does not exist` nos logs da API | faltou rodar as migrations (seção acima) |
| Front-end conecta no WebSocket errado mesmo após mudar `.env` | `NEXT_PUBLIC_REALTIME_URL` é build arg — rode `docker compose build web` |
| WebSocket fecha logo após conectar / API responde `401` em tudo | `API_SERVICE_TOKEN` diferente entre `api`, `realtime` e `web` no `.env` |
| `api` reclama de `libgssapi_krb5.so.2` nos logs | inofensivo — probe do Npgsql por GSSAPI/Kerberos; a API usa autenticação por senha |

---

## Produção

Este compose foi desenhado para **desenvolvimento local**. Para produção,
veja a seção "Produção" do [`README.md`](README.md) — os mesmos princípios
valem (nenhum `.env` versionado, Redis obrigatório com mais de uma réplica,
`REALTIME_ALLOWED_ORIGINS` sem `*`), mas orquestração real (réplicas,
rolling deploy, secrets gerenciados) fica fora do escopo destes
Dockerfiles/compose.
