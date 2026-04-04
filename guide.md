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
