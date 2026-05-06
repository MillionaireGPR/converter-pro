# 🚀 Deploy do Backend Python - Image Extractor

## ✅ Opção Recomendada: Render (Custo Zero)

O Render oferece **750 horas gratuitas por mês** - suficiente para uso contínuo sem pagar nada.

### 📋 Passo a passo:

1. **Crie conta gratuita** em: https://render.com

2. **Conecte seu repositório GitHub**:
   - Vá em Dashboard → "New" → "Web Service"
   - Selecione seu repositório `Converter-Pro-Merged`

3. **Configure o serviço**:
   - **Name**: `converter-pro-image-extractor`
   - **Root Directory**: `backend/image_extractor`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port 8000`

4. **Clique em "Advanced"** e adicione as variáveis de ambiente:
   - `SUPABASE_URL`: https://iydjwcvbizrakzvcsrzs.supabase.co
   - `SUPABASE_SERVICE_ROLE_KEY`: (sua chave de serviço do Supabase)

5. **Clique "Create Web Service"**

6. **Aguarde o deploy** (2-3 minutos)

7. **Copie a URL gerada** (ex: `https://converter-pro-image-extractor.onrender.com`)

### ⚠️ Limitação do plano gratuito:
- O serviço "dorme" após 15 minutos de inatividade
- Na próxima requisição, demora ~30 segundos para "acordar"
- Para uso frequente durante o dia, isso não é problema

---

## 🔌 Configurar URL no Frontend

Depois do deploy, atualize o arquivo `.env` na raiz do projeto:

```env
VITE_BACKEND_URL=https://converter-pro-image-extractor.onrender.com
```

Depois reinicie o servidor frontend:
```bash
taskkill /F /IM node.exe
npm run dev
```

---

## 📋 Onde encontrar as chaves do Supabase

1. Acesse: https://app.supabase.io
2. Selecione o projeto: `iydjwcvbizrakzvcsrzs`
3. Vá em: **Project Settings** → **API**
4. Copie:
   - **URL**: já está no README acima
   - **service_role key**: clique em "Reveal" e copie

⚠️ **IMPORTANTE**: Use a `service_role key` (não a `anon key`), pois o backend precisa acessar o storage sem restrições de Row Level Security.

---

## 🧪 Testar se o backend está funcionando

Acesse no navegador:
```
https://converter-pro-image-extractor.onrender.com/health
```

Deve retornar:
```json
{"status": "healthy", "service": "image-extractor"}
```

---

## � Como atualizar o backend

Quando fizer alterações no código:
1. Commit e push para o GitHub
2. O Render faz deploy automático!
3. Ou vá no dashboard do Render → "Manual Deploy" → "Deploy latest commit"

---

## 🆘 Rodar local (emergência)

Se precisar rodar localmente temporariamente:

```bash
cd backend/image_extractor
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

E atualize o frontend para:
```env
VITE_BACKEND_URL=http://localhost:8000
```
