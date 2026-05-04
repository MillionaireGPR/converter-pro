# Converter-Pro - Guia de Arquitetura e Estrutura

## 1. Visão Geral
**Objetivo do Projeto:** O "Converter-Pro" (Central de Conversão) é uma ferramenta voltada para automação de conversão de catálogos, produtos e pedidos. O sistema importa bases de dados estruturadas, aplica regras de negócio (descontos, limpeza, mapeamentos) e exporta versões formatadas (como o padrão Mercos, planilhas para ERPs, etc.).

**Stack Tecnológica Principal:**
- **Frontend / Framework:** React 18, Vite, TypeScript.
- **Roteamento:** React Router DOM (v6+).
- **Estilização e UI:** Tailwind CSS, shadcn/ui e Radix UI (usando `lucide-react` para ícones).
- **Gerenciamento de Estado e Cache:** TanStack React Query (`@tanstack/react-query`) em conjunto com Context API (`AppContext.tsx`).
- **Formulários e Validação:** `react-hook-form` com `zod` e `@hookform/resolvers`.
- **Backend as a Service / DB:** Supabase (`@supabase/supabase-js`).
- **Manipulação de Arquivos e Utils:** `xlsx` para conversão e leitura Excel/CSV, `jspdf` para geração de PDFs, `date-fns` para datas.

---

## 2. Estrutura de Pastas
O projeto segue a estrutura padrão gerada pelo Lovable, focada em simplicidade e modularidade:

```text
src/
├── assets/          # Arquivos estáticos (imagens, ícones globais).
├── components/      # Componentes reutilizáveis (Layouts, Sidebar, StatCards).
│   └── ui/          # Componentes visuais base do shadcn/ui (Botões, Inputs, Dialogs).
├── context/         # Centralização do estado global provido via Context API (AppContext.tsx).
├── core/            # O CÉREBRO DA APLICAÇÃO (Regras de negócio isoladas).
│   ├── engine.ts    # Motor de processamento (conversões de produtos).
│   ├── autoMapper.ts# Inteligência de mapeamento automático de colunas.
│   ├── orderParser.ts # Motor para conversão de pedidos (Fase 2).
│   ├── normalizers/ # Funções de higienização de strings/dados.
│   ├── validators/  # Validações internas de dados.
│   └── types/       # Tipagens TypeScript estritas relacionadas às regras de negócio.
├── hooks/           # Custom hooks (geralmente wrappers para o React Query ou Supabase).
├── integrations/    # SDKs ou integrações externas.
│   └── supabase/    # Tipagens geradas do DB e inicialização do Client Supabase.
├── lib/             # Módulos utilitários globais (ex: shadcn utils como `cn`).
└── pages/           # Views/Rotas da aplicação (Dashboard, ExportacoesMercos, ConversaoPedidos, etc.).
```

---

## 3. Arquitetura e Padrões
- **Regra de Ouro (Service / Core Layer):** A lógica de negócios pesada (parsing de planilhas, cálculos de preços, mapeamento de colunas) NUNCA deve residir diretamente dentro de um arquivo da pasta `pages/`. Esses processos devem ficar dentro da pasta `src/core/`. As "pages" devem apenas gerenciar a UI e chamar as funções do `core`.
- **Fluxo de Dados Assíncronos:** A busca de dados (fetch) e mutações no Supabase são geridas de modo preferencial via **TanStack React Query**, garantindo cache automático e estados de *loading/error* consistentes na interface.
- **Gerenciamento de Estado e Props Drilling:** Em fluxos com vários passos, deve-se usar Context API (`AppContext`) para manter o estado configurado em uma tela persistido na próxima, sem repassar props infinitamente.

---

## 4. Banco de Dados e Autenticação (Supabase)
- **Acesso ao Banco:** Ocorre exclusivamente pela camada de hooks e chamadas de API passando pelo client do `@supabase/supabase-js`.
- **Row Level Security (RLS) & Multi-tenancy:** Por utilizar Supabase, a política de autorização e o isolamento de dados de usuários ocorrem através das tabelas possuírem as chaves do `user_id` e políticas ativas no painel do Supabase. A aplicação frontend confia no token JWT do cliente provido pela sessão atual. 
- **Migrações e Tipagens:** Sempre que o banco sofrer alterações, a tipagem `src/integrations/supabase/types.ts` deve ser recompilada/atualizada para refletir a modelagem correta e evitar erros silenciosos no Typescript.

---

