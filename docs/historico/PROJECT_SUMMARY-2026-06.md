# Converter Pro - Resumo do Projeto

> **Última atualização**: Maio 2026
> **Objetivo**: Sistema de conversão de catálogos PDF/Excel para produtos normalizados com extração automática de imagens

---

## 1. Arquitetura do Sistema

### Stack Tecnológico
- **Frontend**: React 18 + TypeScript + Vite 5 + Tailwind CSS 3 + shadcn/ui
- **Backend**: Python + FastAPI + PyMuPDF (fitz) + OpenCV (headless) + Pillow
- **Storage**: Supabase Storage (bucket "source-files")
- **Database**: Supabase PostgreSQL (com RLS para multi-tenancy)
- **Deploy**: Vercel (frontend) + Render/Railway (backend Python)

### Fluxo de Dados
```
PDF Upload → Frontend (React)
    ↓
PDF Parser (smartPdfInterpreter.ts) → Extrai texto + spatialContext (x, y, width, height, page)
    ↓
Envio ao Backend Python (/process endpoint)
    ↓
cv_extractor.py → Detecção adaptativa por página:
  - Grid (1-4 V-lines): crop por célula via OpenCV Canny + HoughLinesP
  - Embedded (0 ou >4 V-lines): imagens embedadas + matching Y-proximity
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
- ✅ Templates para fornecedores específicos (11 templates)
- ✅ Heurísticas genéricas como fallback

### 2.2 Extração de Imagens (Backend Python — OpenCV Adaptativo)
- ✅ Endpoint `/process` recebe PDF + lista de SKUs com coordenadas
- ✅ Estratégia **Grid**: detecção de linhas pontilhadas via Canny + HoughLinesP
- ✅ Estratégia **Embedded**: imagens embedadas + matching por Y-proximity
- ✅ Seleção automática de estratégia por página (1-4 V-interiores = Grid, senão Embedded)
- ✅ **98.9% de cobertura** em testes E2E com 8 fornecedores (175 SKUs → 173 matches)

### 2.3 Pipeline Completo
- ✅ Timeout de 120s para PDFs grandes
- ✅ Retry logic no upload para Supabase (3 tentativas)
- ✅ ZIP com imagens renomeadas (SKU.jpg)
- ✅ Download direto do ZIP processado
- ✅ Normalização automática de fundo branco em todas as imagens

### 2.4 Conversão de Pedidos (Fase 2)
- ✅ Parser de pedidos Excel (orderParser.ts)
- ✅ Parser de PDF Mercos (mercosOrderPdfParser.ts)
- ✅ Exportação para 6 formatos: Nunes, Clink, Gira, Genérico, ERP, JAWEB
- ✅ Validação automática antes de exportar

### 2.5 Frontend
- ✅ Card de métricas de imagens (total extraído, associado, não associado)
- ✅ Botão "Baixar ZIP" quando processamento completo
- ✅ Persistência do `zipUrl` no histórico (ConversaoSalva)
- ✅ Badge "ZIP" no histórico para conversões processadas
- ✅ Múltiplas categorias visuais simultâneas (REPOSIÇÃO + PREÇO FIXO, etc.)
- ✅ Feature flags para controle de funcionalidades

---

## 3. Arquivos-Chave e suas Responsabilidades

### Frontend (React/TypeScript)
| Arquivo | Responsabilidade |
|---------|------------------|
| `src/core/pipeline/smartPdfInterpreter.ts` | Extrai produtos de PDF + preenche spatialContext |
| `src/core/pipeline/importPipeline.ts` | Pipeline completo de importação |
| `src/core/images/imageExtractionApi.ts` | Envia PDF + SKUs ao backend Python |
| `src/core/engine.ts` | Orquestra pipeline, chama extração de imagens |
| `src/core/supplierRules/registry.ts` | Registro central de fornecedores |
| `src/core/orders/orderExporter.ts` | Exportação multi-formato de pedidos |
| `src/core/mercos/exportMercos.ts` | Exportação no formato Mercos |
| `src/pages/ConversaoProdutos.tsx` | UI de upload, processamento, exibição de resultados |
| `src/pages/DescontosCatalogos.tsx` | Configuração de descontos por catálogo |
| `src/context/AppContext.tsx` | Estado global, histórico de conversões, zipUrl |

### Backend (Python)
| Arquivo | Responsabilidade |
|---------|------------------|
| `backend/image_extractor/main.py` | FastAPI app, endpoint `/process`, conversão de coordenadas |
| `backend/image_extractor/cv_extractor.py` | **CORE**: OpenCV adaptativo (Grid + Embedded) |
| `backend/image_extractor/storage.py` | Upload ZIP para Supabase Storage |

### Tipos e Interfaces
| Arquivo | Responsabilidade |
|---------|------------------|
| `src/core/types/productPipeline.ts` | ProdutoNormalizadoV2 (inclui spatialContext) |
| `src/core/images/imageTypes.ts` | Tipos para extração de imagens |
| `src/core/orders/orderTypes.ts` | Tipos para conversão de pedidos |
| `src/core/supplierRules/types.ts` | Interfaces de regras de fornecedor |

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
  visualTags?: string[];
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
  zipUrl?: string;  // URL do ZIP do backend
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

## 5. Status Atual do Image Matching (OpenCV Adaptativo)

### ✅ O que funciona:
- Extração de 1000+ imagens de PDFs grandes (65+ páginas)
- **98.9% de cobertura** (173/175 SKUs associados corretamente em teste E2E)
- Estratégia adaptativa por página (Grid vs Embedded)
- Normalização de fundo branco em todas as imagens
- 3x mais rápido que a versão anterior
- Custo zero (OpenCV roda local)

### 📊 Resultados por Fornecedor (Teste E2E):

| Fornecedor | SKUs | Match | % | Estratégia |
|------------|------|-------|---|------------|
| GIRA | 24 | 24 | 100% | Grid |
| GOAL | 9 | 9 | 100% | Grid/Embedded misto |
| NIXHOUSE | 5 | 5 | 100% | Grid |
| LILA HOME | 12 | 12 | 100% | Grid |
| CLINK | 24 | 24 | 100% | Embedded |
| DAGIA | 6 | 6 | 100% | Embedded |
| BM36/WC | 25 | 24 | 96% | Embedded |
| FASTNEO | 70 | 69 | 98.6% | Grid/Embedded misto |
| **TOTAL** | **175** | **173** | **98.9%** | |

### 📊 Algoritmo (6 passos por página):
1. Render PDF em 150 DPI → array NumPy
2. Canny edge detection + HoughLinesP (maxLineGap=15)
3. Filtro orientação (±2° de 0° horizontal ou 90° vertical)
4. Clustering de linhas próximas (tolerância 40px) → grid coordinates
5. Construção de células via interseções consecutivas
6. Match SKU por posição + crop raster → PNG

---

## 6. Fornecedores Suportados

| Fornecedor | Regra | Template PDF |
|-----------|-------|-------------|
| BM36 | bm36.ts | bm36.template.ts |
| Clink | clink.ts + clink-family-base.ts | clink.template.ts |
| Flash | flash.ts | — |
| Freecom | freecom.ts | — |
| Goal Kids | goal-kids.ts | — |
| Levivan | levivan.ts | — |
| Lila Home | lila-home.ts | lila-home.template.ts |
| Moment | moment.ts | moment.template.ts |
| Neo Festas | neo-festas.ts | neo-festas.template.ts |
| Nix House | nix.ts | nix.template.ts |
| Petrin | petrin.ts | — |
| Gira Imports | (via clink-family-base) | gira-imports.template.ts |
| Dagia | (via clink-family-base) | dagia.template.ts |
| Genérico | generic.ts | — |

---

## 7. Configurações e Variáveis de Ambiente

### .env (Frontend)
```
VITE_BACKEND_URL=http://localhost:8000
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
BUCKET_NAME=source-files
```

### Backend Python
- Porta: 8000
- Requer: `fitz` (PyMuPDF), `opencv-python-headless`, `Pillow`, `supabase`, `fastapi`, `uvicorn`

---

## 8. Como Testar o Fluxo Completo

1. Iniciar backend: `cd backend/image_extractor && python -m uvicorn main:app --reload --port 8000`
2. Iniciar frontend: `npm run dev`
3. Acessar: `http://localhost:8080/conversao`
4. Selecionar fornecedor (ex: "GIRA")
5. Upload do PDF do catálogo
6. Clicar "Processar Arquivo"
7. Verificar logs no terminal Python
8. Baixar ZIP quando aparecer botão

