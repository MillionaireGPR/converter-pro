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
- **Extração de catálogos (desde v23, 09/06/2026):** Gemini 2.5 Flash é o
  extrator PRIMÁRIO — lê o PDF inteiro e escolhe a imagem do produto. O
  regex de 14 parsers manuais virou FALLBACK automático (nunca removido).
  Ver `## 14` abaixo e `ARCHITECTURE.md` (invariantes IV-01 a IV-23).
- **Backend Python (FastAPI):** roda em dois ambientes simultâneos — servidor
  próprio (via Cloudflare Tunnel nomeado/fixo, `conversor-api.metodoiqc.com.br`)
  como primário e Render Starter como reserva, com failover automático no
  cliente. Ver `## 14.3`.

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

## 14. Alterações Recentes (Junho–Agosto 2026) — Motor AI-First e Autonomia do Cliente

> Este guia ficou sem atualização de 30/04 até 26/08 — quatro meses de
> evolução real não documentada aqui (estava só em `ARCHITECTURE.md`,
> `CLAUDE.md` e `IQC_STATUS_ATUAL.md`). Este bloco fecha essa lacuna com os
> pilares que mudaram a arquitetura de fato. Detalhe fino de cada invariante
> está em `ARCHITECTURE.md` (IV-01 a IV-23) — não duplicado aqui.

### 14.1 Motor AI-First (v23, 09/06/2026)
Os 14 parsers regex artesanais deixaram de ser o caminho principal.
**Gemini 2.5 Flash lê o catálogo PDF inteiro** e devolve os produtos
estruturados; o regex antigo virou **fallback automático** (nunca removido —
IV-15) se a IA falhar ou o catálogo estiver na blocklist (NIX, GOAL KIDS).
Ajustar um fornecedor agora é editar 3-4 linhas de prompt em
`SUPPLIER_HINTS` (`backend/image_extractor/gemini_extractor.py`), não criar
parser novo. Extração de imagem segue o mesmo princípio: Gemini escolhe qual
imagem é o produto (AI Picker), memory-safe — manda 1 página anotada, extrai
só a escolhida (nunca todas as candidatas — foi o que causou OOM no v21).

### 14.2 Fornecedor configura sozinho (PRs #97-#111, ago/2026)
Motivação: cada fornecedor com layout próprio exigia o Gabriel editar
código + PR + deploy. Agora o cliente configura pela própria interface:
- **Mapeamento de colunas** (`suppliers.column_mappings`, tela `/regras` +
  painel de conferência no upload): qual coluna da planilha alimenta qual
  campo do sistema. Vence a detecção automática; aliases originais seguem
  como fallback se o fornecedor renomear a coluna.
- **Particularidades do catálogo PDF em texto livre**
  (`suppliers.extraction_rules`): o cliente escreve com as próprias
  palavras o que aquele fornecedor tem de diferente; `compile_client_rules`
  (Gemini) traduz em regras objetivas ANTES de entrar no prompt — evita
  "devaneio" e trunca por thinking-tokens (mesma classe de bug do Phase 0,
  resolvida com `_gen_text_json`). Cache por hash do texto.