## 5. Fluxos Críticos
1. **Conversão de Produtos (Fase 1):** O motor lê uma planilha (XLSX), o usuário associa um `fornecedor_id` (agora sempre UUID), aplica via interface regras de desconto e preço. O `core/engine.ts` recalcula a grade utilizando a inteligência do código, e em seguida essas linhas consolidadas descem para a página `ExportacoesMercos.tsx` que formata pro formato final Mercos.
2. **Conversão de Pedidos (Fase 2):** Ingestão de planilhas formatadas Mercos via `core/orderParser.ts`. O parser entende cabeçalhos, categoriza itens, status, rastreamento e disponibiliza a interface de preview para futuramente acoplar as chaves específicas do ERP.
3. **Leitura de Arquivos (XLSX):** O upload não sofre upload imediato para base: o binário é capturado, consumido em memória pela lib `xlsx`, transformado em matrizes (JSON arrays) gerenciadas pelo React temporariamente. 

---

## 6. Regras para a IA (Obrigatórias)
Antes, durante e depois de cada intervenção, a IA DEVE:
- **Antes:**
  1. Revisar o estado do `core/types` para entender os metadados estabelecidos.
  2. Verificar se já existe um utilitário de formatação (`normalizers` / `lib`) em vez de reinventar regras.
- **Durante:**
  1. Manter a didática nos códigos e variáveis: tudo muito explícito.
  2. Utilizar as definições de IU do `shadcn` (e.g., botões, tabelas, cards) invés de criar componentes HTML brutos com Tailwind desnecessariamente.
- **Depois:**
  1. Conferir se a implementação compromete o RLS (ex: enviar queries sem validação de owner).
  2. Fornecer de modo proativo os logs e modos de testagem visuais das novas features para o usuário final.

---

## 7. Regras Críticas (NUNCA FAZER)
- **NUNCA:** Acessar diretamente o `supabase` em um componente "burro" de UI. As queries devem trafegar mediante custom hooks ou Context.
- **NUNCA:** Mesclar ou misturar manipulação estrutural de lógicas da Fase 1 (Produtos) na Fase 2 (Pedidos). São módulos totalmente paralelos com tipagens diferentes.
- **NUNCA:** Sugerir ao usuário edições dentro do construtor visual Lovable. Todas correções de código devem ser locais, preservando a verba e os créditos da plataforma.
- **NUNCA:** Propor serviços/libs pagos para novas features; Priorize serviços open-source ou tier gratuitos generosos ao projetar novas soluções.

---

## 8. Alterações Recentes (Log)

### 2026-04-13: Múltiplas Categorias Visuais
Implementado suporte para produtos com múltiplas categorias visuais simultâneas (ex: REPOSIÇÃO + PREÇO FIXO).

**Arquivos Modificados:**
- `src/core/types/productPipeline.ts` - Adicionado campo `visualTags?: string[]`
- `src/core/supplierRules/clink-family-base.ts` - Nova função `detectAllVisualCategories()`, suporte a múltiplos sufixos
- `src/context/AppContext.tsx` - Interface `Produto` atualizada, mapeamento `visualTags` em `addProdutosNormalizados()`
- `src/pages/DescontosCatalogos.tsx` - Filtros e badges usam `visualTags`, botões de bloqueio para todas as categorias
- `src/pages/ExportacoesMercos.tsx` - Preview mostra todas as categorias

**Regras:**
- Categoria primária (para desconto): PROMO > FIXO > REPOS > NOVO > PADRAO
- Um produto pode ter múltiplas tags: `['reposicao', 'preco-fixo']`
- Sufixos são aplicados na ordem: PROMO → FIXO → REPOS → NOVO
- Produtos aparecem em TODOS os filtros das categorias que possuem

**Bug Corrigido:**
- `src/core/pipeline/smartPdfInterpreter.ts` - Corrigido escopo de chaves que fechava o `if (template...)` cedo demais

---

## 9. Regra de Ouro: Estabilidade em Primeiro Lugar

Esta é a regra mais importante do sistema para garantir a continuidade do negócio:
- **O que já funciona NÃO SE MEXE:** Antes de implementar qualquer melhoria ou nova funcionalidade, deve-se garantir que os fluxos preexistentes (especialmente importação de planilhas Excel que já operam perfeitamente) não sofram regressões.
- **Isolamento de Impacto:** Funcionalidades novas (como a extração de imagens via Python) devem ser estritamente condicionais. Se o arquivo não for um PDF que exija extração, o sistema deve seguir o caminho estável e rápido original.
- **Custo de Regressão:** Uma falha em um fluxo que já estava homologado é considerada um erro crítico de arquitetura.

---

## 10. Alterações Recentes Adicionais (Log)

