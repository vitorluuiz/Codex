# syntax=docker/dockerfile:1

FROM mongo:8.0

# Scripts em /docker-entrypoint-initdb.d rodam apenas na primeira inicializacao
# (volume de dados vazio). As colecoes e indices sao gerenciados pela propria API
# do Codex na primeira operacao (CreateMany e idempotente) — este diretorio serve
# como ponto de extensao para scripts de inicializacao futuros.
COPY init/ /docker-entrypoint-initdb.d/