- **Configuração na hora do upload** (26/08/2026, PR #111): as duas coisas
  acima agora também aparecem direto em `/conversao` — fornecedor novo
  ("+ Novo") ou existente — sem precisar de uma segunda visita a
  Fornecedores/Regras de Colunas depois de subir o catálogo. Fornecedor
  novo ainda não tem `id` no banco: mapeamento/particularidades ficam em
  memória e entram junto no mesmo `INSERT` que o cria.

### 14.3 Infraestrutura de backend dual + failover (14/08–25/08/2026)
O backend Python roda em **dois ambientes ao mesmo tempo**:
servidor próprio e Render Starter (mais fraco, porém estável, puxa do
`main` sozinho). `src/core/backendResolver.ts` testa o primário via
`/health` e cai no outro na MESMA requisição se não responder — zero
downtime perceptível pelo cliente, sem depender de nenhum monitor externo.
`VITE_BACKEND_URL_PRIMARY` existe para travar manualmente qual dos dois é
o primário durante transições (ex.: servidor próprio com código
desatualizado) sem que o watcher do túnel reverta a escolha sozinho.

**Causa raiz de instabilidade encontrada (25/08):** um serviço systemd pode
aparecer "active" sem que a conexão real do túnel exista (rede não pronta
no boot) — só reinicia o serviço, não crasha sozinho. Diagnóstico sempre
externo (curl real), nunca só pelo status do systemd.

**Migração pro Tunnel fixo da Cloudflare (28/08–01/09/2026):** o domínio
`metodoiqc.com.br` (Registro.br) migrou os nameservers pro Cloudflare
(`carlos`/`jasmine.ns.cloudflare.com`), e o servidor próprio trocou o
Cloudflare **Quick Tunnel** (`*.trycloudflare.com`, URL aleatória a cada
restart — causa raiz das quedas percebidas pelo cliente, cobertas até
então por `cf_tunnel_watcher.sh` detectando a URL nova e disparando
redeploy) por um **Tunnel nomeado, config gerenciada pela própria
Cloudflare** (`config_src: cloudflare`, sem `config.yml` local), exposto
permanentemente em `https://conversor-api.metodoiqc.com.br` (reaproveita
um subdomínio que já existia com um IP morto). `VITE_BACKEND_URL_PRIMARY`
foi setado em produção pra esse endereço fixo — é o mesmo mecanismo de pin
já existente, nunca usado até então. `backendLabel()` (`backendResolver.ts`)
passou a reconhecer `metodoiqc.com.br`, além do antigo `trycloudflare.com`,
como servidor "próprio".

`cf_tunnel_watcher.sh` e `update_vercel_backend_url.py` ficaram obsoletos
com essa migração (o endereço não muda mais sozinho) e foram removidos do
repo em 18/09/2026. **Pendente**: confirmar se o processo do Quick Tunnel
ainda roda no servidor do Wesley — não há credencial de SSH documentada
pra esse host (só o token de monitoramento que a Integrator usa), então
essa parte não foi verificada remotamente.
Registros DNS de `metodoiqc.com.br` replicados manualmente na Cloudflare
antes do corte de nameserver: MX (Google Workspace), CNAME de
`pirralhos.metodoiqc.com.br` (Central Pirralhos/Vercel), CNAME de
`digitalcompany.metodoiqc.com.br` (GitHub Pages) e o TXT de verificação do
Google em `pantoni.metodoiqc.com.br`.

**VPS Integrator + arquitetura de 3 servidores (04/09–07/09/2026):** o
servidor do Wesley seguiu instável (novas quedas de rede/energia locais,
inclusive com SSH inacessível), então foi provisionada uma VPS própria — a
**Integrator** (ICP Core, `conversor-vps.metodoiqc.com.br`, ver
`infra/integrator/` pro runbook completo: Docker/Compose, Nginx, TLS via
Certbot, timer de limpeza de 21 dias, senha administrativa persistida fora
do container). Homologada e cortada pra produção em 04/09 com autorização
do Gabriel — hoje é o backend PRINCIPAL, substituindo o servidor do Wesley
nesse papel.

A arquitetura de failover virou **3 níveis** (decisão de 07/09, depois de
mais uma queda do Wesley coincidindo com a criação de um túnel Cloudflare
separado num sistema totalmente diferente — investigado e descartado como
causa: eram máquinas diferentes, só coincidência de horário):

1. **Integrator** (primário, `VITE_BACKEND_URL_PRIMARY`) — VPS própria.
2. **Render** (reserva automática, `VITE_BACKEND_URL_FALLBACK`) — mais
   fraco, porém o mais estável historicamente.
3. **Wesley** (última instância, `VITE_BACKEND_URL_FALLBACK_2`) — continua
   com porta fechada e sem atualização; existe estruturalmente na cadeia
   mesmo assim, porque é melhor que o site fique fora do ar só se
   Integrator E Render caírem ao mesmo tempo.

`pickBackends()`/`probe()` (`backendResolver.ts`) testam os três em ordem
via `/health`, com a mesma lógica de dedup contra o pin que já existia entre
primário/reserva estendida pra 3 posições — nunca dois níveis apontando pro
mesmo servidor. O painel de monitoramento (`_MONITORED_SERVERS` em
`main.py`, servido pela própria Integrator) segue a mesma ordem.

### 14.4 Painel do servidor e observabilidade
`/admin/dashboard` (backend) mostra CPU/RAM em tempo real, pico por
conversão e jobs recentes. Desde 04/09 o painel central mora na Integrator
e monitora os 3 servidores ao mesmo tempo (métricas completas da própria
Integrator; saúde/latência de Render e Wesley) — por isso `/servidor`
(frontend) hoje é um endereço FIXO pra essa Central dos Servidores, e não
mais um redirecionamento condicional pro backend que processou a última
conversão (comportamento antigo, de quando só existiam 2 servidores).
Histórico de conversões (`/historico`) registra servidor usado, tempo de
processamento e se a extração foi via Gemini ou regex — auditoria sem
precisar pedir print pro cliente.

### 14.5 Upload é o gargalo real do AI-first (incidente 08–10/09/2026)

O Josef reportou "a FORTAL não extraiu as imagens" e "a TUKA TOYS não extraiu
basicamente nada". Os dois casos tinham a MESMA natureza, e nenhuma relação com
casamento de imagem: **a IA nunca chegou a rodar** — o catálogo não chegou ao
Gemini. O fallback pro regex é silencioso, então a tela dizia "Concluído" com
menos produtos e zero imagens, sem explicar nada.

Como o regex nunca casou imagem (só o pipeline de IA faz isso), `0/0 imagens` +
`sem IA` no histórico é a assinatura desse problema — não é bug de imagem.

Três causas independentes, todas confirmadas com evidência e corrigidas:

1. **Prazo fixo de 180s no upload** (`aiFirstExtractionApi.ts`). O log do Nginx
   registrou 10 POSTs abortados pelo cliente, espaçados de 183/186/192/204s —
   180s + o backoff exponencial 3/6/12/24s, assinatura exata do
   `AbortController`, não de erro do servidor. A FORTAL (96,4MB) não subia nesse
   prazo no link do Josef; o mesmo arquivo, de um link rápido, subiu em 18,6s e
   a IA devolveu **950 produtos em 47s**. Agora o prazo é proporcional ao
   tamanho (`uploadTimeoutMs`, teto de 30min pra manter IV-08) — ver 14.7, que
   corrigiu o piso de banda e estendeu a regra ao upload das fotos.
2. **`/tmp` do container é tmpfs de 256MB (RAM)**. O Starlette grava o corpo do
   upload em arquivo temporário, então a TUKA TOYS (435,7MB) morria com
   `400 There was an error parsing the body` por volta dos 272MB. Corrigido com
   `TMPDIR=/app/uploads_tmp`, em disco (ver `infra/integrator/README.md`).
3. **`client_max_body_size` de 300MB no Nginx**, abaixo dos 435,7MB da TUKA →
   `413`. Subiu pra 600MB, espelhado em `MAX_UPLOAD_MB` no frontend, que agora
   recusa CEDO e com mensagem clara em vez de subir pra tomar 413 no meio.

Resultado depois dos três: TUKA TOYS **335 produtos em 25s** (era 26 sem IA).

**A falha deixou de ser silenciosa:** `extractProductsViaAI` devolve
`{ resultado, falha }` com motivo tipado, o engine propaga em
`avisoAiFallback` e `/conversao` mostra um toast de aviso. Sem isso o cliente
não tem como distinguir "IA rodou e o catálogo é ruim" de "a IA nem rodou".

### 14.6 `peakCpuPercent` do painel era inflado (corrigido 10/09/2026)

O painel chegou a exibir **18300,9% de CPU** num job — impossível numa VPS de 4
núcleos (teto físico 400%) — e isso levantou receio de estourar a política de
uso de CPU do provedor. Era bug de medição, não consumo real.

`psutil.Process.cpu_percent()` sem argumento divide o tempo de CPU consumido
pelo tempo de PAREDE desde a chamada anterior. O `_ResourceMonitor` media
imediatamente após a leitura de arme, então o denominador era de microssegundos
enquanto o numerador carrega a granularidade do clock tick do kernel (~10ms) —
e essa primeira amostra degenerada virava o "pico" do job inteiro.

Correção: esperar o intervalo ANTES de medir, e limitar ao teto físico
(`n_núcleos × 100`) como rede de segurança. Medição real do mesmo job via
`docker stats`: **pico 27%, média 2,2%**, load 0,11 num servidor de 4 núcleos.

### 14.7 `IMG-GEN` era o upload das fotos morrendo aos 180s (11/09/2026)

O 14.5 corrigiu o prazo do upload **só no caminho da IA**. O caminho das FOTOS
(`imageExtractionApi.ts`) ficou com o teto fixo de 180s, e o cliente passou a
receber "a captação de fotos não funcionou neste catálogo" (`IMG-GEN`) em
catálogo grande — enquanto o servidor estava perfeitamente saudável.

Evidência no Nginx (Dute Toys, 68MB, IP do Josef, 11/09/2026):

```
10:37:38  POST /process → 400          (upload cortado pelo navegador)
10:40:43  POST /process → 400          ← 3min04 depois (180s + backoff 3s)
10:43:51  POST /process → 400          ← 3min08          (180s + 6s)
10:47:04  POST /process → 400          ← 3min13          (180s + 12s)
10:50:28  POST /process → 400          ← 3min24          (180s + 24s)
```

A única tentativa que passou levou **242s** (10:24:34 → 10:28:36) e terminou em
`[CV] Total: 611 matches`, com o ZIP inteiro no Supabase. Ou seja: o arquivo
precisava de 242s e o navegador desistia aos 180s.

Correções:

- O prazo virou módulo próprio (`src/core/net/uploadTimeout.ts`) usado pelos
  **dois** caminhos — era a duplicação que deixava um corrigido e o outro não.
- Piso de banda de 300 → **120 KB/s**: os 242s medidos em 68MB dão ~288 KB/s
  reais, então o piso antigo prometia mais banda do que o cliente tem e o prazo
  calculado caía logo ABAIXO do tempo necessário.
- A retentativa agora ganha **+50% de prazo** a cada tentativa
  (`uploadTimeoutForAttempt`): repetir com o mesmo prazo que acabou de estourar
  é repetir a derrota — foram 16min gastos em 5 uploads natimortos.
- Novo código **`IMG-UPLOAD`** no classificador, com instrução de verdade pro
  cliente. Cair no genérico `IMG-GEN` foi o que escondeu a causa por dois dias.

### 14.8 Preço trocado/ausente: a IA lia o texto SEM a posição (11/09/2026)

Josef: "pegou alguns códigos errados", e a exportação do Dute acusava **68 de 89
produtos sem preço**. Não era alucinação do modelo — era informação destruída
antes de ele ver o texto.

`page.get_text()` devolve a página em ORDEM DE LEITURA. Num catálogo em grade
isso separa o preço do produto:

```
DT10032 / DT10019 / DT10020 / DT10021          ← os 4 códigos
EM BREVE / DISPONÍVEL / DISPONÍVEL / DISPONÍVEL ← os 4 selos, soltos
R$ 5,00 / R$ 5,50 / R$ 5,50                     ← os 3 preços, soltos
```

Nada nesse texto diz de quem é cada preço. A única informação que resolve — a
POSIÇÃO do selo na página — estava sendo jogada fora.

Correção: `page_text_for_ai()` (em `gemini_extractor.py`) anota cada trecho com
sua coordenada (`[x,y] conteúdo`), separando colunas por vão horizontal, e o
prompt ensina o modelo a usar isso. Custo: +69% de caracteres no texto; nenhum
passo a mais e nada pra o cliente configurar — a posição já está no PDF.

Medido com a **API real do Gemini** (págs 5-10 do catálogo do cliente):

| Catálogo | Texto puro | Com coordenada |
|---|---|---|
| Dute Toys | 12/24 preços | **24/24** |
| TUKA TOYS | 0/4 (todos trocados entre si) | **4/4** |
| FORTAL    | 24/24 | 24/24 (sem regressão) |

O caminho `extract_via_template` continua no texto puro de propósito: o regex
dele foi sintetizado nesse formato e ele tem porta de cobertura própria
(`TEMPLATE_MIN_COVERAGE`), que reprova o catálogo em grade e manda pro
text-chunked — que é o caminho corrigido aqui.

### 14.9 Catálogo sem produtos na camada de texto — FOLIA (11/09/2026)

Josef: *"esse da Folia aqui eu testei o PDF para pegar as imagens e ele não
capturou"*. A tela mostrou **18 produtos / 0 importados com sucesso / 18
erros** em 8min36.

Os 18 "códigos" eram `18, 19, 20, 30, 31, 32, 35…` — **os números de página**.
O PDF da FOLIA tem camada de texto, mas ela contém APENAS a marca d'água de
fundo ("FOLIA IMPORTS · UTILIDADES E BRINQUEDOS", ladrilhada) mais o número da
página. Código, nome e preço fazem parte da ARTE. O texto das páginas 5, 10 e
20 é byte a byte o mesmo. A IA não alucinou: não havia o que ler.

Pior: a Phase 0 analisou essa mesma marca d'água e gravou em cache um perfil
que definia *"código: número inteiro de 1 ou mais dígitos sozinho numa linha"*
— um perfil errado que contaminaria toda conversão futura da FOLIA. O arquivo
foi posto em quarentena no servidor
(`supplier_profiles/FOLIA_BRINQUEDOS.json.envenenado-20260911.bak`) e a Phase 0
agora se recusa a analisar catálogo sem texto útil.

**Detecção** (`camada_de_texto_inutil`): tira a moldura — linha presente em
≥60% das páginas — e mede em quantas páginas sobra SINAL de produto (um preço
ou um código). O critério NÃO pode ser volume de texto: o TUKA tem ~100 chars
úteis por página e extrai 335 produtos sem problema.

| Catálogo | Páginas com sinal | Rota |
|---|---|---|
| FOLIA | 0/45 (0%) | **visão** |
| FORTAL | 86/108 (80%) | texto |
| DUTE | 191/197 (97%) | texto |
| TUKA | 177/178 (99%) | texto |

O limite é 25% — bem longe dos dois lados.

**Extração** (`extract_with_vision_chunked`): renderiza a página e manda a
imagem pro mesmo prompt de sempre. Dois números foram medidos contra gabarito
lido à mão (pág 17, 9 produtos):

- **1 página por chamada, não 4.** Com 4 páginas juntas o modelo acertava os
  preços mas **inventava os códigos** (0/9: vinha `JRF-10.0161` no lugar de
  `JRF-10.0581`). Com 1 página, 8/9. Como as chamadas correm em paralelo, o
  wall-time não muda. E a página de origem deixa de ser palpite do modelo:
  numa chamada de página única ela é fato conhecido e o código a preenche.
- **160 DPI.** A 110 o modelo lia `JRF-10.3090` onde estava `JRF-10.1090` — um
  dígito e o produto vira outro. A 160 fecha 9/9; a 200 não melhora e só
  engorda o JPEG.

**Resultado ponta a ponta no catálogo real da FOLIA:**

```
ANTES:  18 produtos | 0 importados com sucesso | 18 erros | 8min36
ETAPA 1: 288 produtos | 288 com preço (100%)  | 43/45 págs | ~2min
```

**Imagem resolvida em 12/09:** como não existe texto do SKU para localizar no
PDF, a rota de visão passou a devolver também o centro visual de cada produto
em coordenadas normalizadas. O frontend preserva essa posição e o extrator de
imagens associa o SKU diretamente ao cartão visual mais próximo. Essa regra só
é ativada para Folia.

O número de cartões visuais da página também funciona como conferência. Se a
primeira leitura retornar menos códigos únicos que a quantidade de cartões, o
sistema relê apenas aquela página com a quantidade esperada e combina os SKUs
únicos, sem repetir o catálogo inteiro.

**Validação no arquivo real `Catálogo Folia Brinquedos - 20-07-2026.pdf`:**
**367 produtos únicos, 367 imagens associadas, 0 sem match e 0 imagens com lado
menor que 80px**. As páginas 9, 14, 32 e 40 acionaram a conferência seletiva;
produtos repetidos em mais de uma página continuaram únicos no resultado.
Publicado na Integrator pela PR #135 em 12/09/2026; o mesmo resultado foi
reconfirmado dentro do container novo após o deploy.

### 14.10 Imagem composta do Dute — um produto em vários objetos (12/09/2026)

Josef: *"capturou um elemento só da imagem em vários casos"*. O PDF real do
Dute monta a foto comercial com objetos independentes: embalagem, brinquedo,
acessórios e, às vezes, variações. `_match_via_grid` escolhia a imagem de
centro Y mais próximo do SKU e só acrescentava outra quando a diferença entre
centros era menor que 15pt. Em composições altas, isso salvava um fragmento de
39×59 ou 44×68px em vez do conjunto.

**Correção em `cv_extractor.py`:** quando `supplier_id` identifica Dute Toys,
os códigos e as linhas detectadas no PDF formam células lógicas. Cada elemento
é atribuído à célula e o arquivo final usa o retângulo que reúne todos os
elementos daquele produto. O caminho dos demais fornecedores não mudou.

O catálogo alterna três desenhos, todos medidos no arquivo real:

- grade comum: divide as linhas primeiro e depois as colunas;
- triângulo (1 em cima + 2 embaixo, ou inverso): cada linha calcula suas
  próprias colunas;
- blocos laterais desencontrados: quando não há dois SKUs na mesma linha,
  divide as colunas primeiro para não cortar uma composição alta.

Na página 142, uma imagem muito grande contém duas variações e faz os objetos
menores parecerem selos sobrepostos. O fallback reabre apenas células Dute que
ficaram vazias com a lista original de elementos; produtos já associados não
são recalculados.

**Validação real:** os 651 códigos foram localizados nas 190 páginas úteis.
Resultado novo: **651/651 imagens, 0 sem match, 0 imagens com lado menor que
80px, 25,4s** na Integrator. Resultado anterior: 611 imagens, com fragmentos
minúsculos. O teste `test_dute_composition.py` trava as geometrias reais das
páginas 11, 12, 95, 116 e 142 e também confirma que outro fornecedor continua
no algoritmo anterior.

### 14.11 Fortal — total da caixa no lugar do preço unitário (12/09/2026)

Josef: *"quando tem o valor da caixa e a unidade, ele tá pegando o valor da
caixa. Aí pra nós precisa ser unidade sempre"*. No catálogo real, alguns
cartões mostram dois valores no mesmo bloco:

```
BDZ-2523
UND: R$ 7,20
R$ 72,00
```

O prompt foi reforçado para priorizar `UND:`, mas a garantia não depende só da
IA. Depois da extração, `_fix_fortal_unit_prices` abre o texto posicionado do
PDF, encontra o SKU e escolhe a linha `UND:` logo abaixo, na mesma coluna. A
regra roda apenas quando o fornecedor é Fortal; se a linha não existir ou a
geometria não for segura, mantém o preço original.

**Validação no resultado real:** 949 produtos; 82 tinham rótulo `UND:`
explícito; **81 valores que estavam como total da caixa foram corrigidos**.
Exemplos: `BDZ-2523`, `BDZ-2524`, `BDZ-2525` e `BDZ-2526`, todos de `72,00`
para `7,20`. Os demais produtos, com preço único, permaneceram inalterados.
Publicado na Integrator pela PR #135 em 12/09/2026 e reconfirmado no container
novo com o resultado real armazenado.

---

### 14.12 Folia: preço/specs impressos DENTRO da foto (15/09/2026)

Depois do #14.9 (que resolveu o casamento foto↔SKU) e do #14.11 (Fortal), o
Josef testou de novo e achou um problema novo, específico da Folia: *"as
imagens estão capturando valor também, não pode. Precisa ser somente a imagem
pra não ter divergência nas alterações de preço"*.

Cada card da Folia é **uma única imagem rasterizada** (ver #14.9 — não existe
texto/preço via PDF por cima, é tudo a mesma arte). O card inteiro — logo,
foto, nome/specs, preço — é UM xref só, então não dá pra excluir a faixa de
preço mantendo só o xref da foto; é preciso recortar o PIXEL certo dentro da
própria imagem.

`_crop_folia_price_band()` (`cv_extractor.py`) acha a faixa de baixo pela cor
navy que ela compartilha com a borda do card (medida na própria imagem, nunca
fixada em RGB), varrendo de CIMA pra BAIXO a partir do meio do card até achar
a transição nítida onde a linha vira quase 100% navy — a aresta de cima da
faixa é sempre reta, então 2 linhas seguidas acima de 85% de navy bastam.

**Por que de cima pra baixo, e não o inverso:** a primeira versão testada
procurava o FIM da faixa varrendo de baixo pra cima, e quebrou num card real
(`JRF-10.1091`, "BRINQUEDO MUSICAL EDUCATIVO", 3 fileiras de foto) — o nome
largo cria, DENTRO da própria faixa, várias linhas de texto branco com pouca
fração de navy, e a varredura de baixo confundia isso com "a foto recomeçou",
cortando tarde e deixando texto visível. A aresta de cima não sofre disso.
Só olha a metade ESQUERDA de cada linha — a etiqueta de preço (clara) fica na
direita e dilui a fração de navy da própria linha da faixa se entrar na conta.

**Validado contra os 298 cards do catálogo real** (as 45 páginas inteiras):
298/298 cortados, 0 com navy residual, 0 caindo no plano de segurança (devolver
a imagem original sem corte quando a faixa não é encontrada numa proporção
plausível). Faixa de corte convergiu pra 83.8%-84.0% da altura em todos.

---

### 14.13 Dute: preço/produto vizinho vazando na composição por união (16/09/2026)

Josef reportou o mesmo sintoma do #14.12, agora no Dute: *"as imagens estão
capturando valor também"*. A causa é DIFERENTE — o Dute não usa card único
como a Folia; `_match_dute_compositions()` (ver #14.6) monta a foto de cada
produto unindo vários objetos de imagem do PDF (embalagem + brinquedo +
acessórios) num retângulo só, e recortava o RASTER da página dentro desse
retângulo — ou seja, qualquer coisa que a página desenhasse ali (inclusive
texto de preço/título que não é imagem nenhuma) saía junto.

**Causa raiz nº 1 — espaço morto na diagonal.** Quando as duas fotos do
produto ficam posicionadas na diagonal (uma embaixo-esquerda, outra
em-cima-direita, por exemplo), o retângulo que as envolve sobra espaço morto
no canto oposto (o outro canto da diagonal). É exatamente ali, na maioria dos
casos, que o preço e o título do produto — texto real da página, desenhado
fora de qualquer imagem — aparecem. `DTY1364` (pág. 171): a foto do brinquedo
fica em cima-direita, a da embalagem embaixo-esquerda; "R$ 4,00" e o nome do
produto ficavam no canto superior-esquerdo do retângulo união, que não
pertence a nenhuma das duas fotos.

**Causa raiz nº 2 — retângulo de imagem deformado (achada só validando o
catálogo INTEIRO, mais grave).** A página 34 (coleção "livro sensorial") tem
imagens cujo retângulo de exibição declarado no PDF é MUITO maior que a
própria página, chegando a começar em coordenada negativa (ex.:
`Rect(-472.67, 355.72, 276.75, 923.19)` numa página de 855×595pt) — resultado
de uma transformação de rotação/escala malformada na origem do PDF. Ao entrar
na união com as demais imagens do produto, esse retângulo gigante engolia o
produto VIZINHO inteiro — `DT10235` saía com o card completo de `DT10237` do
lado (preço, título, specs e tudo) dentro da própria foto.

**Fix, duas partes (`cv_extractor.py`):**

- `_crop_composition_masked()` substitui o recorte cru do raster: continua
  cortando a união (mantém a posição relativa das fotos), mas pinta de
  BRANCO todo pixel que não cai dentro do retângulo de pelo menos uma das
  imagens agrupadas. O texto que sobrava no espaço morto desaparece; o
  conteúdo de cada foto real fica intacto.
- `_filtrar_imagens_fora_da_pagina()` descarta, antes de qualquer
  agrupamento, candidatas cujo retângulo fica menos de 80% dentro dos limites
  da página — pega exatamente o padrão da causa nº 2. **Sem** a rede de
  segurança "devolve a lista original se filtrar tudo" (padrão usado em
  `_descartar_selos`): a página 34, depois do filtro de selo, só tinha
  restado essas imagens deformadas — uma rede de segurança aqui devolveria
  de volta exatamente as imagens que causam o vazamento. Perder a foto (SKU
  cai no relatório de não-casados, mecanismo que já existe) é preferível a
  devolver o preço do vizinho.

Threshold calibrado contra o catálogo real: as imagens deformadas medem
24%-70% dentro da página; a única foto legítima que sangra a borda de
propósito (`DTY1109`, pág. 152, efeito de design) mede 89% — 80% deixa folga
dos dois lados sem descartar nenhuma foto de verdade.

**Validado contra os 649 SKUs do catálogo real** (as 190 páginas com produto):
649/649 casados, 0 sem imagem, 0 caso 100%-branco (máscara zerada por bug), 0
composição com <5% de conteúdo não-branco (sinal de sobra-quase-tudo-cortado).

**Achado durante a validação, não corrigido:** ~10% das composições cujo
produto fica na última linha de uma página têm a foto genuinamente colada na
faixa de navegação de categorias do rodapé (ex.: `DT10371` pág. 6) — isso não
é texto solto no espaço morto, é a própria foto do produto que se estende até
ali, então a máscara (corretamente) preserva. Testei um detector de rodapé
por cor de pixel (fração de pixels não-brancos cai a quase 0% e depois salta
pra >70% numa faixa cheia de largura — sinal muito consistente, 539-540pt em
27 de 29 páginas de amostra), mas achou 1 falso-positivo real (pág. 162,
disparou em y=452 sem nenhum rodapé ali) — não confiável o bastante pra
arriscar cortar foto de produto de verdade sem mais tempo de calibração. Ver
"O que está aberto" em `CLAUDE.md`.

---

### 14.14 Layout MEDIDO, não assumido (16/09/2026) — PETRIN, LEVIVAN, FORTAL

Princípio que passou a valer para o casamento de imagem: **o que varia entre
fornecedores é medido no próprio arquivo, não declarado num `if`.** Antes,
cada catálogo novo virava um ramo (`_is_dute_supplier`, `_is_folia_supplier`,
`supplierName.includes('DAGIA')`), e o que já funcionava quebrava quando a
premissa embutida não batia com o próximo layout.

**Orientação da foto (`_detectar_orientacao_do_catalogo`).** O casamento por
coluna assumia "foto em cima, código/legenda embaixo". A PETRIN inverte:
código + nome + specs no topo do bloco e a foto embaixo. Com a regra fixa, 142
SKUs ficavam sem imagem (a foto legítima caía no corte `dy < -100`) e outros
pegavam o enfeite que por acaso estava logo ACIMA do código — o RD1193 saiu
com o selo "PREÇO REDUZIDO", que fica a **1,9pt** acima do código.

A orientação é decidida por catálogo: em cada página monta-se a atribuição 1:1
SKU↔foto sob as duas hipóteses e vence a que explica MAIS SKUs (custo só
desempata). Só as K maiores imagens votam (K = qtd de códigos da página), o que
tira selos e enfeites da votação sem precisar reconhecê-los. Exige ≥3 páginas
decididas e 60% de maioria; na dúvida devolve "acima", o comportamento
histórico. Medido: PETRIN 135 de 170 páginas dizem ABAIXO; LEVIVAN 23 de 23
dizem ACIMA (ou seja, catálogo que já funciona não muda de caminho).

Quando a orientação é "abaixo", a distância passa a ser medida pela **borda de
cima da imagem**, não pelo centro, e a foto precisa COMEÇAR depois do código.
Medir por centro deixava o selo (18pt acima) ganhar da foto certa (226pt
abaixo) só por estar mais perto em valor absoluto.

**Piso de tamanho pra ser foto de produto.** O cromo do template (selo, botão
"VÍDEO", enfeite de cabeçalho) é sempre pequeno perto da foto real da MESMA
página, e `_descartar_selos` não o pega porque ele não encosta em nenhuma foto
maior. Piso = 22% da mediana das N maiores imagens da página (N = qtd de SKUs).
Há 2ª passada sem piso: se nada plausível casar, reabre tudo — nenhum SKU perde
imagem por causa do filtro.

**Fatias contíguas (`_costurar_tiles`).** Alguns exportadores cortam uma foto
em tiras lado a lado; cada tira vira um objeto separado e só uma era salva (o
"LEVIVAN ta pegando só parte do produto", LV1052). Assinatura puramente
geométrica: mesma faixa vertical (±2pt) e bordas encostadas (<3pt). Duas fotos
de produtos diferentes nunca se encostam assim — num layout de duas colunas há
sempre dezenas de pontos de vão. A ordem em que o PDF lista as fatias não é
confiável, então a adjacência é testada dos DOIS lados da faixa já montada.

**Tamanho de fonte chega até a IA.** `page_text_for_ai` entregava só
`[x,y] conteúdo` — tamanho e negrito eram descartados. Sem esse sinal, só a
posição separava código de nome, e a posição engana quando o nome quebra em
duas linhas logo acima do código: a última palavra cai exatamente no slot do
código (FORTAL, "RELÓGIO DE PAREDE ROSE" / "GOLD" / "726"). Agora o trecho em
fonte maior que o corpo da página sai marcado com `**`. A/B contra a API real,
2 rodadas em chunk de 6 páginas: no formato antigo o código `36-30` some e vira
o produto fantasma `MULTIUSO`; no novo sai correto. Regressão zero em TUKA,
LEVIVAN e PETRIN (mesmos códigos, mesmos preços). 26% dos cards da FORTAL têm
nome em 2+ linhas, ou seja, estavam expostos ao mesmo erro.

**Resultado medido nos catálogos reais inteiros:** PETRIN 142 → **48** SKUs sem
imagem (798 SKUs); LEVIVAN **73/73** com imagem.

---

### 14.15 Mapeamento estrutural — FOLIA (promo), VAESO (corrida) e o que NÃO virou fix (16/09/2026)

Pedido do Gabriel após a retestagem do Josef: "faça um mapeamento estrutural
pra identificar exatamente onde o sistema tem quebrado... sem atirar no
escuro". Cinco relatos, cinco investigações — duas viraram fix (#145), duas
ficaram documentadas como "medido, sem causa confirmada" de propósito.

**FOLIA — preço PROMOCIONAL em coluna própria (virou fix).** O adapter já
mapeava `precoPromocional` (coluna PROMO, separada da TABELA) desde sempre,
mas o extrator genérico (`extractor.ts`) só usava `preco` — o valor promo
ficava gravado no produto e NUNCA decidia o preço exportado. 63 de 64
produtos com promoção saíam com o preço cheio. Não era bug só da FOLIA:
PETRIN, LEVIVAN, DUTE e DAGIA declaram o mesmo alias `precoPromocional` e
tinham a mesma lacuna, silenciosa até um catálogo real ter os dois preços
preenchidos ao mesmo tempo. Fix: quando `precoPromocional > 0` E menor que
`preco`, vira o preço efetivo (mesmo tratamento de bloqueio de desconto já
usado pra tag de promoção via IA). A guarda "menor que" é o que impede a
mesma mudança de quebrar a NEO FESTAS, que reusa o nome do campo pra preço
de CAIXA/KIT — sempre maior que o unitário, semântica oposta a desconto.

**VAESO — corrida "última gravação vence" (virou fix).** Detalhe em
`CLAUDE.md` (tabela de PRs, #145) e no código de
`FornecedoresContext.salvarMapeamentoColuna`. Resumo: 3 seleções de tabela de
preço extra disparadas em sequência rápida liam o mesmo `columnMappings`
desatualizado (só atualiza depois do round-trip do Supabase) e a gravação
mais lenta a resolver vencia, apagando as outras duas. Corrigido com merge
síncrono num `ref` (nunca lê estado desatualizado, mesmo com escrita ainda em
voo) + fila de gravação por fornecedor.

**GIRA — 3 produtos de nome idêntico com preço trocado (investigado, SEM
fix).** "KIT 6 PORTA-COPOS BAMBU" (GU0132/TP1679/TP2003) saiu com os preços
girados entre si. Busca extensa por qualquer mecanismo do pipeline que
agrupe/troque dado por DESCRIÇÃO (em vez de código) não achou nada: o
adapter GIRA é 100% genérico (sem `extract`/`postProcess` custom), código +
nome + preço vêm sempre da MESMA linha da planilha, a dedup exige código na
chave (aqui os 3 códigos são diferentes — nunca colidem), e as rotas de IA
(AI-first, reparo cirúrgico de preço) são gated por `isPdfFile`/`isPdf` —
GIRA é Excel, nunca entram. Hipótese mais provável: célula mesclada ou
copiada errada na planilha de ORIGEM do próprio fornecedor (não confirmável
sem o arquivo real). Deliberadamente NÃO virou fix — mudar código sem causa
confirmada seria exatamente o "atirar no escuro" que este mapeamento existe
pra evitar.

**FOLIA — 331 fotos reais vs. 288 extraídas (investigado, SEM fix).** Medido
direto no PDF real (`Catálogo Folia Brinquedos - 20-07-2026.pdf`, 55
páginas): a grade visual (`_folia_card_candidates`) encontra **377**
candidatos a card — MAIS que os 331 que o Josef contou à mão, o que já
descarta cap numérico ou dedup agressivo apagando foto real (conferido:
nenhum limite de imagens por catálogo existe, só limite de PÁGINAS, que
falha o job inteiro com erro explícito, não produz pasta parcial). Testado
também: rodar o filtro de logo/cabeçalho (`_detect_logo_xrefs`) contra o
arquivo real remove exatamente as mesmas 377 imagens com ou sem o filtro —
ele não está confundindo foto de produto reaproveitada com logo, pelo menos
não neste arquivo. Toda página com contagem de card "estranha" (1, 2, 5, 7,
8 em vez de múltiplo de 3) foi inspecionada uma por uma: são todas última
linha de grade incompleta (produto real, coordenadas normais) — nenhuma
tem cara de falso positivo. Sobra como suspeito mais provável a trava
"tudo ou nada" por página em `_assign_folia_card_positions` (linha 574: se
a página tiver menos cards confiáveis que SKUs esperados, NENHUM SKU da
página recebe coordenada — não só o excedente) e/ou a etapa de visão via IA
(`extract_with_vision_chunked`, que já tenta se autocorrigir por página
comparando contagem esperada vs. detectada, mas não foi rodada ao vivo
contra a API real nesta investigação por custo/tempo). **Não confirmável
sem o relatório real de "SKUs sem imagem"** dessa conversão específica —
pedido ao Josef antes de mexer em código de novo.

---

### 14.16 Os dados já estavam no servidor — correção do #14.15 (16/09/2026)

Gabriel, depois do #14.15: *"esses dados que deram problemas... deveriam
estar registrados ali no painel e a gente conseguir identificar as
informações com esses logs pra fazer as correções... senão continua não
sendo uma ferramenta eficiente."* Ele estava certo, e a prova veio na hora:
os dois itens que o #14.15 deixou como "sem causa confirmada, precisa pedir
arquivo ao Josef" foram resolvidos **sem pedir nada a ninguém**, só lendo o
que o próprio servidor já tinha gravado.

**Como**: cada job (imagem ou IA) grava `status.json` em
`/opt/converter-pro/data/temp/<jobId>/` — inclusive o PDF de entrada, que
fica 21 dias. `ssh` na Integrator + `docker exec ... python3 -` (o mesmo
truque de base64 já documentado, já que `docker cp` não funciona nesse host)
foi o suficiente pra buscar o job certo por conteúdo (grep por SKU/nome no
JSON) e ler o resultado exato que o Josef viu.

**GIRA — a conclusão do #14.15 estava ERRADA.** Achei o job de produção real
(`aifirst_343096c7...`) e o resultado gravado tinha os 3 produtos EXATAMENTE
como o Josef reportou:

```
GU0132  KIT 6 PORTA-COPOS BAMBU  R$ 8,45  (correto: 6,95)
TP1679  KIT 6 PORTA-COPOS BAMBU  R$ 5,45  (correto: 8,45)
TP2003  KIT 6 PORTA-COPOS BAMBU  R$ 6,95  (correto: 5,45)
```

Rotação perfeita: GU0132 pegou o preço do TP1679, que pegou o do TP2003, que
pegou o do GU0132. Bug REAL na extração via IA — o modelo do job era
`gemini-2.5-flash (text-chunked)`, ou seja, esse catálogo Utilidades foi lido
como PDF/texto pela IA, não pelo adapter Excel genérico que o #14.15
investigou (a hipótese de dedup/planilha nunca poderia ter sido a causa,
porque esse caminho nem roda pra esse arquivo). Fix no #148: regra explícita
no prompt sobre nome duplicado no mesmo lote + `_marcar_nomes_duplicados`,
que sinaliza esses grupos no resultado do job (mitigação de prompt não
garante 100%, então fica registrado pra auditoria).

**FOLIA — a hipótese do #14.15 era plausível mas a causa real era outra.**
Achei os dois jobs de produção reais (mesma PDF, rodada em 15/09 e 16/09) e
comparei, página por página, a contagem MEDIDA de cards (mesma função
`_folia_card_candidates` de sempre) contra os produtos que a IA retornou:
bateram em 43 das 45 páginas nos DOIS jobs. A única divergência real foi a
página 39 — no job de 16/09 voltou **0 produtos** numa página com 9 cards
legítimos (conferido visualmente: 9 "KIT BELEZA" perfeitamente legíveis,
nada de estranho no layout). Reprocessei essa MESMA página contra a API real
agora e veio 9/9 correto; o job de 15/09 (rodado noutro dia, mesma página)
também veio 9/9. Ou seja: foi uma falha PONTUAL da chamada à IA naquele
momento específico (rate limit, timeout, resposta malformada — não dá pra
saber qual sem o log daquele instante, que já girou do buffer de 1000
linhas), não um defeito determinístico de código. Nada pra corrigir aqui.

**O que vira prática permanente**: todo job passou a gravar `supplier` no
`status.json` (antes só existiam contadores — achar o job certo exigia
adivinhar por padrão de SKU) e o `/admin/dashboard` mostra fornecedor +
aviso de nome duplicado direto na tabela. **Da próxima vez que o Josef
reportar um erro, o primeiro passo é `ssh` + olhar o job real — só pedir
arquivo novo se isso não bastar.**

---

### 14.17 BM36: nome trocado com o produto vizinho no `template-synth` (18/09/2026)

Retestagem do Josef achou o BM36 quase inteiro quebrado: nome cortado/errado
em 13/13 códigos testados e foto trocada em 21/21 — o pior resultado de
qualquer fornecedor até aqui. Medido no job real de produção (`ssh` +
`status.json`, mesmo catálogo que o Josef testou): o nome vinha do caminho
`extract_via_template` ("template-synth"), não do AI-first text-chunked que
o `## 14.8`/gate de nome deveriam garantir para esse layout — o gate de
`extract_via_template` só verifica se o campo `nome` veio PREENCHIDO, não se
o CONTEÚDO está certo, e nesse catálogo ele vinha preenchido com o texto
ERRADO.

**Causa raiz nº 1 — fatia de bloco unidirecional.** `_apply_template` fatiava
o bloco de cada produto do início do match de CODE (`CD: BM######`) até o
PRÓXIMO CODE. No BM36 o layout é NOME (com o próprio SKU repetido no fim da
linha) → `CD: <EAN13>` → `CD: BM######` → `CX:` → preço — ou seja, o nome do
produto atual fica ANTES do match de CODE, não depois. O bloco fatiado assim
continha só o preço/qtd do produto atual + o NOME do produto SEGUINTE, então
todo nome saía deslocado em um.

**Causa raiz nº 2 — classe de caractere restrita.** A IA sintetiza a classe
de caracteres do grupo de captura do NOME olhando a amostra (ex.:
`[A-Z0-9\s.,-]`), e nomes reais em português têm acento e minúscula que essa
classe não cobre (`PÉS`, `-15cm`) — truncando o nome mesmo quando o bloco
está certo.

**Fix (`_apply_template`, `gemini_extractor.py`):** busca BIDIRECIONAL — a
janela de busca do nome vai do fim do CODE anterior até o início do PRÓXIMO
(cobre os dois layouts, nome antes ou depois do código), e entre os matches
dentro dela fica o mais PRÓXIMO da posição do código atual. `_widen_nome_capture`
substitui o conteúdo do grupo de captura do nome por `[^\n]+` (qualquer
caractere menos quebra de linha) mantendo as âncoras que a IA escreveu —
a âncora já delimita onde o nome termina, a classe de caracteres do meio só
atrapalha. PRECO/QTD não mudaram (continuam no bloco pra frente, onde já
funcionavam). Sem `if fornecedor == BM36`: a mudança é no motor genérico do
`template-synth`, vale para qualquer fornecedor futuro com esse layout.

**Validado contra o catálogo real inteiro** (140 páginas, baixado do
servidor): 1188 produtos após dedup — bate exatamente com a contagem que o
Josef reportou ("de 1.188 do catálogo") — 99,3% com nome, 0 nomes truncados
abaixo de 8 caracteres, `BM361552` sai `"FACA PATE C/4 -15cm DOURADO"`
(igual ao que o Josef esperava). Teste de regressão em
`test_bm36_nome_shift.py` trava o texto real da página 4 e confirma que o
layout padrão (nome DEPOIS do código) não quebrou.

**Ainda aberto no BM36:** a foto trocada (21/21 na amostra do Josef, sinal
de bug sistêmico na estratégia Embedded de `cv_extractor.py`, provavelmente
o `score()` por Y-proximidade não discrimina bem produtos lado a lado na
mesma linha) e os 137/1188 produtos que não aparecem na exportação —
investigação em andamento, não confirmado ainda se são o mesmo problema.

---

### 14.18 Preço conferido pela geometria da página — Petrin e afins (18/09/2026)

Josef, Petrin: 10 preços errados (2 códigos com os preços trocados entre si) e
o RD1557 (46,00) sumindo da exportação enquanto o RD1558 ("EM BREVE") saía com
o preço dele. Medido no job real de produção: os 12 casos batem exatamente com
o que a IA devolveu — o erro é da atribuição de preço, não do frontend.

Padrão medido no catálogo inteiro (800 produtos): num layout de 2 colunas, se o
código da esquerda é "EM BREVE" (sem preço impresso), a IA passa o preço da
coluna da direita pro código da esquerda e deixa o dono sem. **62 preços
errados no total; o Josef pegou 12.** A informação pra acertar está no PDF —
o preço de cada produto fica sempre na mesma posição relativa ao seu código
(Petrin: ~111pt à direita, ~10pt acima).

**`_verify_prices_by_geometry` (`gemini_extractor.py`, chamado em
`extract_with_fallback`, vale pra qualquer fornecedor — sem `if` por nome):**
1. MEDE a assinatura de posição do catálogo: entre os produtos cujo preço da IA
   coincide com um preço impresso na página, mediana do deslocamento (dx,dy)
   código→preço. Só confere se ≥85% dos casos concordam (≥30 produtos).
2. Corrige só quando é inequívoco: exatamente UM preço na região do card e
   ninguém mais disputando; um código sem preço na própria região cujo preço da
   IA é o da região de OUTRO código fica sem preço (era "roubado").
3. Falha segura (qualquer erro → preços da IA intactos). Cada correção fica
   registrada em `avisosPrecoCorrigido` no resultado do job (auditável).

**Regressão medida nos catálogos reais de produção (pegou um erro meu):**
a 1ª versão desfazia o fix do preço unitário da Fortal em 105 produtos
(`UND: R$ 7,20` ao lado do total `R$ 72,00` — dois preços no mesmo card).
Agora card com 2+ preços é ambíguo e não é tocado. Resultado final:

| Catálogo | Assinatura | Mudanças |
|---|---|---|
| PETRIN (800) | dx +111, dy −10 (89%) | **62 corrigidas — os 12 do Josef, 12/12** (conferidas à mão as páginas 3, 78, 120, 163) |
| FORTAL (943) | dx +43, dy +67 (89%) | 6 — todas o preço do card vizinho da esquerda (conferido: ENS-01 tem só `R$ 32,40`, a IA tinha 7,20) |
| DUTE (651) | dx +4, dy −32 (100%) | 0 — a IA já estava certa |
| DAGIA, GIRA, FOLIA | sem padrão / não usa "R$" no texto | 0 — não confere, não toca |

Teste: `test_price_geometry.py` (troca entre vizinhos, preço roubado, card de 2
preços, layout agrupado, falha segura).

**Por que isto e não um ajuste de prompt pra Petrin:** é a mesma classe de
erro que apareceu na GIRA (#148, prompt não garantiu) — prompt é probabilístico,
posição é determinística. Como o padrão é medido no arquivo, o próximo
fornecedor com preço posicionado ganha a conferência sem ninguém configurar.

---

### 14.19 Linha de total não derruba produto com código — Dute 31 sumindo + foto vazando (18/09/2026)

Josef, Dute: 31 códigos ativos, com preço, não saíam na exportação; o DTY0730
saía com a foto do caranguejo do vizinho.

**Medido (não achado por hipótese):** o resultado da IA no servidor tinha os
651 produtos e os 31 códigos, todos com preço. O pipeline do frontend
(`runImportPipeline`) devolvia 614: os 37 que sumiam (31 do Josef + 6) eram
os mesmos SEM foto no ZIP, porque nem chegavam ao extrator de imagens
(`unmatchedCount 0`). Reproduzido sem o Josef, rodando o pipeline sobre o
JSON real da Dute.

- **Causa 1 (produto some):** `shouldExclude` (`supplierRules/extractor.ts`)
  aplicava regra de texto livre contra a linha INTEIRA do produto. A regra
  `total|subtotal|soma` (sem âncora, copiada em Dute/Petrin/Levivan) casava com
  "(Total 144 UND)" na observação de caixa. **Fix genérico:** linha com código
  de produto não é total/rodapé — a regra de texto livre passa a valer só
  contra o próprio código. Linha sem código e código literalmente "TOTAL"
  continuam excluídos. Vale pra qualquer fornecedor novo. Teste:
  `exclusion-com-codigo.test.ts`. Resultado: Dute 614 → **651/651**.
- **Causa 2 (foto vazando, DTY0730):** `_match_dute_compositions`
  (`cv_extractor.py`) partia as colunas de cada linha só com os SKUs DA
  LINHA. Linha com 1 produto (coluna direita) ganhava a página inteira e
  engolia a parte de baixo da foto da coluna esquerda. **Fix:** se as colunas da
  página são consistentes (nº de colunas globais == nº da linha mais cheia), a
  linha curta usa a faixa da própria coluna. Página em triângulo (1 centralizado
  + 2) tem mais colunas globais e não entra na regra. Teste: pág. 162 em
  `test_dute_composition.py`.
- **Medido no catálogo real inteiro (mini teste como fornecedor novo):** 651
  fotos associadas, 0 sem foto (eram 614); 24 fotos mudaram, todas encolhendo
  (vizinho removido); amostra de 8 conferida visualmente, nenhuma piorou.
- **Ainda aberto:** o backend reportava `unmatchedCount 0` mesmo quando o
  frontend não mandava o SKU — produto que nunca chega ao extrator não aparece
  no relatório de falhas.

---

### 14.20 BM36 — os "137 que não aparecem na exportação" eram nome vazio (18/09/2026)

Josef: "137 produtos que nem aparecem na exportação (de 1.188)". Medido, sem
suposição: extração 1188, pipeline do frontend 1188 e ZIP de imagens 1187 — o
que cortava era o export Mercos (`batchNormalizeToMercos`), que descarta
produto sem nome. Reproduzido exato: **137 inválidos, todos com `nome` vazio**.

- **Causa:** o template-synth (regex de NOME que a IA sintetiza) não casava em
  parte dos blocos. O #153 (nome deslocado) já derrubou os vazios de 136 para
  9; sobravam dois layouts do mesmo catálogo: código sozinho numa linha (pág.
  71) e bloco sem a linha de EAN de 13 dígitos (pág. 92).
- **Fix genérico (`_nome_linha_anterior`, em `_apply_template`):** só para
  produto que ficaria SEM nome, usa a última linha de texto antes do código,
  ignorando linhas que casam CODE/PREÇO/QTD do template, "rótulo: número"
  (EAN), número de página e o próprio código. Nenhum nome que já existia
  mudou (comparado no catálogo inteiro: 0 alterados, 0 vazios).
- **Teste:** páginas 71 e 92 reais em `test_bm36_nome_shift.py`.
- **Lição de método:** o relatório de erro do sistema mostrava esses 137 o
  tempo todo; a causa (nome vazio) só apareceu rodando o export inteiro sobre
  o JSON real do servidor.

---

### 14.21 Foto principal pela CÉLULA do produto — Petrin (18/09/2026)

Josef, Petrin: 9 fotos trocadas com o vizinho (RD1748 com a do RD1445, etc.).
**Medido:** em catálogo com foto ABAIXO do código, `_match_via_columns` agrupava
imagens pela coluna de X do centro. A foto principal larga/longe em X (garrafa
do RD1748, x=518, código em x=337) caía noutra coluna, e o SKU levava o detalhe
mais perto (o círculo de zoom). Outra falha: foto que COMEÇA acima do código
(manteigueira RD1543) era descartada pelo corte `gap < -20`.

**Fix genérico (`_foto_principal_da_celula`, só na orientação "abaixo"):** o
bloco do produto vai do código até o próximo código abaixo (mesma faixa) e, na
horizontal, até o código vizinho da mesma linha; a foto é a MAIOR imagem com
centro no bloco. Bloco vazio cai no caminho antigo. Sem regra por fornecedor.

**Medido na Petrin inteira (800 SKUs):** sem imagem 47 → **14**; os 9 códigos do
Josef conferidos olhando as fotos. Catálogos "acima" (Levivan etc.) não passam
por esse caminho. **Ressalva:** 343 SKUs mudaram de foto (a maior parte
corrige vizinho/detalhe; alguns passam a pegar a variante ou uma composição
com fundo) — Josef reconfirma numa amostra.
- **Teste:** geometria real das págs. 6 e 11 em `test_foto_celula_abaixo.py`.

---

### 14.22 Foto do cartão de baixo ganhava da do próprio cartão — BM36 (18/09/2026)

Josef, BM36: "21 de 21 códigos com foto de outro produto" (WC409917 elefante com
foto de abacaxi, WC409929 abacaxi com dog, WC409934 dog com elefante; WC409582 e
WC409723 trocados entre si). **Correção de rumo:** em 18/09 concluí que era só o
nome do vizinho; estava errado — amostrei fotos onde o layout não estressa o
casamento. Reproduzido com os códigos exatos do Josef, na página 84 real.

**Causa (medida):** no layout "foto acima do código", a foto do cartão tem o
código 42pt abaixo dela, e a foto do cartão SEGUINTE começa 22pt depois do código.
A distância era `abs(cy_do_codigo - cy_da_foto)`, então a foto de baixo (66pt) ganhava
da certa (92pt) — rodízio em toda coluna. Nas páginas com legenda a 15pt (a maioria)
a FASE 1.6 já resolvia; aqui o vão de 42pt passa do limite dela.

**Fix genérico:** foto que COMEÇA depois do código (`rect.y0 > y_codigo + 2`) recebe
penalidade e só vale se nenhuma foto acima/sobreposta ao código casar (balões que
sobrepõem a foto, como no NIX, não são afetados).

**Medido:** os 5 códigos do Josef corretos; BM36 inteira 30 de 1187 fotos mudaram;
Dagia 0 e Fortal 0 mudanças (939 fotos). Teste com a geometria real: `test_foto_acima_proxima.py`
(falha sem o fix, reproduzindo o rodízio exato).

---

### 14.23 GIRA — conferência de preço por geometria em catálogo sem "R$" (18/09/2026)

Josef: os 3 "KIT 6 PORTA-COPOS BAMBU" (GU0132/TP1679/TP2003) voltaram a sair com
os preços em rodízio (o #148 foi só mitigação de prompt). **Medido no PDF real:**
o texto dá GU0132 = 6,95, TP1679 = 8,45, TP2003 = 5,45; a IA devolveu 8,45 / 5,45 /
6,95. O #154 já tinha a solução geral (mede a posição código→preço e corrige o
inequívoco), mas `_page_price_tokens` só reconhecia "R$ 12,80" — a GIRA imprime o
preço solto no fim da linha ("10cm  CX50  6,95"), então nenhum token existia
("0 preços casados") e a conferência nunca rodava.

**Fix genérico:** quando a página não tem NENHUM "R$", o token de preço passa a ser
o último número com 2 casas no fim da linha (dimensão "13,5*34cm" e "1,5x2,5" não
casam). Com "R$" na página o comportamento é idêntico ao anterior. A trava de
assinatura (≥85% consistente, ≥30 produtos) continua protegendo layouts sem padrão.

**Medido:** GIRA assinatura dx=+7 dy=+11 (95% de 175 casos) → 6 preços corrigidos: os
3 do Josef + TP1636 (5,96→7,45), TP1875 (6,76→8,45), TP1560 (3,84→4,80), os 6
conferidos no texto do PDF. Dagia, Dute e Folia 0 mudanças; Fortal os mesmos 6 de
antes. Teste: `test_price_geometry_sem_rs.py`.

---

### 14.24 VAESO — tabelas de preço extra perdidas entre a conversão e a exportação (18/09/2026)

Josef: reconfigurou as 3 tabelas (V50, V250, V.R.), a tela mostrou as 3, e "nenhuma
das 178 linhas trouxe elas" na exportação. O #145 (corrida ao salvar o mapeamento)
era real mas não era esta causa.

**Medido:** o pipeline de importação extrai certo (`verify-vaeso-real.mjs` na planilha
real: V50/V250/V.R. = 11,25/10,75/9,99 e as colunas #1/#2/#3 do Mercos corretas). O
valor se perdia DEPOIS: `addProdutosNormalizados` convertia `ProdutoNormalizado` em
`Produto` sem `precosTabela` (nem `camposMercos`), e a tela de Exportações remontava
o produto para `batchNormalizeToMercos` também sem eles — o mesmo caminho perdia os
campos Mercos mapeados pelo cliente (peso, dimensões...).

**Fix:** `Produto` ganha `precosTabela`/`camposMercos`; passam por
`addProdutosNormalizados` e por `produtosV2` da Exportações; persistem na coluna
`standardized_products.mercos_extras` (jsonb, migration
`20260918_standardized_products_mercos_extras.sql`). Se a coluna ainda não existir no
banco, o insert é refeito sem ela e as tabelas ficam na sessão (mesmo padrão do
histórico estruturado, #16) — por isso **a migration precisa ser aplicada** para
sobreviver a recarregar a página.

**Teste:** `ProdutosContext.tabelas-extras.test.tsx` (com e sem a coluna).

**Segunda causa (21/09, teste real no navegador de produção):** mesmo com o #160 no ar,
a exportação da VAESO EXCEL (178 linhas) ainda saía com "Preço de Tabela #1/#2/#3"
vazios e `standardized_products.mercos_extras` nulo no banco. O vazamento estava ANTES:
`processarArquivoV2` (`src/core/engine.ts`) remonta cada produto no formato de
compatibilidade (`ProdutoNormalizado`) e não copiava `precosTabela`/`camposMercos` —
e é essa lista (`result.produtos`) que a tela de Conversão grava. Fix: os dois campos
entram no tipo (`core/types/index.ts`) e no mapeamento do engine. Teste
`engine.tabelas-extras.test.ts` (planilha V50/V250/V.R. → `processarArquivoV2`; falha
sem o fix). Lição: o teste do #160 cobria só o contexto; faltou cobrir a fronteira
engine → tela. Verificar sempre de ponta a ponta na tela após corrigir.

---

### 14.25 VAESO PDF — fotos trocadas no caminho embedded (21/09/2026)

Teste real (PDF de 67 páginas pelo backend + tela): 162 produtos, "157 fotos
associadas", 5 sem foto (PUM/PUMF/PUG/PUGF0007 e GK0010). Conferindo as fotos, não
eram só 5: **29 produtos tinham a foto errada** (PUMF0002 Rosé com a foto Pistache, etc.),
porque o contador de "associadas" só diz que houve casamento, não que está certo.

**Causa (medida):** páginas com 1 foto grande + miniaturas em grade caem no caminho
EMBEDDED. Com a foto ACIMA do código, o código de um cartão fica a ~66pt da miniatura
de cima (a dele) e a ~67pt da de baixo. A distância era em valor absoluto, então o
empate era decidido por ruído de X e a foto do cartão de baixo ganhava — em cascata,
todas as cores deslocadas e o último item sem foto. É o mesmo defeito do #158 (grid),
no outro caminho.

**Fix:** `_match_via_embedded` recebe `orientacao`; com "acima", foto que começa abaixo
do código ganha +100 só na ORDEM do casamento guloso. O teto de aceitação continua
usando o score cru. (1ª versão somava ao score e o A/B na FORTAL pegou uma regressão:
HL186-B, cuja posição é inferida errada — a busca de "HL186-B" acerta dentro de
"HL186-BL" — perdeu a foto que antes recebia por sobra.)

**Medido:** VAESO 162/162 casadas; das 157 antigas, 29 mudaram e todas foram conferidas
lado a lado (agora corretas). A/B contra o código anterior em DAGIA, DUTE, FOLIA, GIRA,
BM36 e FORTAL (939 fotos): zero diferença. **Teste:** `test_embedded_foto_acima_empate.py`.
**Lição:** "N associadas" não prova acerto; conferir amostra visual em todo teste real.

---

### 14.26 BM36 — preço com asterisco de rodapé sumia da exportação (22/09/2026)

Retestagem do Josef: BM362346 (pág. 37, "BOWL C/6 PORCELANA FASELIS 16CM") não saiu
na exportação. No catálogo o preço vem `B8460*B10152**` ("B" é o glifo quebrado de
"R$" nesse PDF; os asteriscos marcam que o segundo valor é o promocional/riscado).

**Causa (medida):** BM36 usa o caminho `template-synth` (regex sintetizado pela IA a
partir de uma amostra de páginas, aplicado depois em todas de forma determinística).
A amostra usada pra sintetizar o PRECO regex nunca tinha um exemplo com asterisco, e
o regex resultante não batia com o `*` no meio do número — o produto ficava sem
`preco` e caía como erro. Isso não disparava o fallback pro AI-first porque os gates
de qualidade do template só olham cobertura de nome/qtd/código, não de preço isolado.

**Fix (genérico, não `if BM36`):** `extract_via_template` remove todo `*` do texto de
CADA página antes de sintetizar a amostra e antes de aplicar o template — pros campos
CODE/NOME/PRECO/QTD desse caminho, asterisco de rodapé nunca carrega valor, só atrapalha
o regex. Vale pra qualquer fornecedor com esse mesmo padrão de marcação, não só BM36.

**Medido:** `test_preco_asterisco_promocional.py` com o texto real da pág. 37 — SEM o
fix o produto fica sem `preco` (reproduz o bug relatado); COM o fix sai `84.60`.
Suíte Python completa (44 testes) sem regressão. Deploy verificado dentro do container
(`docker exec ... grep`).

---

### 14.27 BM36 — imagem com o MESMO xref em 2 posições perdia a 2ª (22/09/2026)

Retestagem do Josef: WC410004 (pág. 119, "FRASCO CREME 100ML") saía sem foto.
Página com 6 SKUs (frascos de creme variando só o volume) e 6 fotos em grade;
a foto de WC410003 (80ML) e a de WC410004 (100ML) são o MESMO recurso de imagem
embutido no PDF (xref idêntico), só desenhado 2 vezes — 2 frascos visualmente
iguais compartilhando a mesma arte.

**Causa (medida):** `_match_via_grid` marcava imagem como "já usada" guardando
o `xref` num set (`used_xrefs_global`). Quando o mesmo xref aparece em 2 posições
da página, a 1ª reivindicação (WC410003) marcava o xref como usado, e a 2ª
posição (a foto de WC410004, fisicamente noutro lugar da página) era descartada
como se já tivesse sido consumida — produto ficava com `no_img_in_col`. Esse
dedup por xref já tinha sido corrigido na COLETA de imagens da página (nota em
`cv_extractor.py` ~linha 1995, achado no Fortal), mas o mesmo defeito continuava
vivo na camada de CASAMENTO (`_match_via_grid`, `_foto_principal_da_celula`).

**Fix (genérico, não `if BM36`):** dedup trocado de `img["xref"]` pra `id(img)` —
identidade do dict de CADA posição desenhada, não do recurso de imagem. Uma
imagem reaproveitada em N posições agora libera N candidatas independentes;
duas posições realmente já usadas continuam bloqueadas (o dict é o mesmo objeto).

**Medido:** `test_xref_duplicado_2_posicoes.py` com a geometria real da pág. 119:
6/6 casadas (era 5/6, WC410004 sem foto). A mudança é estritamente uma
RELAXAÇÃO da regra — nunca pode fazer um match que já funcionava parar de
funcionar, só resgata os que eram descartados à toa por xref repetido. Suíte
Python completa sem regressão (`test_foto_celula_abaixo.py` atualizado pro novo
contrato de `usadas` = set de `id(img)`, não de xref).

---

### 14.28 FOLIA — 113 produtos sem foto (cards fundidos) + código "50"→"S0" (22/09/2026)

Retestagem do Josef (catálogo Utilidades, 300 produtos): 113 sem foto no Mercos
apesar de ter foto no catálogo, e 12 códigos `JRF-50.xxxx` saindo `JRF-S0.xxxx`.
Reproduzido de ponta a ponta contra o PDF real do Drive, via POST direto nos
endpoints do backend (`/extract_products_ai` + `/process`), sem GEMINI_API_KEY
local — a chave só existe no ambiente do VPS.

**Causa 1 (fotos, medida):** `_costurar_tiles` (criado pro LEVIVAN — junta
fatias de uma foto cortada pelo exportador em 2 tiras) rodava pra TODOS os
fornecedores antes do roteamento pro caminho de casamento. Os cards da FOLIA
são quadrados de 192×192 numa grade 3 colunas com vão de ~2pt entre eles —
dentro do `TOL_GAP=3.0` do costurador. 2-3 cards de PRODUTOS DIFERENTES viravam
1 imagem só (retângulo largo, reprovado por `_folia_card_candidates` ou
roubando o card de outro SKU), sumindo com a foto de vários produtos por vez.
`totalImages` real: 187 de ~300 esperadas.

**Fix (genérico, sem tocar LEVIVAN):** fatiamento real de UMA foto cortada
produz pedaços de TAMANHO DIFERENTE (medido: LV1052 tem 213pt vs 313pt de
largura — o conteúdo não se divide em partes iguais). Pedaços do MESMO tamanho
(±2pt), mesmo só 2, são a assinatura de uma grade de fotos independentes que
por coincidência de layout quase se tocam — `_costurar_tiles` agora pula a
costura nesse caso.

**Causa 2 (código, medida):** catálogo sem camada de texto — Gemini Vision lê
os pixels direto, sem texto pra conferir. Numa extração real, 294 de 297
códigos do mesmo segmento saíram "50" e 3 saíram "S0" (o "5" lido como "S" em
cartões isolados) — falha de percepção do modelo, não regex determinístico
(uma nova rodada produz um conjunto diferente de erros).

**Fix:** `_fix_ocr_digit_letter_confusion` mede a MAIORIA dos segmentos
100% numéricos do próprio lote (não é lista fixa por fornecedor) e só corrige
um código quando existe EXATAMENTE UMA troca letra→dígito visualmente parecida
(`S↔5, O↔0, I↔1, B↔8, Z↔2, G↔6`) que produz um segmento já confirmado por
outros códigos do mesmo lote — ambíguo ou sem batida não mexe.

**Medido:** extração real (300 produtos, mesma chamada de API do Josef) —
fotos sem match **113 → 3**; os 3 "S0" daquela rodada real, **3/3 corrigidos**.
Testes: `test_grade_de_cards_do_mesmo_tamanho_colados_nao_e_costurada` +
`test_par_de_cards_do_mesmo_tamanho_colados_tambem_nao_e_costurado` (geometria
real pág. 3), `test_ocr_digito_letra.py`. Suíte completa + LEVIVAN
(`test_fatias_contiguas_da_mesma_foto_viram_uma_imagem_so`) e BM36 sem
regressão.

**Pendente:** os 3 casos residuais (pág. 12) não investigados — retorno já é
99% (era 62%); catálogo de Brinquedos (45 págs, novo, no Drive) ainda não
testado.

---

## 15. Conversão em paralelo — fila de jobs (27/08/2026)

**Mudança de modelo de estado da tela `/conversao`**: de um catálogo por
vez (estado global único: `selectedFile`/`state`/`progress`/`resultData`)
para uma **fila de `CatalogJob[]`**, cada um com seu progresso/resultado
isolado.

- **Por quê:** o backend já limita processamento pesado simultâneo
  (`MAX_CONCURRENT_JOBS`, autoajustado por RAM — 3 no servidor próprio,
  1 no fallback Render, ver `## 14.3`) desde 13/08, mas isso era só
  proteção anti-OOM — o FRONTEND obrigava o cliente a esperar um catálogo
  terminar antes de configurar o próximo, mesmo o backend tendo folga.
- **Como:** `handleProcessar` cria um `CatalogJob`, dispara
  `processarCatalogo(job)` **sem aguardar** (fire-and-forget) e limpa o
  formulário na hora — o cliente já configura o próximo catálogo com o
  anterior ainda rodando. `processarCatalogo` é a MESMA lógica de sempre
  (motor de extração, adapters, backend — nada mudou nesses), só que lê/
  escreve num job específico em vez de estado singular do componente.
- **Render:** a coluna de resultado virou uma lista de mini-painéis
  (`jobs.map(...)`), um por catálogo, cada um com seu próprio cronômetro/
  progresso/resultado/download de imagens.
- **A fila vive FORA do React (11/09/2026):** `src/core/jobs/conversionJobsStore.ts`,
  lido por `useSyncExternalStore`. Enquanto ela morava em `useState` dentro da
  página, sair de `/conversao` desmontava o componente e os catálogos em
  andamento sumiam da vista — o trabalho seguia no servidor, mas o cliente não
  tinha como voltar e acompanhar. Josef: *"fui ver a exportação e os catálogos
  que estavam carregando sumiram; a gente consegue deixar rodando em segundo
  plano e voltar nessa mesma tela?"*. O componente
  `ConversoesEmAndamento` (no `AppLayout`, fora do `<main>`, que é remontado a
  cada navegação) mostra o aviso flutuante em qualquer outra tela e leva de
  volta com um clique.
  **Não persiste em disco de propósito:** um job carrega o `File` escolhido
  pelo cliente, e `File` não sobrevive a um recarregamento de página — salvar
  no localStorage devolveria um job fantasma, sem arquivo, impossível de
  continuar.
- **Limitação conhecida:** a barra de progresso de cada job continua
  sendo uma ESTIMATIVA animada (nunca foi o status real do backend, isso
  já era assim antes) — se um catálogo cair na fila real do servidor
  (além do limite de 3), a barra sobe até ~90% e espera ali até o
  resultado chegar, sem indicar "na fila" de verdade. Corrigir isso
  exigiria expor o `stage` do polling em `aiFirstExtractionApi.ts`
  (protegido por invariante) — decisão consciente de deixar de fora
  desse ciclo, escopo maior.

**Achado no caminho, vale saber pra quem for testar manualmente:** o
pipeline tem um validador anti-linha-fantasma
(`validateAndFixRows`/`hasCode` em `importPipeline.ts`) que rejeita linhas
cujo texto não "parece" um código de produto real (regex:
`[A-Z]{1,4}\d{2,}` ou `\d{4,}` em algum lugar da linha). Um SKU de teste
tipo `"PAR1-AAA"` é silenciosamente descartado (0 produtos, sem erro
visível) — não é bug, é a proteção contra linha vazia/desalinhada
funcionando. Teste manual com SKU real (ex: `AB1234`) pra não confundir
"catálogo zerado" com "dado de teste ruim".

## 16. Histórico estruturado + relatório de falhas persistido (27/08/2026)

**Problema:** um catálogo (VAESO) apareceu no histórico com 2 conversões
"render" e 1 "proprio" e o cliente não conseguia saber, só olhando a
tela, se isso indicava o servidor próprio instável ou o failover
funcionando normalmente — porque servidor/tempo/parser viviam embutidos
como TEXTO dentro de `conversion_type` (ex: `"Importação (pdf-ai-first ·
IA) · 4:54 · proprio"`, ver `## 14` sobre o resolvedor de backend),
sem coluna própria pra filtrar/badge. Pior: o relatório de SKUs sem
imagem (`unmatchedSkusDetails`) só existia na MEMÓRIA do navegador que
rodou a conversão — baixável na hora, mas perdido ao trocar de máquina
ou fechar a aba, então "confirmar que o fix de imagem funcionou" exigia
reprocessar o catálogo de novo em vez de olhar o histórico.

**Solução — migration `20260827_historico_estruturado.sql`:** adiciona em
`export_history` colunas reais: `server_used`, `duration_sec`,
`parser_used`, `used_ai`, `images_found`, `images_matched`,
`images_failed`, `failure_report` (texto do relatório, mesmo formato do
`.txt` baixável — SKU/página/motivo, sempre poucos KB mesmo em catálogos
grandes). `tipoConversao` continua existindo como resumo legível, mas as
colunas novas são a fonte de verdade pra filtro/badge/diagnóstico.

- **`HistoricoContext.registrarHistorico`** grava os campos estruturados
  junto com o `insert` de sempre. **Fallback deliberado:** se o insert com
  as colunas novas falhar (schema antigo — migration ainda não aplicada
  nesse projeto Supabase), refaz automaticamente só com as colunas
  legadas, pra não quebrar o registro de histórico inteiro enquanto o SQL
  não é rodado manualmente no painel do Supabase (ver
  `HistoricoContext.estruturado.test.tsx`, cenário que trava exatamente
  esse fallback).
- **`Historico.tsx`** ganhou colunas "Servidor" (badge verde=próprio,
  laranja=render/reserva — bater o olho numa fileira de laranja já indica
  queda recorrente do servidor próprio) e "Imagens"
  (`associadas/encontradas`, com aviso quando há falhas), mais um botão
  "Falhas (N)" que baixa `failure_report` DIRETO DO BANCO — funciona de
  qualquer máquina, ao contrário do botão equivalente na tela de
  Conversão (que só existe enquanto o job está na memória daquele
  navegador). Linhas com falha de imagem ou status de erro ganham borda
  de alerta pra achar problema no histórico sem abrir cada linha.
- **Conversões completas continuam só no localStorage** (produtos +
  imagens em base64) — grandes demais pra Supabase, e o histórico nunca
  foi pensado pra virar arquivo morto.

**Retenção (14 dias):** a migration cria `limpar_historico_antigo()` +
tenta agendar via `pg_cron` (silencioso se a extensão não estiver
habilitada nesse projeto — não quebra a migration). Fallback GARANTIDO,
que não depende de plano/extensão: `HistoricoContext` roda a limpeza
oportunisticamente toda vez que a tela de Histórico carrega, no máximo
1x/dia por navegador (`localStorage` guarda o timestamp da última
limpeza). Catálogo é atualizado toda semana pelo fornecedor — 14 dias
cobre "essa semana vs a passada" sem acumular histórico indefinidamente.

**Aplicada em 18/09/2026.** Ficou pendente por semanas porque a CLI do
Supabase, sem token de conta, não tinha como linkar o projeto
(`supabase link` retornava "account does not have the necessary
privileges"). Resolvido com conexão **escopada só a este projeto**: string
de conexão via Session Pooler (Project Settings → Database), guardada em
`.env.local` (gitignored) como `SUPABASE_DB_URL` — nunca um token de conta
que alcançasse os outros projetos Supabase do Gabriel. `supabase db query
--file <arquivo> --db-url "$SUPABASE_DB_URL"` não aceita múltiplos comandos
por chamada (prepared statement), então os 5 statements do arquivo rodaram
um a um. Confirmado via `information_schema.columns`: as 8 colunas novas
existem em `public.export_history`. (Uma entrada anterior deste arquivo
dizia "migration aplicada em 28/08" — o estado real encontrado agora
mostra que não estava; não investigado o motivo da divergência, e não é
mais relevante agora que está aplicada e verificada.)

---

**Mantenha este guia atualizado após cada mudança significativa.**