### 2026-04-24: Estabilização da Fase 3 (Imagens GIRA)
Implementação final do motor de extração em Python com lógica de grade espacial.

**Arquivos Modificados:**
- `backend/image_extractor/extractor.py` - Novo motor ultra-compatível via `get_images`.
- `backend/image_extractor/matcher.py` - Lógica de Grade (Clustering X/Y) e Colagens automáticas.
- `src/context/AppContext.tsx` - Sincronização do payload para incluir `spatialContext` (essencial para o match).
- `src/core/imageJobs/` - Hooks de polling e criação de jobs no Supabase.

**Resultados Alcançados:**
- Extração de +1000 imagens em catálogos de 65 páginas (ex: Gira Imports).
- Taxa de match automático superior a 75% usando coordenadas espaciais.
- Normalização automática de fundo (fundo branco para todas as fotos).
- Progresso em tempo real no frontend (Página X/Y).

### 2026-04-25: Correção de Regressão em Planilhas Excel e Propagação de Imagens
Corrigido bug que forçava planilhas Excel a passarem pelo motor de imagens do Python e perda de dados de imagem no pipeline V2.

**Arquivos Modificados:**
- `src/core/engine.ts` - Restrita a flag `needsImageExtraction` apenas para arquivos `.pdf`.
- `src/core/pipeline/importPipeline.ts` - Corrigida a propagação dos campos `imagemUrl` e `temImagem`.
- `src/core/supplierRules/extractor.ts` & `clink-family-base.ts` - Implementada detecção automática de colunas de imagem para planilhas.
- `src/pages/ConversaoProdutos.tsx` - Adicionada coleta de imagens para o histórico e botão de download (ZIP) para arquivos Excel.
- `backend/image_extractor/storage.py` - Corrigido erro de nome de campo (`match_confidence`) que causava loop no frontend.

**Impacto:**
- Recuperada a velocidade original de processamento de planilhas (Moment, Nix House, etc.).
- Imagens presentes em planilhas Excel (URLs) agora são preservadas e exibidas corretamente.
- Usuários podem baixar o ZIP de imagens de conversões Excel diretamente do histórico.
- Resolvido o problema de looping infinito no processamento de imagens de PDFs.

### 2026-04-26: Implementação do Order Exporter e Proteções de CI/CD
Implementação completa do sistema de exportação de pedidos com múltiplos formatos e proteções de segurança.

**Arquivos Modificados:**
- `src/core/orders/orderExporter.ts` - Novo sistema de exportação (Nunes, Clink, Gira, Genérico, ERP, JAWEB).
- `src/core/orders/orderExporter.test.ts` - Testes unitários completos (cobertura 70%+).
- `src/pages/ConversaoPedidos.tsx` - Integração do exportador com UI dinâmica de formatos.
- `.github/workflows/ci-cd.yml` - Workflow de CI/CD com 7 jobs de proteção.
- `.windsurf/rules.md` - Regras obrigatórias para IA.
- `DEVELOPMENT_PROTOCOL.md` - Protocolo de desenvolvimento seguro.

**Funcionalidades:**
- Exportação para 6 formatos diferentes (incluindo JAWEB com estrutura especial).
- Validação automática antes de exportar.
- Download automático do arquivo gerado.
- Integração com histórico de conversões.

### 2026-04-29: Migração para Extração de Imagens via OpenCV (Grid Detection)
Substituição completa da estratégia de image matching por detecção visual de linhas pontilhadas.

**Problema anterior:**
- Taxa de erro ~30% em catálogos de grid (3 colunas × N linhas)
- Cross-contamination: imagens associadas ao SKU vizinho
- 126 SKUs sem foto (~29% de cobertura) em processamento de 441 SKUs
- Imagens cortadas parcialmente pela detecção de células estimadas
- Renderização lenta e pixelada como fallback

**Solução implementada:**
1. **Algoritmo OpenCV**: Detecção de linhas pontilhadas via Canny + HoughLinesP
2. **Grid detection**: Clustering de linhas → construção automática de células
3. **Matching determinístico**: SKU → célula (sem ambiguidade)
4. **Sem fallbacks**: Uma estratégia, 100% de cobertura para catálogos com linhas visíveis

**Arquivos Modificados:**
- `backend/image_extractor/cv_extractor.py` - Novo arquivo (150 linhas), função única `extract_cells_via_cv()`
- `backend/image_extractor/main.py` - Simplificado, endpoint /process reduzido de 115 para 50 linhas
- `backend/image_extractor/requirements.txt` - Adicionado `opencv-python-headless==4.10.0.84`
- `backend/image_extractor/extractor.py` - Deprecado (4 funções obsoletas deletadas)
- `backend/image_extractor/matcher.py` - Deletado (estratégia de matching não é mais necessária)

