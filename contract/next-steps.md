# Próximos passos (curto prazo)

Baseado em: `contracts2/api-rest-contract.md`, `contracts2/websocket-contract.md`,
`contracts2/api-implementation-status.md`, as listas "o que falta" de
`contract/api-init.md` §8 e `contract/api-lobby.md` §12, e no estado atual do
working tree do Next (`src/app/conjunto/`, `src/app/perfil/`,
`src/components/set-editor/`, `src/components/profile/` já existem sem backend
que os alimente).

Ordenado por **o que destrava mais coisa primeiro** — não pela ordem numérica do
contrato.

---

## 1. `POST /rooms` (criar sala) — desbloqueador nº 1

**Por quê primeiro:** é o único gap que impede qualquer demonstração ponta a
ponta hoje. Sem ele, toda sala usada em teste precisa ser semeada via SQL
direto no Postgres (como em `api-lobby.md` §11). O botão "Criar sala" do perfil
e o "Iniciar" no card de um conjunto já existem no front e chamam essa rota.

**Decisões de produto pendentes antes de codar** (registradas como bloqueio em
`api-lobby.md` §10):
- Como gerar o código de 6 dígitos e garantir unicidade **entre salas ativas**
  (não globalmente — códigos são reciclados quando a sala expira).
- O que acontece quando `setId` é enviado: o contrato diz que a sala nasce com
  as fases daquele conjunto já na fila — isso antecipa parte da seção 6
  (cópia PhaseSet → RoomQueueSet), então dá para nascer junto com ela.

**Escopo de implementação:** `RoomEndpoints` novo `MapPost("")`,
`RoomService.CreateAsync`, geração de código, e (se `setId` vier) a lógica de
cópia que a seção 6 também vai precisar — vale escrever uma vez só.

---

## 2. Seção 5 — Conjuntos de fases (biblioteca + editor)

**Por quê agora:** o front já está pronto e sem uso (`src/app/conjunto/`,
`src/components/set-editor/`, `src/lib/actions/phaseSets.ts` — todos no
working tree, não commitados ainda). É o maior "trabalho de UI parado esperando
API" do projeto neste momento.

**Rotas:** `GET /phase-sets`, `GET /phase-sets/{id}/draft`, `POST /phase-sets`,
`PUT /phase-sets/{id}/draft`, `PATCH /phase-sets/{id}`, `DELETE /phase-sets/{id}`.

**O que fica para depois, de propósito:** `POST /phase-sets/phases/generate`
(geração por IA) depende de escolher um provedor/modelo — pode ficar de fora da
primeira fatia sem travar o resto do editor (o front deveria degradar
graciosamente sem o botão "Gerar com IA", não é um requisito de bloqueio).

**Atenção ao contrato:** `Phase` (visão de partida, gabarito escondido) e
`DraftPhase` (visão de editor, gabarito visível) são formatos **diferentes** da
mesma entidade — não é só filtrar campos de um DTO único, os dois têm shape
diferente por `kind` (ver tabela na seção 5 do contrato).

---

## 3. Seção 2 — `PATCH /users/me` e `GET /users/{userId}/profile`

**Por quê agora:** mesmo padrão do item 2 — `src/app/perfil/` e
`src/components/profile/` já existem no front. Estas duas rotas são
tecnicamente independentes da seção 5, então podem ser feitas em paralelo por
outra pessoa sem conflito de arquivo.

**Ressalva do contrato:** `GET /users/{userId}/profile` aceita o literal `me` e
resolve pela sessão — não é uma segunda rota, é o mesmo handler com uma
resolução de id a mais. `playedAtLabel`/`durationLabel` precisam vir formatados
do servidor (o front não tem biblioteca de datas) — isso antecipa cálculo de
duração de partida, que só faz sentido depois que a seção 7 existir; até lá,
esses dois campos podem ficar vazios/mockados no nível de serviço sem quebrar
o contrato.

---

## 4. Seção 6 — Fila de fases da sala (líder)

**Por quê depois da seção 5, não antes:** toda a fila é "cópia de fases de um
`PhaseSet`" — sem endpoints de conjunto, não há o que copiar. Faz sentido
escrever logo em seguida porque reusa a mesma lógica de cópia que `POST /rooms`
(item 1) precisa quando recebe `setId`.

**Atenção:** todas as mutações devolvem a fila inteira recalculada (não é
REST "puro" por design — é para não haver refetch por clique). A cor por
conjunto (paleta fixa de 8 tons, sem repetir na sala) é decidida no servidor.

---

## 5. Decisão de arquitetura do realtime — travando, mesmo sem endpoint novo

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

## 6. Rate limiting por IP real (fechar a lacuna conhecida)

`contract/api-lobby.md` §7 documenta que o rate limit de força bruta no código
da sala particiona por código, não por cliente — porque toda chamada vem do
servidor do Next, então todo mundo chega do mesmo IP. Fechar isso exige o
servidor do Next repassar o IP do browser (`x-forwarded-for` ou equivalente) e
a API confiar nesse header quando vier junto do `x-service-token`. **Não está
decidido no contrato ainda** — precisa alinhamento entre quem mantém o Next e
quem mantém a API antes de codar.

---

## 7. `Room.ExpiresAt` — preencher o campo que já existe

A coluna existe no schema desde a base inicial e a busca por código já respeita
ela (`GetActiveRoomAsync` ignora sala expirada), mas nada a preenche ainda.
Curto prazo porque é pouco código (calcular e gravar `ExpiresAt` no momento
certo — criação da sala? início da partida? fim da partida?) e destrava:
- reciclagem de código de 6 dígitos funcionando de verdade;
- a sessão de convidado "expirar junto com a sala" (hoje é 4h fixas, um desvio
  conhecido do contrato registrado em `api-lobby.md` §4).

---

## O que fica deliberadamente fora do curto prazo

Registrado aqui para não ser esquecido, mas não é a próxima coisa a fazer:

- **Seções 7–9 (partida, respostas, comparação)** — maior fatia restante, mas
  depende de decisões de produto que as seções anteriores não têm (IA para
  corrigir `text`, sandbox de execução para `code`). Só faz sentido atacar
  depois que sala + fila (itens 1 e 4) existirem de ponta a ponta.
- **Seção 10 (painel do líder)** — depende inteiramente da seção 7 existir
  primeiro (não há fase corrente para ter estatística de).
- **Seção 11 (relatórios)** — o próprio contrato registra que não há tela
  pronta ainda.
- **OAuth (`POST /auth/oauth/{provider}/authorize`)** — precisa decisão de
  produto (quais provedores: Google/Microsoft/GitHub) antes de qualquer código.
- **Cache HTTP** (`phase-sets` 60s, `marketing/landing` 300s) — sem valor até
  as rotas que ele cachearia existirem.
- **Job de limpeza de TTL** — depende do item 7 acima estar resolvido primeiro.
