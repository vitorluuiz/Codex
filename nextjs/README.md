# Codex

Interface do Codex — plataforma de desafios gamificados para estudo, ensino e
seleção — implementada em **Next.js (App Router) com React Server Components**.

## Rodando

```bash
npm install
cp .env.example .env.local     # preencha API_BASE_URL e NEXT_PUBLIC_REALTIME_URL
npm run dev
```

Sem as variáveis de ambiente o app sobe e navega normalmente: as telas que
dependem de dados mostram um estado explicando qual endpoint falta, em vez de
inventar conteúdo.

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção |
| `npm run typecheck` | `tsc --noEmit` |

## Decisões

### React Server Components

As páginas são Server Components. Elas fazem o fetch inicial e passam os dados
prontos para os Client Components, que só existem onde há interação de verdade:
formulários, cronômetro, WebSocket, popovers.

Na prática isso significa que o lobby e a tela de desafios já chegam preenchidos
no primeiro paint — sem spinner e sem "flash" de tela vazia — e o WebSocket entra
só para manter aquilo atualizado.

O acesso à API fica em `src/lib/api/*` (marcado com `server-only`, então um
`import` acidental num componente de cliente quebra o build) e as mutações em
`src/lib/actions/*` como Server Actions. O browser nunca fala com a API REST
diretamente; só com o servidor de WebSocket.

### CSS Modules, não Tailwind

O design system do projeto é inteiramente baseado em custom properties
(`--accent-primary`, `--radius-xl`, `--text-body-l`…). Com CSS Modules essas
variáveis são usadas direto, sem uma camada de configuração traduzindo token para
classe utilitária. Como boa parte da interface é bem específica — os degraus do
pódio, as lacunas de "complete a frase", os ladrilhos de resposta — o CSS fica
mais legível junto do componente do que espalhado em `className`.

Os tokens estão em `src/styles/tokens/`, copiados sem alteração do design.

**Sobre estilização inline:** não existe. A única coisa que vai pelo atributo
`style` são custom properties com valores calculados em runtime (largura de
barra, altura de coluna, cor escolhida pelo líder), sempre via o helper
`cssVars()` de `src/lib/cssVars.ts`. Nenhuma declaração visual mora no JSX — as
regras leem `var(--…)` do arquivo `.module.css`. É o único jeito de levar um
número do servidor até o CSS sem gerar uma classe por valor possível.

### Dados

Não há mock em lugar nenhum. O que existe é:

- **[`contracts/api/api-rest-contract.md`](../contracts/api/api-rest-contract.md)** — todas as rotas necessárias,
  derivadas do que cada tela precisa desenhar, com formatos de request/response,
  códigos de erro, regras de autorização, fórmula de pontuação e a modelagem
  sugerida no banco.
- **[`contracts/realtime/websocket-contract.md`](../contracts/realtime/websocket-contract.md)** — arquitetura do servidor de tempo
  real: protocolo completo, canais, throttling, sincronização de cronômetro,
  reconexão e escala.
- **`src/lib/types.ts`** — o mesmo contrato em TypeScript.

O conteúdo editorial da landing (textos, planos) mora em `src/content/landing.ts`
por não ser dado de domínio. A rota de CMS correspondente está documentada caso
isso mude.

## A tela de Desafios

Foi montada como o pedido: **uma casca que sustenta os componentes de desafio**.

```
components/challenge/
├── ChallengeShell.tsx      ← casca: realtime, máquina de telas, ciclo de envio
├── ChallengeTopBar.tsx     ← barra superior comum a todas as fases
├── registry.ts             ← kind → componentes do tipo
├── types.ts                ← o contrato entre casca e tipo de desafio
├── screens/                ← espera, feedback individual, comparação, pódio
├── leader/                 ← painel de acompanhamento
└── kinds/
    ├── quiz/   ├── code/   ├── text/   └── fill/
```

A casca cuida de tudo que se repete: barra superior com fase, pontuação,
cronômetro e progresso da turma; a sequência
*desafio → espera → feedback individual → comparação com a turma → pódio*; o
painel do líder; e o envio da resposta.

Cada tipo de desafio implementa só a sua própria lógica e interface, exportando
um `ChallengeTypeModule` com três componentes:

| Componente | Onde aparece |
|---|---|
| `Player` | a interface de resposta do aluno |
| `Feedback` | o miolo da tela de feedback individual |
| `LeaderPreview` | a prévia da fase no painel do líder |

A casca não sabe o que é um quiz. Ela pergunta ao `registry` qual módulo usar e
entrega `onSubmit`. **Adicionar um tipo novo de desafio é criar uma pasta em
`kinds/` e acrescentar uma linha em `registry.ts`** — nenhuma outra tela muda.

O ciclo de vida também é comum: a casca envia a resposta, mostra a espera,
escuta a correção (síncrona para quiz e completar-frase, assíncrona via
WebSocket para texto e código, que dependem de IA) e troca de tela sozinha.

## Estrutura

```
src/
├── app/                    rotas (Server Components)
│   ├── page.tsx                        landing
│   ├── entrar/                         login e cadastro
│   ├── perfil/                         perfil de líder (próprio e de terceiros)
│   ├── conjunto/
│   │   ├── novo/                       editor de conjunto (criação)
│   │   └── [setId]/                    editor de conjunto (edição)
│   └── sala/
│       ├── page.tsx                    entrar na sala (código → nome/avatar)
│       └── [code]/
│           ├── lobby/                  lobby (líder e jogador)
│           └── partida/                desafios
├── components/
│   ├── ds/                 design system (Button, Card, Input, Dialog, Popover, Toast…)
│   ├── challenge/          tela de desafios — ver acima
│   ├── set-editor/         editor de conjunto (rail de fases, formulários por tipo)
│   ├── profile/  lobby/  auth/  join/  landing/  avatar/  media/  icons/  feedback/
├── content/                conteúdo editorial da landing
├── lib/
│   ├── api/                clientes REST (server-only)
│   ├── actions/            Server Actions
│   └── types.ts            modelo de domínio
├── realtime/               protocolo, provider e cronômetro do WebSocket
└── styles/                 tokens do design system + globals
```

## Backend esperado

Esta pasta é só o front. Ela espera dois serviços, que vivem no mesmo repositório
(`.NET/` e `realtime/` — como subir tudo está no [README da raiz](../README.md)):

1. **API REST** — consolida os dados e fala com o banco (PostgreSQL).
   Contrato completo em [`contracts/api/api-rest-contract.md`](../contracts/api/api-rest-contract.md).
2. **Servidor de WebSocket** — transporta as mudanças em tempo real. Ele não é
   dono de estado: toda mutação passa pela API, que grava e publica; o WS só faz
   fan-out. O porquê dessa separação está em
   [`contracts/realtime/websocket-contract.md`](../contracts/realtime/websocket-contract.md).
