# Entrar de volta, e sair de vez — registro de decisão

> Duas levas no mesmo arquivo porque são a mesma história pelos dois lados: §1–§8
> deram caminho de volta a quem **saiu sozinho** da sala; §9 deu caminho de saída
> a quem **foi tirado** dela.

Leva que fechou uma lacuna que nenhuma seção do contrato cobria: **sair da página
não era um caminho sem volta por design, mas na prática era.** Fechar a aba do
lobby não tira ninguém da sala — o `Participant` continua na tabela, a `Room`
continua `lobby` —, mas o único jeito de voltar era digitar o código de 6
dígitos. O líder nunca o decorou (`POST /rooms` o gera no servidor e o front só
navega), e o convidado já esqueceu.

Contexto de leitura: `contract/api-rest-contract.md` §4 (rota nova),
`contract/api-queue-log.md` §1 (a fila é leader-only, e é o que decide o que sai
no payload) e `contract/next-steps.md` §1 (TTL de sala, de que este trabalho
depende para envelhecer bem).

---

## 1. O que entrou

| Onde | O quê |
|---|---|
| API | `GET /rooms/active` — `Endpoints/RoomEndpoints.cs` · `RoomService.ListActiveAsync` · `Contracts/Rooms/ActiveRoomDto.cs` |
| API | `LabelFormatter.SetTitleLabel` — regra "primeiro conjunto nomeia, resto vira contagem", movida de `UserProfileService` |
| Front | `ActiveRoom` em `src/lib/types.ts`, `getActiveRooms()` em `src/lib/api/rooms.ts`, `roomPath()` em `src/lib/roomPath.ts` |
| Front | `src/components/room/` (`ResumeRoomPanel`, `activeRoomLabels`) — o bloco de retomada de `/sala` |
| Front | `MatchHistorySection` ganhou as salas de pé acima do histórico; `ProfileView` e as duas páginas de perfil passam a lista |
| Testes | `tests/Codex.Api.Tests/ActiveRoomsTests.cs` (15 casos) |

Os 248 testes passam (`dotnet test`), o front compila (`next build`) e tipa
(`tsc --noEmit`).

---

## 2. Por que uma rota nova, e não um campo do perfil

A alternativa óbvia era acrescentar `activeRooms` ao
`GET /users/{userId}/profile` — é lá que a tela mostra. Não dá, e o motivo é de
segurança, não de gosto:

**aquela rota é pública.** Ela aceita um `userId` no caminho justamente para o
lobby poder linkar "Ver perfil" de um jogador. O código de 6 dígitos é a **única
credencial da sala** (é o que `RoomAccessService` protege, e é por isso que
`GET /rooms/{code}` responde `404` — e não `403` — a quem não é membro). Servir
o código dentro de um perfil que qualquer um abre entregaria a estranhos a chave
de todas as salas abertas da pessoa, contornando por fora toda a autorização de
sala.

`GET /rooms/active` resolve **pela sessão** e não tem por onde receber um id de
outra pessoa. É a mesma forma do `GET /session`, e o front reflete isso: a página
`/perfil/[userId]` só chama a rota quando `isOwnProfile`, senão mostraria as
minhas salas debaixo do nome de outro.

---

## 3. O que sai no payload, e o que não sai

`ActiveRoomDto` não é um `RoomDto` reduzido. É o cartão de retomada: o que era
esta sala, quanta gente tem, quando começou. Quem volta chama `GET /rooms/{code}`
normalmente na tela seguinte.

**`setTitle` e `phaseCount` só vão para o líder.** Foi a decisão menos óbvia
desta leva. A fila é o roteiro da aula com os nomes das fases que ainda não foram
jogadas, e `GET /rooms/{code}/queue` responde `403 NOT_ROOM_LEADER` a qualquer
outro — inclusive participante aprovado (`api-queue-log.md` §1). Um resumo dela
aqui contornaria essa regra por outra porta. Para o participante os dois vêm
`null` e o cartão se identifica pelo `leaderName`, que ele já lê no lobby em
"Aguardando … iniciar a partida".

`participantCount` sai para os dois, e isso não é incoerência:
`GET /rooms/{code}/participants?status=approved` já é aberto a qualquer membro.

**`role`** (`leader` | `participant`) é derivado (`Room.LeaderUserId == userId`),
não uma coluna. Existe no payload porque o front decide duas coisas com ele: em
qual aba do perfil a linha aparece, e quais campos ele pode desenhar.

