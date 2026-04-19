# Erros Comuns e Soluções - Converter-Pro

> **Catálogo de erros recorrentes e suas soluções documentadas**
> 
> *Última atualização: 2025-01*

---

## Índice Rápido

1. [Preço com "R$" isolado (CLINK)](#1-preço-com-r-isolado-clink)
2. [Nome vazio apesar de ter descrição (CLINK)](#2-nome-vazio-apesar-de-ter-descrição-clink)
3. [Cabeçalho não detectado (linhas de lixo)](#3-cabeçalho-não-detectado-linhas-de-lixo)
4. ["Tudo Zeros e Vazios"](#4-tudo-zeros-e-vazios)
5. [Tela congelada/lenta (Base Padronizada)](#5-tela-congeladalenta-base-padronizada)

---

## 1. Preço com "R$" isolado (CLINK)

### Sintoma
- `precoInvalido: 1749` (todos os itens)
- Console mostra preço como `0` ou `NaN`
- Coluna "P.Venda" retorna apenas `"R$"` (string isolada)

### Causa Root
Planilha CLINK separa o símbolo `"R$"` do valor numérico em **colunas estéticas distintas** com merges do Excel. O valor real fica em colunas ocultas classificadas como `__EMPTY_1`, `__EMPTY_2`, etc.

**Exemplo da estrutura no XLSX:**
```javascript
{
  "Código": "123",
  "P.Venda": "R$",           // ← Coluna visível
  "__EMPTY_1": "",           // ← Vazio (merge)
  "__EMPTY_2": "15,90"       // ← Valor real aqui!
}
```

### Solução Implementada
**Arquivo:** `src/core/normalizers/utils.ts`

Rastreador lateral agressivo:
```typescript
// Se detectar "R$" ou "US$" isolado
if (precoRaw === "R$" || precoRaw === "US$") {
  // Loop: verifica +1, +2, +3 colunas à direita
  // Pega primeira célula com valor numérico válido (>0)
  // Sanitiza e converte para decimal
}
```

### Como Verificar
Abra DevTools → Console ao importar CLINK. Procure logs:
```
[CLINK PRICE FIX] R$ isolado detectado na coluna X
[CLINK PRICE FIX] Valor encontrado na coluna adjacente Y: 15.90
```

---

## 2. Nome vazio apesar de ter descrição (CLINK)

### Sintoma
- `semNome: 1749` (todos os itens)
- Produtos aparecem como "Sem Nome"
- Coluna existe na planilha mas não é mapeada

### Causa Root
AutoMapper procura aliases padrão: `['nome', 'descricao', 'produto']`. Mas CLINK usa `"Descr Compl"` que não está no alias list.

### Solução Implementada
**Arquivo:** `src/core/normalizers/utils.ts` (função `mapRowToProduto`)

Pós-processamento dedicado para CLINK:
```typescript
// Se nome ainda está vazio após mapeamento normal
if (!produto.nome && row['Descr Compl']) {
  produto.nome = sanitizarTexto(row['Descr Compl']);
}
```

### Como Verificar
Console mostrará:
```
[Flow MVP] Valores Finais Extraídos L1: {codigo: "123", nome: "Mochila", precoBase: 12.87}
```

---

## 3. Cabeçalho não detectado (linhas de lixo)

### Sintoma
- Importação vazia ou dados todos `undefined`
- Primeira linha reconhecida como header errado (ex: "CATÁLOGO 09-03-26")
- Propriedades dos objetos ficam: `{ "CATÁLOGO 09-03-26": "..." }`

### Causa Root
Planilhas de fornecedores têm **linhas de lixo visual** antes do cabeçalho real (títulos, datas, logos em células mergeadas).

### Solução Implementada
**Arquivo:** `src/core/autoMapper.ts` (função `findHeaderRowIndex`)

Sistema de Scoring:
```typescript
// Analisa as 20 primeiras linhas
// +1 ponto por célula preenchida
// +10 pontos por keyword operativa (codigo, custo, qtdcaixa, descrcompl)
// Linha com maior score vence = header real
```

### Como Verificar
Console imprime análise:
```
[Auto-Mapper Parser] Candidata L1 | Células: 1 | Score: 1 | Preview: [ 'CATÁLOGO 09-03-26' ]
[Auto-Mapper Parser] Candidata L3 | Células: 7 | Score: 57 | Preview: ['Código', 'Descr Compl', 'P.Venda']
```

**Winner:** Linha 3 (índice 2) com Score 57

---

## 4. "Tudo Zeros e Vazios"

### Sintoma
- Importação completa falha
- Todos os produtos vão para "Falhas"
- `semCodigo: 1800` (todos os itens)

### Causa Root
**Erro de tipagem silencioso** em `src/core/engine.ts` (linha 55):

```typescript
// ❌ ERRADO
if (validado.codigoFinal) {  // undefined! Não existe
  // Processa produto
}

// ✅ CORRETO  
if (validado.codigo) {  // Existe! Vem do mapRowToProduto
  // Processa produto
}
```

`mapRowToProduto` entrega `codigo`, mas validador checava `codigoFinal`.

### Solução Implementada
Corrigido interceptador no `engine.ts` para ler `validado.codigo` corretamente.

### Como Verificar
Console mostra agora:
```
[Engine] 5 linhas finais convertidas: [...]  // Dados reais aparecem
Breakdown Detalhado de Falhas:
- semCodigo: 0
- semPreco: 12  (só se origem veio vazio)
- semNome: 5
```

---

## 5. Tela congelada/lenta (Base Padronizada)

### Sintoma
- Base Padronizada trava ao abrir
- Lentidão extrema ao digitar/filtrar
- Browser congela com planilhas grandes (1800+ itens)

### Causa Root
Tentativa de renderizar **1800+ linhas HTML ricas simultaneamente**:
- Cada linha tem Tooltips, Status Badges, Checkboxes, Inputs
- Cada interação (filtro, digitação) re-renderiza tudo

### Solução Implementada
**Arquivo:** `src/pages/BasePadronizada.tsx`

1. **Paginação:** Limite de 50 itens por página
2. **useMemo:** Filtros só recalculam quando busca muda de fato

```typescript
// Antes: Renderizava todos de uma vez
produtos.map(p => <Row ... />)  // 1800 rows!

// Depois: Paginação + Memo
const produtosPaginados = useMemo(() => 
  filtrar(produtos).slice(pagina * 50, (pagina + 1) * 50),
  [produtos, filtro, pagina]
);
```

### Como Verificar
- Tela abre instantaneamente
- Controles: `Anterior | Pág X de Y | Próxima`
- Filtros respondem em tempo real

---

## Checklist de Debug Rápido

Ao encontrar erro de importação:

- [ ] Abri DevTools (F12) → Console?
- [ ] Procurei logs marcados com `[CLINK...]`, `[Auto-Mapper...]`, `[Engine...]`?
- [ ] Verifiquei se o erro é "CLINK específico" ou "todos fornecedores"?
- [ ] Anotei a linha exata mencionada no erro?
- [ ] Comparei com este catálogo de erros conhecidos?

---

## Padrões de Erro por Fornecedor

| Fornecedor | Erro Típico | Solução | Status |
|-----------|-------------|---------|--------|
| CLINK | Preço "R$" isolado | Rastreador lateral (+1,+2,+3) | ✅ Fixado |
| CLINK | Nome "Descr Compl" | Pós-processamento dedicado | ✅ Fixado |
| Todos | Cabeçalho lixo | Sistema de Scoring | ✅ Fixado |
| Todos | Tela lenta | Paginação + useMemo | ✅ Fixado |
| Todos | "Tudo zeros" | Corrigido validado.codigo | ✅ Fixado |

---

## Quando o Erro é NOVO

Se o erro **não estiver nesta lista**:

1. Documente no formato:
   ```markdown
   ## [NOME DO ERRO]
   ### Sintoma
   [o que acontece]
   
   ### Causa Root
   [descoberta após análise]
   
   ### Solução
   [implementação]
   
   ### Arquivos Afetados
   - `src/core/[arquivo].ts`
   ```

2. Adicione neste arquivo (03-erros-comuns-e-solucoes.md)

3. Commit: `docs: adiciona erro X ao catálogo`

---

*Mantenha este documento atualizado! Cada erro novo documentado economiza horas de debug futuro.*
