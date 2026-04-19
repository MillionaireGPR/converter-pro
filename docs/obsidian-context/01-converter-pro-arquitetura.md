# Converter-Pro - Arquitetura Completa

> **Use este documento quando precisar de detalhes técnicos profundos**

---

## 1. Visão Geral

**Converter-Pro** é uma aplicação web para conversão de planilhas entre diferentes formatos de ERP, focada inicialmente na integração Mercos.

### Funcionalidades Principais
- Conversão de produtos (Catálogos → Mercos)
- Conversão de pedidos (Mercos → ERP)
- Gestão de descontos por catálogo
- Upload e processamento de XLSX local (sem servidor)

---

## 2. Stack Tecnológica Detalhada

| Camada | Tecnologia | Uso |
|--------|-----------|-----|
| Framework | React 18 + Vite | SPA rápida |
| Roteamento | React Router v6 | Navegação SPA |
| UI | Tailwind + shadcn/ui + Radix | Componentes estilizados |
| Estado Servidor | React Query (TanStack) | Fetch/mutações |
| Estado Local | Context API | Estado global |
| Formulários | React Hook Form + Zod | Validação tipada |
| Backend | Supabase | Auth + PostgreSQL |
| Arquivos | XLSX + jsPDF | Leitura/escrita |
| Datas | date-fns | Manipulação de datas |

---

## 3. Estrutura de Pastas (Importante!)

```
src/
├── core/                    ← 🧠 CÉREBRO DO SISTEMA
│   ├── engine.ts            # Lógica de cálculo e conversão
│   ├── autoMapper.ts        # Mapeamento automático de colunas
│   ├── orderParser.ts       # Parser de pedidos Mercos
│   ├── normalizers/         # Normalização de dados
│   ├── validators/          # Validações de regras
│   └── types/               # Tipos TypeScript
├── pages/                   ← 🎨 APENAS UI
│   ├── ConversaoProdutos.tsx
│   ├── ConversaoPedidos.tsx
│   └── DescontosCatalogos.tsx
├── components/              ← 🧩 Componentes reutilizáveis
│   └── ui/                  # Componentes shadcn
├── hooks/                   ← 🎣 Hooks customizados
│   └── useSupabase.ts
├── context/                 ← 🌍 Estado global
│   └── AppContext.tsx
├── lib/                     # 📚 Utilitários
│   └── utils.ts
└── integrations/
    └── supabase/
        ├── client.ts        # Cliente Supabase
        └── types.ts         # Types gerados
```

### Regra de Separação
```
❌ ERRADO: Lógica de cálculo dentro de um componente React
✅ CERTO: Lógica no core/, componente apenas chama a função
```

---

## 4. Fluxos de Negócio (Fases)

### Fase 1: Produtos (Catálogos → Mercos)

**Arquivos principais:**
- `src/core/engine.ts` - Motor de cálculo
- `src/pages/ConversaoProdutos.tsx` - Interface

**Fluxo:**
1. Usuário faz upload de planilha de catálogo
2. `autoMapper.ts` identifica colunas automaticamente
3. `engine.ts` recalcula preços (com descontos se houver)
4. Gera planilha formatada para importação no Mercos

**Regras de negócio:**
- Descontos são aplicados por catálogo
- Preços são recalculados com base na tabela selecionada
- Exportação em formato específico Mercos

### Fase 2: Pedidos (Mercos → ERP)

**Arquivos principais:**
- `src/core/orderParser.ts` - Parser de pedidos
- `src/pages/ConversaoPedidos.tsx` - Interface

**Fluxo:**
1. Usuário faz upload de planilha de pedidos Mercos
2. `orderParser.ts` lê e interpreta a estrutura
3. Gera preview para conferência antes de exportar para ERP

**Regras de negócio:**
- Parsing inteligente de colunas variáveis
- Validação de dados obrigatórios
- Geração de arquivo compatível com ERP

---

## 5. Padrões de Código

### Acesso a Dados (Supabase)

```typescript
// ❌ ERRADO - Acesso direto em componente
const { data } = await supabase.from('produtos').select('*')

// ✅ CERTO - Via hook
const { data, isLoading } = useProdutos()
```

### Estado e Loading

```typescript
// ✅ Use React Query para estados de loading/error
const { data, isLoading, error } = useQuery({
  queryKey: ['produtos'],
  queryFn: fetchProdutos
})
```

### Formulários

```typescript
// ✅ RHF + Zod para validação tipada
const form = useForm<FormData>({
  resolver: zodResolver(schema)
})
```

---

## 6. Regras de Segurança (RLS)

Todas as tabelas Supabase têm **Row Level Security**:

```sql
-- Exemplo de política
CREATE POLICY "Users can only see their own data"
ON produtos FOR SELECT
USING (auth.uid() = user_id);
```

**Sempre filtre por `user_id` nas queries!**

---

## 7. Funções Core Principais

### engine.ts
```typescript
// Recalcula preços com descontos
export function recalcularPrecos(
  produtos: Produto[], 
  descontos: Desconto[]
): ProdutoRecalculado[]

// Formata para exportação Mercos
export function formatarParaMercos(
  produtos: ProdutoRecalculado[]
): ExportacaoMercos[]
```

### orderParser.ts
```typescript
// Parser de planilha de pedidos
export function parsePedidosMercos(
  workbook: XLSX.WorkBook
): PedidoPreview[]

// Validação de estrutura
export function validarEstruturaPedidos(
  data: unknown[]
): ValidationResult
```

### autoMapper.ts
```typescript
// Mapeamento automático de colunas
export function mapearColunasAutomaticamente(
  headers: string[],
  template: TemplateMapeamento
): MapeamentoResult
```

---

## 8. Checklist de Desenvolvimento

### Antes de começar uma tarefa:
- [ ] Revisar `src/core/types` para tipos relevantes
- [ ] Revisar `src/core/normalizers` para funções existentes
- [ ] Verificar se já existe hook similar em `src/hooks`

### Durante o desenvolvimento:
- [ ] Manter lógica no `core/`, não em `pages/`
- [ ] Usar componentes shadcn/ui para UI
- [ ] Implementar estados loading/error com React Query

### Após implementar:
- [ ] Verificar políticas RLS para novas tabelas/queries
- [ ] Atualizar types gerados se alterou schema: `supabase gen types`
- [ ] Testar fluxo completo manualmente

---

## 9. Comandos Úteis

```bash
# Instalar dependências
npm install

# Rodar dev server (porta 8080)
npm run dev

# Build para produção
npm run build

# Atualizar types Supabase
npx supabase gen types typescript --project-id <id> --schema public > src/integrations/supabase/types.ts
```

---

## 10. Referências Rápidas

- **Tipos Supabase**: `src/integrations/supabase/types.ts`
- **Utilitários**: `src/lib/utils.ts`
- **Config Tailwind**: `tailwind.config.ts`
- **Guia de negócio**: `guide.md` (raiz do projeto)

---

*Documento mantido atualizado manualmente. Última revisão: 2025-01*
