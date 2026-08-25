# syntax=docker/dockerfile:1

FROM postgres:16-alpine

# Scripts em /docker-entrypoint-initdb.d rodam apenas na primeira inicializacao
# (volume de dados vazio). As migrations do EF Core continuam sendo aplicadas
# manualmente (dotnet ef database update) — isto so garante que o banco/role
# existam antes da API subir.
COPY init/ /docker-entrypoint-initdb.d/
