# codex-realtime

Serviço de tempo real do Codex. Implementa `contract/websocket-contract.md`.

> **A decisão que estrutura tudo:** este serviço **transporta** estado, não é dono
> de nenhum. Toda mutação passa pela API REST, que grava e depois publica; aqui só
> acontece o fan-out. Nada que chega de um cliente é escrito em lugar nenhum — a
> única mensagem que o cliente origina é `activity`, que é efêmera e nunca é
> persistida.

## Como roda

```bash
npm install
cp .env.example .env      # preencha API_SERVICE_TOKEN com o mesmo valor da API
npm run build
npm start                 # http://localhost:4001, upgrade em /realtime
npm test                  # smoke do protocolo, contra uma API falsa
```

`API_SERVICE_TOKEN` é obrigatório: o processo se recusa a subir sem ele, pela
mesma razão que o `ServiceTokenMiddleware` da API falha fechado.

Sem `REDIS_URL` o serviço sobe com um broker em memória — útil para desenvolver,
válido para **uma** instância só. Com `NODE_ENV=production` a ausência é erro de
inicialização.

## Como as peças se ligam

```
                    ┌──────────────┐
   HTTP (mutação)   │              │  grava
Browser ──────────▶ │   API .NET   │ ────────▶ PostgreSQL
                    │              │
                    └──────┬───────┘
                           │ publica em codex:rt:room:{code}
                           ▼
                    ┌──────────────┐
   WebSocket        │  este        │  ── resolve identidade/papel ──▶ API .NET
Browser ◀────────── │  serviço     │     (POST /internal/realtime/resolve)
      (só leitura)  └──────────────┘
```

O serviço nunca toca no banco. Ele não consegue nem ler o token de sessão: ele é
opaco (ASP.NET Data Protection) e só a API o decifra. Toda pergunta de
autorização vira uma chamada a `/internal/realtime/resolve` — é assim que a regra
"autorização num lugar só" continua valendo com dois processos.

## Escala horizontal

O processo é sem estado. Cada instância guarda apenas `socket → canais` na
memória, e isso é descartável: quem cai reconecta em outra instância e reassina.

- **Sem afinidade de sessão.** Qualquer instância atende qualquer sala. Com
  WebSocket puro (sem fallback de long-polling) o load balancer não precisa de
  sticky sessions.
- **Um canal Redis por sala**, não um global: a instância assina
  `codex:rt:room:{code}` quando ganha o primeiro assinante local daquela sala e
  desassina quando perde o último. Com canal global, o tráfego de rede cresceria
  com `salas × instâncias`.
- **Throttle por instância** basta: um socket vive numa instância só, então
  ninguém recebe mais de um evento por janela mesmo com N processos.
- **`SIGTERM`** manda `{"type":"error","code":"RECONNECT"}` e fecha com 1001;
  novos upgrades passam a receber 503 imediatamente.

## Mapa do código

| Arquivo | O que decide |
|---|---|
| `src/protocol.ts` | Espelho servidor de `nextjs/src/realtime/protocol.ts` |
| `src/channels.ts` | Quem pode assinar o quê, e que evento vale em que canal |
| `src/identity.ts` | Cliente de `/internal/realtime/resolve` + cache de 1 s |
| `src/broker.ts` | Redis Pub/Sub (e o fallback em memória) |
| `src/hub.ts` | `canal → sockets`, fan-out, refcount de sala no broker |
| `src/throttle.ts` | As janelas de §7 (leading + trailing, colapsando no último) |
| `src/connection.ts` | A máquina de estados de uma conexão |
| `src/server.ts` | `Origin`, autenticação antes do upgrade, `/health`, dreno |

## O que este serviço deliberadamente não faz

- **Não escreve no banco.** Nem indiretamente: não chama rota de mutação da API.
- **Não guarda replay.** Ao reconectar, o cliente reenvia `hello` e lê o estado
  pelo REST. Estado inteiro é mais barato que um log de eventos com cursor.
- **Não tipa payload de evento.** Ele valida o envelope (`type` conhecido, canal
  compatível) e repassa o resto literal — assim mudar um campo na API não exige
  deploy aqui.