**Algoritmo (6 passos por página):**
1. Render PDF em 150 DPI → array NumPy
2. Canny edge detection + HoughLinesP (maxLineGap=15)
3. Filtro orientação (±2° de 0° horizontal ou 90° vertical)
4. Clustering de linhas próximas (tolerância 10px) → grid coordinates
5. Construção de células via interseções consecutivas
6. Match SKU por posição + crop raster → PNG

**Benefícios:**
- Coverage 95%+ mesmo sem imagens embedadas (funciona com grid visual)
- Sem cross-contamination: limites de célula são reais, não estimados
- 3x mais rápido: sem matching iterativo, sem renderização múltipla
- Escalável: mesmo código serve para qualquer layout (3x3, pirâmide, par, coluna)
- Custo zero: OpenCV roda local, sem APIs pagas

---

## 11. CI/CD e Proteção de Código

### 11.1 Workflow de Integração Contínua
Todo código passa por validação automática antes de merge:

**Jobs do CI/CD:**
1. **Análise de Impacto**: Detecta modificação em arquivos críticos
2. **Lint e Types**: ESLint + TypeScript sem erros
3. **Testes Unitários**: Cobertura mínima 70%
4. **Testes de Regressão**: Fluxos críticos testados quando arquivos sensíveis são modificados
5. **Build**: Garante que compilação funciona
6. **Segurança**: Scan de vulnerabilidades e secrets
7. **Deploy**: Automático para produção (apenas main)

### 11.2 Arquivos Críticos Protegidos
Modificações nestes arquivos disparam revisão obrigatória dupla:
- `src/core/engine.ts` - Motor de processamento
- `src/core/pipeline/importPipeline.ts` - Pipeline de importação
- `src/core/supplierRules/*` - Regras de fornecedores
- `src/core/orders/orderParser.ts` - Parser de pedidos
- `src/core/orders/orderExporter.ts` - Exportador de pedidos
- `src/context/AppContext.tsx` - Estado global
- `src/integrations/supabase/types.ts` - Tipagens do banco

### 11.3 Regras de Branch
- `main`: Produção - Protegida, apenas via PR aprovado
- `develop`: Integração - Branch padrão para desenvolvimento
- `feature/*`: Novas funcionalidades
- `fix/*`: Correções
- **NUNCA commitar diretamente na main**

### 11.4 Pull Request Obrigatório
Todo código deve passar por:
- [ ] Revisão de código (code review)
- [ ] CI passando (todos os checks verdes)
- [ ] Aprovação explícita de revisor
- [ ] Sem conflitos com a base

### 11.5 Rollback
Se deploy quebrar produção:
1. Reverter PR imediatamente
2. Notificar stakeholders
3. Investigar em ambiente de staging
4. Correção via nova branch/PR

---

## 12. Referências Rápidas

### Comandos Úteis:
```bash
# Testes
npm run test -- --run
npm run test -- --run --coverage

# Build
npm run build

# Lint
npm run lint

# Tipos
npx tsc --noEmit
```

### Documentação:
- Arquitetura: `guide.md` (este arquivo)
- Segurança: `SECURITY.md`
- Regras de IA: `.windsurf/rules.md`
- Protocolo: `DEVELOPMENT_PROTOCOL.md`
- CI/CD: `.github/workflows/ci-cd.yml`

---

## 13. Image Extraction via OpenCV (PDF Catalog Extraction)

> **Contexto**: Extração de imagens de catálogos PDF com estratégia adaptativa por página.

### 13.1 Estratégia Atual (OpenCV Adaptativo - Desde 2026-04-30)

**Abordagem por página:**
O motor detecta automaticamente o tipo de layout de cada página e escolhe a estratégia adequada:

| n° de V-lines interiores detectadas | Estratégia | Descrição |
|--------------------------------------|------------|-----------|
| 1 a 4 | **Grid** | Crop de células formadas por linhas pontilhadas |
| 0 ou > 4 | **Embedded** | Imagens embedadas + matching por Y-proximity |

