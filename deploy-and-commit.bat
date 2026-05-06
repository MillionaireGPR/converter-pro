@echo off
chcp 65001 >nul
echo ==========================================
echo  DEPLOY E COMMIT - Converter Pro
echo ==========================================
echo.

echo [1/4] Verificando status do Git...
git status

echo.
echo [2/4] Adicionando todas as alteracoes...
git add -A

echo.
echo [3/4] Criando commit...
git commit -m "feat: extracao de imagens Excel multi-sheet + download ZIP

- Suporte a multiplas sheets (abas) no imageExtractorExcel.ts
- Matching inteligente (linha exata, offset +/-5, fallback sequencial)
- Botao download imediato de imagens Excel (ZIP gerado no frontend)
- Vinculacao automatica imagem -> produto por SKU
- Diagnosticos detalhados no console para debugging
- Workflow de verificacao de arquitetura
- Correcao de bugs de variaveis nao definidas"

echo.
echo [4/4] Enviando para GitHub...
git push origin main

echo.
echo ==========================================
echo  COMMIT CONCLUIDO!
echo ==========================================
echo.
echo Proximos passos:
echo 1. Acesse: https://render.com
echo 2. Crie uma Web Service
echo 3. Selecione o repositorio: converter-pro
echo 4. Configure:
echo    - Root Directory: backend/image_extractor
echo    - Build: pip install -r requirements.txt
echo    - Start: uvicorn main:app --host 0.0.0.0 --port 8000
echo.
pause
