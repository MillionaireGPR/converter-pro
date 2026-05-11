@echo off
chcp 65001 >nul
echo ==========================================
echo  DEPLOY VERCEL - CONVERTER PRO
echo ==========================================
echo.
echo [1/3] Gerando build de producao...
npm run build
if %errorlevel% neq 0 (
    echo ERRO no build! Verifique os erros acima.
    pause
    exit /b 1
)

echo.
echo [2/3] Verificando dist/...
if exist dist\index.html (
    echo Build OK - index.html encontrado
) else (
    echo ERRO: dist/index.html nao encontrado
    pause
    exit /b 1
)

echo.
echo [3/3] Fazendo deploy na Vercel...
echo Isso pode levar alguns minutos...
echo.

:: Deploy com archive tgz para evitar limite de arquivos
vercel --prod --archive=tgz --yes

if %errorlevel% equ 0 (
    echo.
    echo ==========================================
    echo  DEPLOY CONCLUIDO!
    echo ==========================================
    echo Verifique a URL acima
) else (
    echo.
    echo ==========================================
    echo  ERRO NO DEPLOY
    echo ==========================================
    echo Tentando alternativa manual...
    echo.
    echo Abra: https://vercel.com/dashboard
    echo Clique em "Add New..." -^> "Project"
    echo Arraste a pasta dist/ inteira
)

pause