**`SetTitleLabel` mudou de casa.** Nasceu privado no `UserProfileService`, para a
linha do histórico. Agora está no `LabelFormatter`, porque a rota nova nomeia a
sala pela mesma regra — se divergissem, a **mesma sala** teria um nome enquanto
estivesse de pé e outro depois de encerrada.

---

## 4. Quem é "sala ativa"

`Status != finished` **e** não expirada (`ExpiresAt == null || ExpiresAt > agora`
— o mesmo predicado de `RoomAccessService.GetActiveRoomAsync`).

- **Encerrada fica de fora** porque retomá-la não leva a lugar nenhum:
  `EnsureJoinableAsync` já recusa entrada em sala `finished`, e é o `matches` do
  perfil que a registra.
- **`running` fica dentro.** Era um requisito explícito ("a sala pode estar em
  andamento para entrar"), e casa com a regra que já existia: sala em andamento
  continua aceitando gente, e é o `locked` que o líder usa para fechar a porta. O
  front manda para `/sala/{code}/partida` em vez do lobby (`roomPath`).
- **Recusado não tem sala para voltar** (`Status != Rejected` na checagem de
  participação) — é a mesma exclusão que a contagem de vagas e a checagem de nome
  já fazem.

**Teto de 10 salas**, das mais recentes para as mais antigas. Isto é dívida
emprestada do item 1 do `next-steps.md`: enquanto `Room.ExpiresAt` não for
preenchido, "sala ativa" é literalmente "sala que ninguém encerrou", e um
professor que abre uma sala por aula acumula a lista inteira, para sempre. Cortar
mantém o cartão útil — quem quer retomar quer a de agora, não a de março. Quando
o TTL existir, a lista encolhe sozinha e o teto vira folga.

---

## 5. Sem sessão é `200 []`, não erro

`POST /rooms` e `GET /users/me/profile` respondem `403 ACCOUNT_REQUIRED` a quem
chega sem conta, com o argumento de que "o front só monta essas telas para quem
está logado, então chegar sem `userId` é bug de integração". **Aqui o argumento
não vale**, e por dois motivos:

1. quem chama é a tela de entrar, que existe justamente para quem ainda não é
   ninguém — não ter sessão ali é o estado normal, não um bug;
2. metade do público desta rota é o **convidado**, que por definição não tem
   conta e não pode receber `ACCOUNT_REQUIRED` como se lhe faltasse uma.

Então o critério aqui é o do `GET /session`: 200 com a resposta vazia.

No front há uma segunda camada disso: `getActiveRooms()` transforma **qualquer**
`ApiError` em lista vazia, ao contrário do resto de `lib/api/`. É a única chamada
das duas telas que a usam que não carrega o conteúdo principal delas — um erro
aqui deve sumir com o cartão, não derrubar a tela de entrar. É o acidente
registrado em `api-implementation-status.md` §2 ("rota ausente quebra render, não
só some um bloco"), evitado de propósito desta vez.

---

## 6. As duas telas

**`/sala`** ganhou o `ResumeRoomPanel` **acima** do formulário, não no lugar dele.
Redirecionar direto seria menos digitação, mas prende: quem tem uma sala aberta
pode legitimamente querer entrar em outra, e o convidado que quisesse trocar de
sala ficaria sem saída. O painel também some quando alguém chega com `?codigo=` —
um link com código é um convite para *aquela* sala, e empurrar a sala antiga para
o topo dele ofereceria o destino errado.

**Perfil** — o bloco vai no topo da seção "Histórico de partidas como líder", que
era onde o pedido o queria. Antes do histórico porque é a única linha em que ainda
dá para agir; o histórico abaixo é leitura. Quando não há partida encerrada mas há
sala de pé, o texto vazio muda de "Nenhuma partida realizada ainda" para "Nenhuma
partida encerrada ainda — a sala acima ainda está de pé", que é o que de fato
acontece.

---

## 7. O que ficou de fora

**A seção "Perfil de participante" continua sendo o placeholder.** O pedido a
marcou como "futuramente", e ela é a aba inteira — não só uma lista de salas. O
que esta leva fez foi garantir que ela não precise de rota nova: `GET
/rooms/active` já devolve as salas com `role: "participant"`, já reconhece quem
entrou logado pelo `UserId` gravado no `Participant` (com teste), e o
`ProfileView` já filtra por `role` (`ledRooms`) em vez de assumir que tudo é do
líder. Quando a aba existir, é passar o outro lado do filtro para um componente
irmão do bloco de líder.

**Participante sem conta não aparece em perfil nenhum** — e não é lacuna desta
leva: convidado não tem perfil. O caminho de volta dele é o `/sala`, que já
funciona pelo `participantId` do token.

**Nada expira, nada limpa.** Ver §4: esta leva **aumenta** o custo de o item 1 do
`next-steps.md` continuar aberto, porque agora as salas abandonadas não só seguram
código de 6 dígitos como aparecem numa lista que o usuário lê.

**Sem rate limit**, como as demais rotas de leitura. É `GET`, resolvido por
sessão, com teto de 10 linhas — mesma situação de `GET /rooms/{code}/queue`, e
entra junto quando o item 3 do `next-steps.md` for feito.

---

## 8. Como foi verificado

```bash
cd .NET && dotnet test        # 248 testes (233 antes + 15 desta leva)
cd nextjs && npx tsc --noEmit && npx next build
```

**Sem migration** — nenhuma coluna nova. A rota lê `rooms`, `participants`,
`room_queue_sets` e `room_queue_phases` como já estão, então a lição do
`api-implementation-status.md` §7 ("gerar a migration não a aplica") não se
aplica a esta leva.

Os 15 testes de `ActiveRoomsTests` cobrem: líder vendo a própria sala, sala
`running` aparecendo, `finished` e expirada não aparecendo, sala de estranho
nunca aparecendo, sem sessão como lista vazia, convidado achando a sala pelo
`participantId`, recusado não achando nada, participante logado achado pelo
`UserId`, o corte de `setTitle`/`phaseCount` por papel, os dois formatos de
título (um conjunto e "Frações +1"), fila vazia virando "Sem conjunto", contagem
só de aprovados, ordem por mais recente e o teto de 10.

⚠️ **O que os testes não exercem**, pelo motivo de sempre (EF InMemory): a
consulta em si contra Postgres. O `Where` desta rota é o primeiro do projeto a
combinar uma condição de nulo (`userId != null &&`) com um `Any` sobre navegação
— o `!= null` de cada lado **não é decorativo**: sem ele, `p.UserId == null`
comparado a um `userId` nulo casaria pelas regras de nulo do SQL e devolveria sala
de estranho. O caso está travado por teste (`Someone_elses_room_never_appears`,
com sessão anônima e com outro usuário), mas quem rodar contra Postgres pela
primeira vez confere isso e a ordenação por `CreatedAt`.


---

## 9. A leva seguinte: quem é expulso da sala

Continuação direta: as §1–§8 resolveram "fechei a aba e não sei voltar". Esta
resolve o oposto — **"o líder me tirou e eu continuei lá"**.

### O sintoma e a causa

`DELETE /rooms/{code}/participants/{id}` já fazia tudo que o contrato pede desde
a leva do realtime: apaga a linha do participante, publica `participant.left` no
canal da sala e `participant.removed` no canal privado dele. O serviço de WS já
fechava o socket ao ver `participant.removed` (§10 do contrato de WS), e isso
está travado por teste de fumaça desde então.

Só que **ninguém estava escutando aquele canal.** `LobbyView.channelsFor`
assinava `participant:{id}` apenas para quem esperava aprovação; o participante
já aprovado assinava só `room:{code}`. O `Hub` fecha os sockets **do canal em que
o evento chegou** — sem assinante, não havia socket a fechar. Resultado: a pessoa
expulsa continuava recebendo o lobby inteiro, com a tela intacta, até fechar a
aba na mão.

A tela de partida (`ChallengeShell`) não tinha esse defeito — ela já montava a
lista com o canal privado e já tratava `participant.removed`. **O lobby era o
único lugar onde o §10 não funcionava**, e a diferença entre as duas telas é a
razão de ninguém ter percebido.

### O que mudou

| Onde | O quê |
|---|---|
| `LobbyView.channelsFor` | participante aprovado passa a assinar **também** `participant:{id}` — é a correção que faz o §10 valer no lobby |
| `LobbyView` | trata `participant.removed` com `router.replace('/sala?saida=removido')` |
| `RealtimeProvider` | `participant.removed` torna o próximo `close` terminal: sem isso o backoff do §8 reabriria o socket |
| `realtime/src/channels.ts` | `canSubscribe` exige `participantStatus !== null` no canal privado |
| `LeftRoomNotice` + `/sala` | a faixa que explica por que a pessoa foi parar ali |
| `/sala/{code}/lobby` e `/partida` | 404 com participante desta sala na sessão vira redirecionamento, não `notFound()` |
| `realtime/test/protocol.smoke.mjs` | caso 12b: expulso que reconecta não reassina nada |

### Por que fechar o socket não bastava

O cliente reconecta sozinho (§8). E a reconexão **não** falhava, que é o
detalhe: `RealtimeSessionService.FindParticipantAsync` não acha a linha apagada,
mas a resposta cai de volta no `participantId` do **token**, que ainda existe.
Então o expulso voltava com `participantStatus: null` e `participantId`
preenchido — recusado em `room:{code}` (não é aprovado), mas **aceito no próprio
canal privado**, porque a regra só comparava ids. Um socket vivo, assinando o
canal de um participante que não existe mais, para sempre.

Daí as duas defesas, que são de camadas diferentes e nenhuma substitui a outra:

- **no servidor** (`canSubscribe`): sem `participantStatus` não há participação,
  então não há canal privado. `pending` e `rejected` continuam passando — é por
  ali que a decisão do líder chega a eles, e é o que sustenta a tela "esperando o
  líder aceitar".
- **no cliente** (`RealtimeProvider`): depois de `participant.removed`, o próximo
  `close` é terminal. Sem isso o cliente ficaria batendo na recusa acima no ritmo
  do backoff. É o mesmo tratamento que `PROTOCOL_VERSION` já tinha, pelo mesmo
  motivo: insistir só reproduz a recusa.

### Redirecionar, e não mostrar um card

O lobby já tinha um caminho parecido — quem é **recusado na entrada** vê um card
"Solicitação recusada" com um botão. A expulsão é diferente e sai por
redirecionamento, porque o socket **já foi fechado pelo servidor**: a tela de trás
parou de receber atualização, e mantê-la no ar mostraria um lobby congelado com
uma lista de jogadores que envelhece em silêncio. O card do recusado não tem esse
problema — ele nunca chegou a ver o lobby.

`replace` e não `push`: o lobby de onde a pessoa saiu responde 404 para ela
agora, então voltar por ele não é caminho que exista.

O `?saida=removido` existe porque um teletransporte sem explicação é pior que o
bug: `LeftRoomNotice` diz o que aconteceu na tela de destino.

### O caminho do F5, que era um 404 genérico

Quem foi expulso e recarrega `/sala/{code}/lobby` recebia a página 404 do Next.
`GET /rooms/{code}` responde 404 tanto para "não existe" quanto para "você não é
membro" — de propósito, para não confirmar a estranhos que um código existe.

Mas quem tem **um participante desta sala na sessão** já teve o código, então
para ele os dois casos são distinguíveis, e o que sobra é "você não está mais
nela" (removido, ou sala expirada). As duas páginas de sala passam a redirecionar
para `/sala?saida=removido` nesse caso. O 404 genérico dizia à pessoa que ela
tinha errado um código que ela nem digitou.

O texto da faixa cobre os dois motivos de propósito: para quem lê, "o líder me
removeu" e "a sala acabou" têm a mesma consequência.

### O que continua de fora

- **O participante não tem como sair sozinho** — `next-steps.md` continua com
  essa lacuna. Só o líder remove; quem quiser sair fecha a aba e fica ocupando
  vaga. Agora é o vizinho óbvio deste trabalho: o caminho de saída existe, falta
  o botão que o dispara do lado de quem sai.
- **O cookie do expulso não é invalidado.** Ele aponta para um participante que
  não existe mais, então não abre porta nenhuma (`GET /rooms/{code}` dá 404,
  `GET /rooms/active` devolve `[]`, o WS recusa os canais), e o próximo
  `POST /rooms/{code}/participants` o sobrescreve. Limpar exigiria uma rota de
  sessão que o contrato não tem.
- **Nada mudou na API .NET.** Ela já publicava os dois eventos certos, nos dois
  canais certos, desde a leva do realtime — o defeito era só de quem escutava.

### Como foi verificado

```bash
cd .NET     && dotnet test                    # 248 (inalterado: a API não mudou)
cd realtime && npm test                       # 26 verificações (eram 25)
cd nextjs   && npx tsc --noEmit && npx next build
```

O caso 12b do smoke test é o que fecha a regressão do lado do servidor: uma
identidade com `participantId` preenchido e `participantStatus: null` — exatamente
o que a API devolve depois do `DELETE` — tenta assinar `room:{code}` e o próprio
canal privado, e leva `FORBIDDEN_CHANNEL` nos dois.

⚠️ **Não exercido ponta a ponta.** A correção do lobby (assinar o canal privado)
e o redirecionamento são de front, e este projeto não tem teste de front. O
caminho foi verificado por leitura contra o smoke test do serviço de WS, que
prova as duas metades do servidor: que `participant.removed` fecha o socket de
quem assina aquele canal (caso 12) e que a reconexão não reassina (caso 12b).
Rodar de verdade exige a API, o Redis e o serviço de WS de pé ao mesmo tempo.
