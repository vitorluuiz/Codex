# syntax=docker/dockerfile:1

FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

COPY src/Codex.Api/Codex.Api.csproj src/Codex.Api/
RUN dotnet restore src/Codex.Api/Codex.Api.csproj

COPY src/Codex.Api/ src/Codex.Api/
RUN dotnet publish src/Codex.Api/Codex.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runner
WORKDIR /app
RUN addgroup -S codex && adduser -S codex -G codex
COPY --from=build --chown=codex:codex /app/publish .

USER codex
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080

ENTRYPOINT ["dotnet", "Codex.Api.dll"]
