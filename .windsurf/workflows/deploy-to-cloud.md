---
description: Deploy Completo para Nuvem (Render + Vercel/Netlify)
---

# Workflow: Deploy do Converter-Pro na Nuvem

## Fase 1: Preparação (Local)

### 1.1 Commitar Alterações
```bash
# Verificar status
git status

# Adicionar todos os arquivos modificados
git add -A

# Commit com mensagem descritiva
git commit -m "feat: extração de imagens Excel multi-sheet + download ZIP

- Suporte a múltiplas sheets (abas) no imageExtractorExcel
- Matching inteligente (linha, offset, fallback sequencial)
- Botão download imediato para imagens Excel
- Vinculação automática imagem → produto
- Diagnósticos detalhados no console"

# Push para GitHub
git push origin main
```

### 1.2 Verificar Estrutura do Backend
```
backend/image_extractor/
├── main.py              ✅ Entry point (FastAPI)
├── cv_extractor.py      ✅ Extração OpenCV
├── storage.py           ✅ Supabase storage
├── requirements.txt     ✅ Dependências
├── render.yaml          ✅ Config Render
└── README-DEPLOY.md     ✅ Guia completo
```

---

## Fase 2: Deploy Backend Python (Render)

### 2.1 Criar Conta e Serviço
1. Acesse: https://render.com
2. Crie conta gratuita (GitHub login)
3. Dashboard → "New" → "Web Service"
4. Conecte repositório: `Converter-Pro-Merged`

### 2.2 Configurar Serviço
| Campo | Valor |
|-------|-------|
| **Name** | `converter-pro-image-extractor` |
| **Root Directory** | `backend/image_extractor` |
| **Environment** | `Python 3` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn main:app --host 0.0.0.0 --port 8000` |

### 2.3 Variáveis de Ambiente
Clique em "Advanced" e adicione:
```env
SUPABASE_URL=https://iydjwcvbizrakzvcsrzs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<sua_chave_aqui>
```

> ⚠️ **IMPORTANTE**: Pegue a `service_role key` em Supabase → Project Settings → API (não use anon key!)

### 2.4 Deploy
- Clique "Create Web Service"
- Aguarde 2-3 minutos
- Copie a URL gerada: `https://converter-pro-image-extractor.onrender.com`

### 2.5 Testar Backend
Acesse: `https://converter-pro-image-extractor.onrender.com/health`

Deve retornar: `{"status": "healthy", "service": "image-extractor"}`

---

## Fase 3: Configurar Frontend

### 3.1 Atualizar URL do Backend
Edite `.env` na raiz:
```env
VITE_BACKEND_URL=https://converter-pro-image-extractor.onrender.com
```

### 3.2 Testar Localmente
```bash
# Reiniciar servidor frontend
taskkill /F /IM node.exe
npm run dev
```

Teste com PDF para confirmar que o backend remoto está respondendo.

---

## Fase 4: Deploy Frontend (Vercel - Recomendado)

### 4.1 Preparar Projeto
```bash
# Build de produção
npm run build

# Verificar se dist/ foi gerado
ls dist/
```

### 4.2 Deploy Vercel
1. Acesse: https://vercel.com
2. Importe repositório GitHub
3. Configurações padrão (Vite já detectado)
4. Adicione variável de ambiente:
   - Name: `VITE_BACKEND_URL`
   - Value: `https://converter-pro-image-extractor.onrender.com`

### 4.3 Alternativa: Netlify (Custo Zero)
1. Acesse: https://netlify.com
2. Drag & drop pasta `dist/` (deploy manual)
3. Ou configure GitHub integration para deploy automático

---

## Fase 5: Pós-Deploy

### 5.1 Testar End-to-End
1. Acesse URL do frontend (ex: `https://converter-pro.vercel.app`)
2. Faça upload de PDF - deve extrair imagens via backend remoto
3. Faça upload de Excel Nix House - deve extrair local + mostrar métricas

### 5.2 Monitoramento
- **Render Dashboard**: https://dashboard.render.com
  - Logs de erro do backend
  - Uso de recursos (750h/mês grátis)
- **Supabase Dashboard**: https://app.supabase.io
  - Storage usage
  - Database status

---

## 🚨 Troubleshooting

### Backend "dormindo" (cold start)
**Problema**: Demora 30s na primeira requisição após inatividade
**Solução**: 
- UptimeRobot (gratuito) ping a cada 10 minutos
- Ou upgrade para plano pago ($7/mês)

### Erro CORS
**Problema**: Frontend não conecta no backend
**Verifique**: Em `main.py`, CORS está configurado para origem do frontend

### Imagens não aparecem
**Verifique**: `VITE_BACKEND_URL` está correto no `.env`

---

## 📋 Checklist Final

- [ ] Commit feito e push para GitHub
- [ ] Backend deployado no Render
- [ ] Health check retorna `healthy`
- [ ] Frontend com URL do backend configurada
- [ ] Teste PDF funcionando (extrai imagens remotamente)
- [ ] Teste Excel funcionando (extrai localmente)
- [ ] Botão download aparece e funciona
- [ ] Frontend deployado (Vercel/Netlify)
- [ ] URL pública acessível pelo cliente

---

## 💰 Custo Estimado (Custo Zero)

| Serviço | Plano | Limite |
|---------|-------|--------|
| Render | Free | 750h/mês |
| Vercel | Free | 100GB/mês |
| Supabase | Free | 500MB storage |
| **Total** | **$0/mês** | - |

Para uso comercial moderado, tudo gratuito!
