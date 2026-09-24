# api-oauth-log.md — Login social: Google, Microsoft e GitHub (seção 2)

Registro de decisão da leva que implementou o **login OAuth** do
`api-rest-contract.md` §2. Era o último item de autenticação em aberto: o front já
tinha os três botões, os ícones de marca e a server action desde o começo, e o
backend não tinha nada — cada clique num provedor batia numa rota inexistente e
falhava em silêncio, porque o retorno da action era descartado no `onClick`.

Mesma convenção dos outros logs desta pasta: o que está aqui é **o que o contrato
não decidia** e o código precisou decidir. O que o contrato já dizia não é
repetido.

A decisão de produto que faltava (`next-steps.md` listava "precisa decisão de
produto") foi tomada: os três provedores, sem prioridade entre eles.

---

## 1. Rotas implementadas

| Rota | Método do serviço |
|---|---|
| `POST /auth/oauth/{provider}/authorize` | `OAuthService.BuildAuthorizeUrl` |
| `POST /auth/oauth/{provider}/callback` | `OAuthService.CompleteAsync` |

Arquivos novos na API: `Services/OAuthService.cs`, `Services/OAuth/` (opções,
perfil normalizado, PKCE, leitor de `id_token` e um cliente por provedor),
`Common/Auth/OAuthStateService.cs`, `Domain/Entities/UserIdentity.cs`,
`Data/Configurations/UserIdentityConfiguration.cs`,
`Contracts/Auth/OAuthContracts.cs`. Uma migration: `UserIdentities`.

No Next: `src/app/auth/callback/[provider]/route.ts` (o único route handler de
auth que existe) e `src/lib/cookies.ts`, que passou a ser o dono do nome do cookie
de sessão — antes duplicado em quatro módulos, e o callback seria o quinto.

**O que foi reusado, e não reescrito:** `AuthService.IssueUserSession` (só deixou
de ser privado), que emite exatamente a mesma sessão do login por senha; a função
que grava o cookie no Next; e o desenho inteiro do `SessionTokenService`, copiado
para o `state` com outro `Purpose`.

---

## 2. O callback não bate no backend

O contrato dizia, em uma linha, que "o callback do provedor bate no backend, que
redireciona para o Next já com o cookie de sessão setado". **Isso não é
implementável nesta base**, e a linha foi corrigida.

O `ServiceTokenMiddleware` recusa toda requisição sem `x-service-token`, com
exceção de `/health` e `/metrics`. O callback do provedor é uma navegação de
browser: nunca traria esse header. Aceitá-lo na API exigiria três coisas ruins ao
mesmo tempo — abrir uma exceção no middleware, expor uma rota pública em
`api.playcodex.com.br` que hoje não existe, e emitir o cookie com
`Domain=.playcodex.com.br` para o Next enxergá-lo, o que não tem equivalente em
desenvolvimento, onde não há domínio pai comum.

O `redirect_uri` registrado nos três provedores aponta então para o Next:

```
browser → botão → startOAuthAction (server action)
  → POST api /auth/oauth/{provider}/authorize  { redirectTo }
  ← { authorizeUrl, state }
  set-cookie codex_oauth_state (httpOnly, 10 min)
  redirect → provedor
browser → provedor → GET /auth/callback/{provider}?code&state
  route handler compara state com o cookie
  → POST api /auth/oauth/{provider}/callback  { code, state }
  ← { token, expiresIn, user, redirectTo }
  set-cookie codex_session; apaga codex_oauth_state; redirect → redirectTo
```

A regra 1 da arquitetura ("o browser nunca fala com a API") sai intacta, e o
middleware não foi tocado.

---

## 3. O `state` é autocontido, e por isso não tem uso único

O contrato previa só `authorizeUrl` na resposta do `authorize`. Ela ganhou
`state`, porque quem precisa dele é o Next: sem guardar o valor num cookie e
conferir na volta, qualquer um poderia iniciar um fluxo, montar a URL de callback
com o próprio código e induzir outra pessoa a completá-la — login-CSRF, a pessoa
acaba logada numa conta que não é dela.

O conteúdo do `state` (provedor, `redirectTo`, `code_verifier` do PKCE, validade
de dez minutos) vai protegido por Data Protection, com `Purpose` próprio. A
alternativa era guardar o fluxo pendente no Redis, seguindo o
`IRealtimeTicketStore`; ficou de fora porque o Redis é opcional em
desenvolvimento e o store em memória não sobrevive a restart nem a mais de uma
instância — o key ring do Data Protection já vive no Postgres e resolve os dois.

O preço é **não haver uso único no servidor**: o mesmo `state` decifra quantas
vezes vier. A proteção contra replay fica em dois lugares fora daqui — o provedor
invalida o `code` no primeiro uso, e o cookie é apagado pelo route handler antes
de qualquer outra coisa, inclusive quando o fluxo falha.

---

## 4. Um `id_token` que não é verificado, de propósito

Google e Microsoft são OpenID Connect e o perfil sai das claims do `id_token`. A
assinatura não é validada.

O token chega como resposta direta do endpoint de token, sobre TLS, num canal em
que já provamos ser o cliente ao mandar o `client_secret` — é exatamente o caminho
em que a especificação (OIDC Core 3.1.3.7) dispensa a verificação. Validar exigiria
buscar, cachear e rotacionar JWKS de dois provedores para não ganhar nada.

**A condição que torna isso verdade está no código, não na intenção:** vale
enquanto o `id_token` só entrar pela resposta do endpoint de token. Se um dia a
API aceitar um `id_token` vindo do browser (fluxo implícito, Google One Tap), a
validação volta a ser obrigatória. O comentário em `OpenIdConnectClient` diz isso.

---

## 5. Regra de vínculo: o `sub` manda, o email só abre a porta

Três caminhos, nesta ordem:

1. Já existe `UserIdentity` com aquele `(provider, sub)` → é essa a pessoa.
2. Não existe, e o provedor afirma email **verificado**:
   - há conta com aquele email → cria o vínculo apontando para ela;
   - não há → cria conta com `PasswordHash` nulo, junto com o vínculo.
3. Email ausente ou não verificado → `409 OAUTH_EMAIL_NOT_VERIFIED`.

O `sub` é o que identifica a pessoa, não o email: quem troca de endereço no
provedor continua entrando na mesma conta, e o `Email` guardado em
`user_identities` é instantâneo de diagnóstico, não fonte de verdade.

Vincular por email não verificado é a forma clássica de tomar conta alheia — basta
cadastrar o endereço de outra pessoa num provedor que não confirme nada. Por isso
o caso 3 recusa em vez de criar uma segunda conta com o mesmo email, que o índice
único de `users.Email` barraria de qualquer jeito.

Cada provedor afirma verificação de um jeito diferente:

| Provedor | Como |
|---|---|
| Google | claim `email_verified` |
| Microsoft | não emite a claim; tratado como verificado porque a Microsoft controla tanto o domínio da conta pessoal quanto o tenant da corporativa. Sem `email`, cai para `preferred_username` |
| GitHub | não é OIDC: duas chamadas de API, e vale o email primário **e** verificado da lista; sem nenhum verificado, é `null` |

**Vincular não tira nada.** Conta que tinha senha continua tendo: entrar pelo
Google não apaga o `PasswordHash`.

---

## 6. Lacunas conhecidas

- **Não há tela de vínculos.** Dá para conectar um provedor, não para ver quais
  estão conectados nem desconectar. Enquanto ela não existir, quem entrou por
  provedor e nunca cadastrou senha depende do provedor para sempre — e por isso
  nenhuma rota de desvínculo foi escrita: ela precisaria da trava "não deixe a
  conta sem nenhum meio de entrada", que só faz sentido junto da tela.
- **Comparação de email continua exata e sensível a maiúsculas**, como no resto da
  base (decisão registrada em `UserProfileService`). Um provedor devolvendo
  `Marina@Escola.br` para uma conta gravada como `marina@escola.br` não vincula:
  tenta criar conta, esbarra no índice único e recebe `409 EMAIL_ALREADY_USED`.
  Consertar isso é normalizar email em **toda** a base, não só aqui.
- **`POST /auth/logout` continua sem revogação** (§3 do
  `api-implementation-status.md`). A sessão criada por OAuth herda isso: só expira
  por tempo.
- **As rotas de OAuth não têm limite de taxa.** São as duas únicas rotas da API
  que fazem chamada de saída para terceiros, então são as que mais mereceriam —
  mas o `RateLimitPolicies` de hoje só sabe particionar por código de sala, e
  todo o tráfego chega do mesmo IP (o do servidor do Next). Uma política nova
  precisa antes decidir por o que particionar.
- **Entrar por provedor no meio de uma partida derruba a participação.** O cookie
  de sessão carrega os dois sujeitos, e o login social sobrescreve o cookie
  inteiro. É o mesmo comportamento do login por senha, não uma regressão.

---

## 7. Configuração, que é onde isso costuma quebrar

Os três provedores são gratuitos. O que custa é o cadastro.

`CodexApi:OAuth:RedirectBaseUrl` é a origem do **Next**, não a da API, e o
`redirect_uri` a registrar é `{base}/auth/callback/{provedor}`. Os três provedores
comparam essa URL caractere a caractere: barra final, `http` contra `https` e
`www` sobrando são as três causas de "redirect_uri mismatch".

Um OAuth App do GitHub aceita **uma** callback URL, então desenvolvimento e
produção precisam de dois aplicativos separados. Google e Microsoft aceitam várias
no mesmo cadastro.

Provedor sem credenciais responde `501 OAUTH_PROVIDER_NOT_CONFIGURED` e não
derruba os outros — dá para ligar um de cada vez sem deploy de código.

Os segredos de produção **não passam pelo CI**: o workflow não transporta `.env`.
Eles vão à mão para `/opt/codex/.env` na VM, como os demais. Esquecer isso derruba
só o login social; o resto sobe normalmente, o que torna a falha fácil de não
perceber.

Fora do código, e provavelmente o caminho crítico para produção: a tela de
consentimento do Google exige URLs de política de privacidade e de termos de uso
no domínio, e verificação do domínio no Search Console. Nenhuma das duas páginas
existe. Em modo de teste, o Google limita o app a cem contas.
