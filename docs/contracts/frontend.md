# Contrato de Interface Web (Frontend Next.js) — Codex

Este documento define o contrato, arquitetura e padrões da camada de interface do usuário do Codex (Next.js 15 App Router, React 19 Server Components, Server Actions e CSS Modules).

---

## 1. Arquitetura e Princípios de Comunicação

1. **Isolamento de Requisições REST:** O navegador nunca se comunica diretamente com a API REST de backend. Todas as consultas e mutações HTTP são intermediadas pelo servidor do Next.js:
   * Leituras e renderização inicial via **React Server Components (RSC)** em `src/lib/api/*` (marcados com `server-only`).
   * Mutações acionadas por formulários e interações via **Server Actions** em `src/lib/actions/*`.
2. **Tempo Real Direto:** O navegador conecta-se diretamente ao serviço de WebSocket apenas para receber atualizações de tela e transmitir sinais efêmeros de digitação (*typing*).
3. **Pintura Inicial Preenchida:** As páginas carregam com os dados pré-resolvidos no servidor, eliminando telas vazias com spinners no carregamento inicial. Componentes de cliente (`"use client"`) são restritos às partes com interação direta (cronômetro, formulários, WebSockets, modais).

---

## 2. Estrutura de Rotas da Aplicação

| Rota | Descrição | Modelo de Renderização |
|---|---|---|
| `/` | Landing page institucional e planos. | Server Component estático/revalidável. |
| `/entrar` | Telas de login por senha, cadastro e atalhos OAuth. | Server Component + Client Form. |
| `/perfil` | Painel do líder com histórico de partidas, conjuntos próprios e salas ativas. | Server Component autenticado. |
| `/conjunto/novo` | Criação de novo conjunto de fases. | Client Component com formulário do editor. |
| `/conjunto/[setId]` | Edição de conjunto de fases existente. | RSC para carregar rascunho + Client Editor. |
| `/sala` | Entrada de participante via código de 6 dígitos. | Client Component com fluxo em 2 etapas. |
| `/sala/[code]/lobby` | Sala de espera pré-partida (visão de líder ou jogador). | RSC (dados iniciais) + WebSocket Provider. |
| `/sala/[code]/partida`| Execução dos desafios gamificados e pódio. | RSC (fase inicial) + Máquina de Telas da Casca. |

---

## 3. Máquina de Estados da Casca de Desafios (`ChallengeShell`)

A interface da partida funciona como uma casca (*shell*) padronizada que orquestra a transição de telas e abriga os módulos específicos de cada tipo de desafio.

### 3.1 Sequência de Telas do Jogador
```text
[ Desafio Ativo ] ──(envio de resposta)──▶ [ Tela de Espera ]
        │                                          │
 (tempo esgotado)                           (fase fecha)
        ▼                                          ▼
[ Tempo Esgotado ]                         [ Feedback Individual ]
        │                                          │
        └─────────────────┬────────────────────────┘
                          ▼
             [ Comparação com a Turma ]
                          │
                 (fim da última fase)
                          ▼
                  [ Pódio Terminal ]
```

### 3.2 Invariantes da Casca
* **Pódio Terminal:** Ao entrar no estado `podium`, nenhuma resposta HTTP pendente ou evento tardio pode regredir a tela para estados anteriores.
* **Ocultação de Gabarito:** O gabarito oficial nunca é apresentado durante o estado de resposta ativa do aluno, sendo revelado somente nas telas de feedback e comparação após o encerramento da fase.
* **Retorno ao Lobby:** O participante sai do pódio voluntariamente chamando a ação `returnFromPodiumAction` (`POST /rooms/{code}/participants/me/return`), limpando seu status de resultados.

---

## 4. Módulos de Tipo de Desafio (`ChallengeTypeModule`)

Cada tipo de fase (`quiz`, `fill`, `text`, `code`) implementa exclusivamente seu próprio comportamento, isolado em `src/components/challenge/kinds/[tipo]/`, exportando três componentes padrão:

| Componente | Finalidade |
|---|---|
| `Player` | Interface de resolução e interação do aluno durante a fase ativa. Recebe `onSubmit`. |
| `Feedback` | Visualização detalhada da resposta do aluno com indicação de acerto ou erro. |
| `LeaderPreview` | Pré-visualização do desafio com gabarito exibido no painel de controle do líder. |

Novos formatos de desafio são integrados registrando o módulo correspondente no catálogo `registry.ts`, sem necessidade de alterar a casca da partida.

---

## 5. Padrões Visuais e Estilização

* **CSS Modules:** Estilização componentizada em arquivos `.module.css` dedicados. Classes utilitárias globais (Tailwind) não são utilizadas.
* **Tokens de Design:** Variáveis CSS nativas (`--accent-primary`, `--radius-xl`, `--text-body-l`) declaradas centralmente em `src/styles/tokens/`.
* **Valores Dinâmicos em Runtime:** Proporções de barras de progresso, alturas de degraus do pódio e cores dinâmicas de conjuntos são repassadas ao CSS unicamente através de custom properties via utilitário `cssVars()`, preservando a separação entre layout estrutural e cálculo matemático.
