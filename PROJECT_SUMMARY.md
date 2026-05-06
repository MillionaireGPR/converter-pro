# Converter Pro - Resumo do Projeto

> **Data**: Maio 2026
> **Objetivo**: Sistema de conversão de catálogos PDF/Excel para produtos normalizados com extração automática de imagens

---

## 1. Arquitetura do Sistema

### Stack Tecnológico
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Python + FastAPI + PyMuPDF (fitz) + Pillow
- **Storage**: Supabase Storage (bucket "source-files")
- **Database**: Supabase PostgreSQL

### Fluxo de Dados
```
PDF Upload → Frontend
    ↓
PDF Parser (smartPdfInterpreter.ts) → Extrai texto + spatialContext (x, y, width, height, page)
    ↓
Envio ao Backend Python (/process endpoint)
    ↓
Extrator PyMuPDF → Extrai imagens com coordenadas
    ↓
Matcher (matcher.py) → Associa imagens a SKUs por proximidade espacial
    ↓
Colagens automáticas (múltiplas imagens por SKU)
    ↓
ZIP gerado → Upload Supabase → URL pública
    ↓
Frontend exibe botão "Baixar ZIP"
```

---

## 2. Funcionalidades Implementadas ✅

### 2.1 Extração de PDF (Gira e similares)
- ✅ Parser semântico que detecta SKUs, preços, descrições
- ✅ `spatialContext`: cada produto tem coordenadas (x, y, width, height, page)
- ✅ Templates para fornecedores específicos
- ✅ Heurísticas genéricas como fallback

### 2.2 Extração de Imagens (Backend Python)
- ✅ Endpoint `/process` recebe PDF + lista de SKUs com coordenadas
- ✅ Extrai todas as imagens do PDF usando PyMuPDF
- ✅ Preserva metadados: página, posição (x, y), dimensões

### 2.3 Matching de Imagens (matcher.py)
- ✅ Estratégia: **Grid/Colunas** (clustering automático em X)
- ✅ Detecta 3 colunas automaticamente (padrão catálogos GIRA)
- ✅ Atribui imagens à coluna mais próxima
- ✅ Dentro da coluna, associa ao SKU mais próximo (distância ponderada: Y tem peso 1.5x)
- ✅ Cria colagens para múltiplas imagens por SKU
- ✅ Fallback: match por ordem se não houver coordenadas

### 2.4 Pipeline Completo
- ✅ Timeout de 120s para PDFs grandes
- ✅ Retry logic no upload para Supabase (3 tentativas)
- ✅ ZIP com imagens renomeadas (SKU.jpg)
- ✅ Download direto do ZIP processado

### 2.5 Frontend
- ✅ Card de métricas de imagens (total extraído, associado, não associado)
- ✅ Botão "Baixar ZIP" quando processamento completo
- ✅ Persistência do `zipUrl` no histórico (ConversaoSalva)
- ✅ Badge "ZIP" no histórico para conversões processadas

---

## 3. Arquivos-Chave e suas Responsabilidades

### Frontend (React/TypeScript)
| Arquivo | Responsabilidade |
|---------|------------------|
| `src/core/pipeline/smartPdfInterpreter.ts` | Extrai produtos de PDF + preenche spatialContext |
| `src/core/images/imageExtractionApi.ts` | Envia PDF + SKUs ao backend Python |
| `src/core/engine.ts` | Orquestra pipeline, chama extração de imagens |
| `src/pages/ConversaoProdutos.tsx` | UI de upload, processamento, exibição de resultados |
| `src/context/AppContext.tsx` | Estado global, histórico de conversões, zipUrl |

### Backend (Python)
| Arquivo | Responsabilidade |
|---------|------------------|
| `backend/image_extractor/main.py` | FastAPI app, endpoint `/process` |
| `backend/image_extractor/extractor.py` | Extrai imagens de PDF com PyMuPDF |
| `backend/image_extractor/matcher.py` | **CORE**: associa imagens a SKUs por coordenadas |
| `backend/image_extractor/storage.py` | Upload ZIP para Supabase |
| `backend/image_extractor/processor.py` | Orquestra extração → matching → ZIP |

### Tipos e Interfaces
| Arquivo | Responsabilidade |
|---------|------------------|
| `src/core/types/productPipeline.ts` | ProdutoNormalizadoV2 (inclui spatialContext) |
| `src/core/images/imageTypes.ts` | Tipos para extração de imagens |

---

## 4. Estrutura de Dados Importante

### ProdutoNormalizadoV2 (Frontend)
```typescript
interface ProdutoNormalizadoV2 {
  codigo: string;
  codigoOriginal: string;
  nome: string;
  precoBase: number;
  precoFinal: number;
  // ... outros campos
  spatialContext?: {
    x: number;
    y: number;
    width: number;
    height: number;
    page: number;
  };
}
```