Ou usar o script integrado: `start-all.bat`

---

## 9. Regras de Ouro (Não quebrar!)

1. **NUNCA volte ao Lovable** para edições - todas as mudanças são locais
2. **Estabilidade primeiro** - o que já funciona NÃO SE MEXE sem testes
3. **Edições no backend Python** devem ser testadas localmente antes
4. **Preservar spatialContext** - sem coordenadas o matching falha
5. **Fases independentes** - NÃO misturar lógica da Fase 1 (Produtos) com Fase 2 (Pedidos)
6. **Free-tier** - priorizar serviços gratuitos ou open-source

---

## 10. Testes

```bash
# Rodar todos os testes (173 testes, 15 suites)
npm run test

# Testes do backend Python (cobertura por fornecedor)
cd backend/image_extractor && python test_all_suppliers.py

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

---

## 11. Comandos Úteis

```bash
# Iniciar tudo (Windows)
start-all.bat

# Backend apenas
cd backend/image_extractor
python -m uvicorn main:app --reload --port 8000

# Frontend apenas
npm run dev

# Health check do backend
http://localhost:8000/health

# Build de produção
npm run build
```

---

> **Resumo para novo chat:**
> Sistema Converter Pro para importação de catálogos com 14 fornecedores suportados. PDFs processados via backend Python com OpenCV adaptativo (98.9% cobertura). Planilhas Excel importadas diretamente no frontend. Exportação multi-formato (Mercos, ERP, JAWEB). NUNCA editar no Lovable - tudo local. Stack: React 18 + TS + Vite frontend, Python + FastAPI + OpenCV backend, Supabase DB/Storage.
