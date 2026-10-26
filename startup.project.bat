@echo off
setlocal

REM ===========================================================
REM  Codex - inicia o backend .NET, o servico de tempo real e o
REM  frontend Next.js juntos. Cada servico abre em sua propria
REM  janela de console.
REM
REM    API .NET  : http://localhost:5282
REM    Realtime  : ws://localhost:4001/realtime
REM    Next.js   : http://localhost:3000
REM
REM  Os tres precisam do MESMO service token:
REM    API      -> CodexApi:ServiceToken (dotnet user-secrets)
REM    Realtime -> API_SERVICE_TOKEN     (realtime\.env)
REM    Next     -> API_SERVICE_TOKEN     (nextjs\.env.local)
REM  Se nao baterem, o handshake do WebSocket responde 401 e
REM  nenhuma conexao passa.
REM
REM  Uso: startup.project.bat [/force]
REM    sem /force : porta ocupada = servico preservado, nao sobe outro
REM    com /force : encerra quem esta na porta e sobe do zero (pega
REM                 codigo novo de um processo orfao que ficou de pe)
REM ===========================================================

set "ROOT=%~dp0"
set "API_DIR=%ROOT%.NET\src\Codex.Api"
set "RT_DIR=%ROOT%realtime"
set "REP_DIR=%ROOT%reports"
set "WEB_DIR=%ROOT%nextjs"

set "FORCE="
if /i "%~1"=="/force" set "FORCE=1"

echo.
echo === Codex - startup ===
echo.

REM ---- verificacao de pre-requisitos --------------------------------
where dotnet >nul 2>&1
if errorlevel 1 (
    echo [ERRO] dotnet nao encontrado no PATH. Instale o .NET SDK.
    goto :fail
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERRO] npm nao encontrado no PATH. Instale o Node.js.
    goto :fail
)

if not exist "%API_DIR%\Codex.Api.csproj" (
    echo [ERRO] Projeto da API nao encontrado em "%API_DIR%".
    goto :fail
)

if not exist "%RT_DIR%\package.json" (
    echo [ERRO] Servico de tempo real nao encontrado em "%RT_DIR%".
    goto :fail
)

if not exist "%WEB_DIR%\package.json" (
    echo [ERRO] Projeto Next.js nao encontrado em "%WEB_DIR%".
    goto :fail
)

REM ---- dependencias dos projetos Node --------------------------------
call :ensure_deps "%RT_DIR%" realtime
if errorlevel 1 goto :fail

call :ensure_deps "%REP_DIR%" reports
if errorlevel 1 goto :fail

call :ensure_deps "%WEB_DIR%" web
if errorlevel 1 goto :fail

REM ---- configuracao do realtime --------------------------------------
REM O processo se recusa a subir sem API_SERVICE_TOKEN, pela mesma razao
REM que o ServiceTokenMiddleware da API falha fechado.
if not exist "%RT_DIR%\.env" (
    echo [AVISO] "%RT_DIR%\.env" nao existe. Copie de .env.example e preencha
    echo         API_SERVICE_TOKEN, senao o servico de tempo real morre no boot.
    echo.
)

REM Redis nao e obrigatorio para uma instancia so, mas se REDIS_URL estiver
REM preenchida e o Redis estiver fora do ar, os eventos que a API publica nao
REM chegam em ninguem - e falha de publicacao e engolida de proposito, entao o
REM unico sintoma seria "o lobby nao atualiza sozinho".
findstr /r /c:"^REDIS_URL=..*" "%RT_DIR%\.env" >nul 2>&1
if not errorlevel 1 (
    powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; try { $c.Connect('localhost',6379); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
    if errorlevel 1 (
        echo [AVISO] REDIS_URL esta configurada mas nada responde em localhost:6379.
        echo         O servico sobe assim mesmo; os eventos de tempo real nao chegarao.
        echo.
    )
)

REM ---- sobe os tres servicos -----------------------------------------
REM Cada servico so sobe se a porta dele estiver livre. Rodar o script duas
REM vezes seguidas (ou depois de fechar a janela sem parar o processo) deixava
REM a instancia velha segurando a porta, e a nova morria com EADDRINUSE numa
REM janela que fechava sozinha - o sintoma virava "o realtime nao sobe".

call :port_free 5282
if errorlevel 1 goto :skip_api
echo [api] iniciando .NET em http://localhost:5282 ...
start "Codex API (.NET)" cmd /k "cd /d "%API_DIR%" && dotnet run --launch-profile http"
goto :after_api
:skip_api
echo [api] porta 5282 ocupada pelo PID %PORT_PID% - reaproveitando o que ja esta no ar.
:after_api

call :port_free 4001
if errorlevel 1 goto :skip_rt
echo [rt]  iniciando realtime em ws://localhost:4001/realtime ...
start "Codex Realtime (Node)" cmd /k "cd /d "%RT_DIR%" && npm run dev"
goto :after_rt
:skip_rt
echo [rt]  porta 4001 ocupada pelo PID %PORT_PID% - nenhuma janela nova sera aberta.
echo       Se for um orfao de uma execucao anterior, ele continua servindo o
echo       codigo ANTIGO - rode "startup.project.bat /force" para trocar.
echo       Conferir de quem e:  curl http://localhost:4001/health
:after_rt

call :port_free 4002
if errorlevel 1 goto :skip_rep
echo [rep] iniciando reports em http://localhost:4002 ...
start "Codex Reports (Node)" cmd /k "cd /d "%REP_DIR%" && npm run dev"
goto :after_rep
:skip_rep
echo [rep] porta 4002 ocupada pelo PID %PORT_PID% - reaproveitando o que ja esta no ar.
:after_rep

call :port_free 3000
if errorlevel 1 goto :skip_web
echo [web] iniciando Next.js em http://localhost:3000 ...
start "Codex Web (Next.js)" cmd /k "cd /d "%WEB_DIR%" && npm run dev"
goto :after_web
:skip_web
echo [web] porta 3000 ocupada pelo PID %PORT_PID% - reaproveitando o que ja esta no ar.
:after_web

echo.
echo Cada servico que ainda nao estava no ar subiu em sua propria janela.
echo Feche cada janela (ou Ctrl+C nela) para parar o respectivo servico.
echo.
endlocal
exit /b 0

REM ---- subrotinas -----------------------------------------------------
REM %1 = porta TCP. errorlevel 0 = livre (ou liberada por /force), 1 = ocupada.
REM Deixa o PID de quem ocupa em PORT_PID, para a mensagem de quem chamou.
REM O espaco depois da porta no padrao evita que 4001 case com 40010.
:port_free
set "PORT_PID="
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /r /c:":%~1 .*LISTENING"') do set "PORT_PID=%%p"
if not defined PORT_PID exit /b 0
if not defined FORCE exit /b 1
echo       /force: encerrando o PID %PORT_PID% que ocupava a porta %~1 ...
taskkill /pid %PORT_PID% /f >nul 2>&1
REM Um instante para o socket sair de LISTENING antes de o novo processo ligar.
ping -n 2 127.0.0.1 >nul 2>&1
exit /b 0

REM %1 = diretorio do projeto, %2 = rotulo mostrado no log
:ensure_deps
if exist "%~1\node_modules" exit /b 0
echo [%~2] node_modules ausente, rodando npm install...
pushd "%~1"
call npm install
if errorlevel 1 (
    popd
    echo [ERRO] npm install falhou em "%~1".
    exit /b 1
)
popd
exit /b 0

:fail
echo.
pause
endlocal
exit /b 1
