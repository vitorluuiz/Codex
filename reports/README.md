# Codex Reports Service (`reports`)

Serviço Node.js/TypeScript responsável pelo processamento em segundo plano de relatórios de partidas encerradas, geração de links criptográficos resistentes a força bruta e exportação analítica em **Excel (.xlsx)** (sendo a exportação em **PDF** realizada diretamente no navegador a partir da página HTML com `html2canvas` + `jsPDF`).

## Responsabilidades

1. **Processamento em Segundo Plano**:
   - Consome eventos/jobs de encerramento de partida (`codex:reports:queue` / `codex:reports:jobs` no Redis ou `POST /internal/jobs`).
   - Lê o snapshot imutável da partida na coleção `matches` do MongoDB.
   - Calcula estatísticas analíticas (percentis, mediana, distribuição de alternativas por questão, matriz aluno × fase) e grava o documento consolidado em `match_reports` no MongoDB.
   - Publica o evento `report.ready` no broker Redis (`codex:rt:room:{roomCode}`) para notificar o líder e os participantes no pódio em tempo real via WebSocket.
2. **Links Protegidos Contra Força Bruta**:
   - Gera `shareToken` (256 bits em `base64url` via HMAC-SHA256) para o relatório consolidado da partida.
   - Gera `accessToken` exclusivo (256 bits em `base64url` via HMAC-SHA256) para cada participante consultar seu relatório individual compacto sem expor dados dos demais colegas.
3. **Exportação**:
   - **Excel (`.xlsx`)** gerado no serviço `reports` com 4 abas analíticas: *Resumo da Partida*, *Classificação Geral*, *Análise por Fase* e *Matriz Aluno x Fase*.
   - **PDF (HTML-to-PDF)** gerado no frontend (`nextjs/src/components/reports/exportHtmlToPdf.ts`) capturando os próprios componentes da página web em tema claro (com todas as 3 abas expandidas no relatório do líder).

## Comandos

```powershell
cd reports
npm install
npm test        # compila e executa a suíte de testes de fumaça (Web JSON e XLSX)
npm run dev     # compila e sobe em http://localhost:4002
```