**Frontend → Backend Flow:**
```
1. PDF upload → Frontend (React)
2. spatialContext extraído do PDF (smartPdfInterpreter.ts)
3. Dados enviados ao backend Python:
   { "skus": [{"sku": "GC0220", "spatialContext": {x, y, page}}] }
4. main.py:
   a. Obter page_heights via PyMuPDF
   b. Converter Y: pymupdf_y = page_height - pdfjs_y
   c. Deduplica SKUs por (sku, page) — proteção contra PDFs com texto duplicado
5. cv_extractor.py por página:
   a. Render 150 DPI → raster NumPy (np.frombuffer correto)
   b. Canny + HoughLinesP + filtro orientação → H/V lines (comprimento mínimo 15% página)
   c. Clustering (tolerância 40px) + filtro ≥2 segmentos → coordenadas reais
   d. Se 1-4 V-interiores: estratégia Grid
   e. Se 0 ou >4 V-interiores: estratégia Embedded
6. ZIP → upload Supabase → zipUrl retornada ao frontend
```

**Arquivos Principais:**
- `backend/image_extractor/cv_extractor.py` — Motor: detecção OpenCV + estratégias Grid/Embedded
- `backend/image_extractor/main.py` — Endpoint: conversão de coords + chamada cv_extractor
- `backend/image_extractor/storage.py` — Upload Supabase (sem mudança)
- `src/core/images/imageExtractionApi.ts` — Envia dados ao backend (sem mudança)

### 13.2 Estratégia Grid

Para catálogos com linhas pontilhadas visíveis (GIRA, GOAL, NIXHOUSE, LILA HOME):

```python
# Cada célula é definida pelas interseções H × V:
for i in range(len(h_coords) - 1):
    for j in range(len(v_coords) - 1):
        cell = {y_min, y_max, x_min, x_max}

# Match: SKU cai dentro da célula → crop do raster
cell_img = raster[cell.y_min:cell.y_max, cell.x_min:cell.x_max]
# Expansão: se célula < 150px altura (zona texto), incorpora célula acima
```

### 13.3 Estratégia Embedded

Para catálogos sem grid visual (BM36, CLINK, DAGIA, FASTNEO):

```python
# Filtros de imagem:
logo_xrefs = imagens que aparecem em ≥3 páginas (logos/cabeçalhos)
# Rejeitar: iw<20 ou ih<20 (ícones), iw>85% e ih>85% da página (backgrounds)

# Score de matching por SKU (menor = melhor):
score(img) = abs(img.cy - sku_y) * 2 + abs(img.cx - sku_x)
# Y tem peso 2x → prioriza imagem acima/abaixo do SKU vs laterais
```

### 13.4 Resultados por Fornecedor (Teste E2E 2026-04-30)

| Fornecedor | SKUs | Match | % | Estratégia |
|------------|------|-------|---|------------|
| GIRA | 24 | 24 | 100% | Grid (2 V-int) |
| GOAL | 9 | 9 | 100% | Grid/Embedded misto |
| NIXHOUSE | 5 | 5 | 100% | Grid (2-3 V-int) |
| LILA HOME | 12 | 12 | 100% | Grid (1-2 V-int) |
| CLINK | 24 | 24 | 100% | Embedded (7 V-int) |
| DAGIA | 6 | 6 | 100% | Embedded (0 V-int) |
| BM36/WC | 25 | 24 | 96% | Embedded (5-6 V-int) |
| FASTNEO | 70 | 69 | 98.6% | Grid/Embedded misto |
| **TOTAL** | **175** | **173** | **98.9%** | |

### 13.5 Padrões SKU por Fornecedor

| Fornecedor | Regex | Exemplos |
|------------|-------|---------|
| GIRA | `^[A-Z]{2,3}\d{3,4}$` | GC0220, AB123 |
| BM36/WC | `^(BM\|WC)\d{4,8}$` | BM361645, WC409750 |
| GOAL | `^GK\d{3,6}$` | GK12345 |
| CLINK | `^CK\d{3,5}$` | CK4372 |
| LILA HOME | `^LH\d{2,4}$` | LH924 |
| DAGIA | `^D[A-Z]{1,3}\d{1,4}[A-Z]?\d*$` | DXP25, DZ04 |
| NIXHOUSE | `^NX\d{3,5}$` | NX020 |
| FASTNEO | `^\d{6,8}$` | 153060 |

### 13.6 Tuning (se necessário)

```python
# Em cv_extractor.py, linha _detect_lines():
edges = cv2.Canny(gray, 30, 120)  # thresholds mais baixos para linhas finas
lines = cv2.HoughLinesP(..., threshold=40, minLineLength=20)  # mais permissivo

# Limiar para estratégia grid:
if 1 <= n_interior_v <= 4:  # aumentar para <=6 se catálogo tem mais colunas
```

Rodar `test_all_suppliers.py` após qualquer ajuste para validar cobertura geral.

---

**Mantenha este guia atualizado após cada mudança significativa.**
