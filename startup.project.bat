@echo off
setlocal

REM ===========================================================
REM  Codex - inicia o backend .NET e o frontend Next.js juntos
REM  Cada servico abre em sua propria janela de console.
REM
REM    API .NET : http://localhost:5282
REM    Next.js  : http://localhost:3000
REM ===========================================================

set "ROOT=%~dp0"
set "API_DIR=%ROOT%.NET\src\Codex.Api"
set "WEB_DIR=%ROOT%nextjs"

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

if not exist "%WEB_DIR%\package.json" (
    echo [ERRO] Projeto Next.js nao encontrado em "%WEB_DIR%".
    goto :fail
)

REM ---- dependencias do front ----------------------------------------
if not exist "%WEB_DIR%\node_modules" (
    echo [web] node_modules ausente, rodando npm install...
    pushd "%WEB_DIR%"
    call npm install
    if errorlevel 1 (
        popd
        echo [ERRO] npm install falhou.
        goto :fail
    )
    popd
)

REM ---- sobe os dois servicos -----------------------------------------
echo [api] iniciando .NET em http://localhost:5282 ...
start "Codex API (.NET)" cmd /k "cd /d "%API_DIR%" && dotnet run --launch-profile http"

echo [web] iniciando Next.js em http://localhost:3000 ...
start "Codex Web (Next.js)" cmd /k "cd /d "%WEB_DIR%" && npm run dev"

echo.
echo Os dois servicos foram iniciados em janelas separadas.
echo Feche cada janela (ou Ctrl+C nela) para parar o respectivo servico.
echo.
endlocal
exit /b 0

:fail
echo.
pause
endlocal
exit /b 1