### ConversaoSalva (Histórico)
```typescript
interface ConversaoSalva {
  id: string;
  arquivo: string;
  fornecedor: string;
  produtos: Produto[];
  imagens: { id, url, nome }[];
  zipUrl?: string;  // NOVO: URL do ZIP do backend
  // ...
}
```

### Payload para Backend
```json
{
  "skus": [
    {
      "sku": "GC0220",
      "name": "Porta Certificado 3 Cores",
      "page": 65,
      "spatialContext": { "x": 100, "y": 500, "width": 150, "height": 30 }
    }
  ],
  "supplier": "GIRA"
}
```

---

## 5. Status Atual do Image Matching

### ✅ O que funciona:
- Extração de 1000+ imagens de PDFs grandes (65+ páginas)
- **347 imagens associadas** de 441 produtos (~79% de sucesso)
- Colagens automáticas funcionando
- Download de ZIP com imagens renomeadas por SKU

### ⚠️ Limitações conhecidas:
- **97 imagens não associadas** (~21%) - geralmente imagens pequenas ou de decoração
- Matching por proximidade pode ocasionalmente misturar produtos adjacentes
- Não há validação visual automática das colagens

### 📊 Estratégia atual do matcher:
1. Detecta 3 colunas automaticamente pelas posições X dos SKUs
2. Atribui cada imagem à coluna mais próxima (por centro X)
3. Dentro da coluna, calcula distância até cada SKU
4. Score: `distância_X * 0.5 + distância_Y * 1.5` (prioriza vertical)
5. Máximo de 600px de distância

---

## 6. Configurações e Variáveis de Ambiente

### .env (Frontend)
```
VITE_BACKEND_URL=http://localhost:8000
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
BUCKET_NAME=source-files
```

### Backend Python
- Porta: 8000
- Requer: `fitz` (PyMuPDF), `Pillow`, `supabase`, `fastapi`, `uvicorn`

---

## 7. Como Testar o Fluxo Completo

1. Iniciar backend: `cd backend/image_extractor && python -m uvicorn main:app --reload --port 8000`
2. Iniciar frontend: `npm run dev`
3. Acessar: `http://localhost:8080/conversao`
4. Selecionar fornecedor "GIRA"
5. Upload do PDF do catálogo
6. Clicar "Processar Arquivo"
7. Verificar logs no terminal Python:
   - `[Matcher] Colunas detectadas: 3`
   - `[Matcher] ✓ p65_imgX.jpg -> SKU (score: XXX)`
   - `[Matcher] Total: XXX matches, XX não associadas`
8. Baixar ZIP quando aparecer botão

---

## 8. Regras de Ouro (Não quebrar!)

1. **NUNCA volte ao Lovable** para edições - todas as mudanças são locais
2. **Edições no backend Python** devem ser testadas localmente antes
3. **Logs são essenciais** - sempre adicionar print() no Python para debug
4. **Testar com 1 página primeiro** - não processar PDFs inteiros em dev
5. **Preservar spatialContext** - sem coordenadas o matching falha
6. **Timeout de 120s** para PDFs grandes no frontend

---

## 9. Próximos Passos Sugeridos

### Prioridade Alta (Planilhas - novo contexto):
- [ ] Revisar parser de Excel (.xlsx, .xls, .csv)
- [ ] Validação de colunas obrigatórias
- [ ] Mapeamento automático de headers
- [ ] Preview de dados antes de importar

### Prioridade Média (PDFs):
- [ ] Otimizar matcher para reduzir os 21% não associados
- [ ] Adicionar visualização de bounding boxes (debug)
- [ ] Validação manual de matches (UI para aprovar/rejeitar)

### Prioridade Baixa:
- [ ] Exportação para Mercos com imagens embutidas
- [ ] Dashboard de métricas de conversão

---

## 10. Comandos Úteis

```bash
# Iniciar tudo (Windows)
start-all.bat

# Backend apenas
cd backend/image_extractor
python -m uvicorn main:app --reload --port 8000

# Frontend apenas
npm run dev

# Testar backend
http://localhost:8000/health
```

---

## 11. Contatos e Recursos

- **Projeto base**: Criado no Lovable (não editar lá!)
- **Repositório**: GitHub conectado ao Windsurf
- **Deploy**: Configurado para Railway/Render (não deployar ainda)
- **Supabase**: Projeto ativo com bucket "source-files"

---

**Resumo para novo chat:**
> Sistema Converter Pro para importação de catálogos. PDFs processados via backend Python com matching espacial de imagens (347/441 imagens associadas). Planilhas Excel são o próximo foco. NUNCA editar no Lovable - tudo local. Stack: React+TS frontend, Python+FastAPI backend, Supabase storage.
