@echo off
echo ==========================================
echo   Converter-Pro - Iniciando Servicos
echo ==========================================
echo.

REM Verifica se o node esta rodando e mata se necessario
taskkill /F /IM node.exe 2>nul
taskkill /F /IM python.exe 2>nul
timeout /t 2 /nobreak >nul

REM Cria pasta temp se nao existir
if not exist "backend\image_extractor\temp" mkdir "backend\image_extractor\temp"

echo [1/2] Iniciando Backend Python (Porta 8000)...
start "Backend Python" cmd /k "cd backend\image_extractor && echo Instalando dependencias... && pip install -r requirements.txt && echo Backend pronto! && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

timeout /t 5 /nobreak >nul

echo [2/2] Iniciando Frontend React (Porta 8080)...
start "Frontend React" cmd /k "echo Instalando dependencias... && npm install && echo Frontend pronto! && npm run dev"

echo.
echo ==========================================
echo   Servicos iniciados!
echo ==========================================
echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:8080
echo.
echo Pressione qualquer tecla para fechar esta janela...
pause >nul
