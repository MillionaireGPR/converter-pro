# Guia de Otimização de Tokens para IAs

> **Técnicas para reduzir drasticamente o consumo de tokens em conversas com IAs**

---

## 🎯 Princípio Fundamental

**Tokens = Palavras processadas pela IA**

Quanto mais contexto você manda, mais tokens gasta. A estratégia é **ser estratégico** no que enviar.

---

## 1. Estrutura de Mensagens (Otimizada)

### ❌ Formato Ruim (Gasta Tokens)
```
"Oi, tudo bem? Então, eu tô com um problema aqui no meu projeto. 
Ele é um projeto de conversão de planilhas, sabe? Eu uso React e tal. 
Aí ontem tava funcionando mas hoje parou..."
→ ~80 tokens de "lixo" antes do problema real
```

### ✅ Formato Otimizado (Economiza Tokens)
```
## Projeto
Converter-Pro (React + Vite + Supabase)

## Erro
TypeError: Cannot read property 'map' of undefined

## Local
src/core/orderParser.ts:42

## Contexto Mínimo
- Função parsePedidosMercos recebe workbook XLSX
- Linha 42: data.map(item => ...)
- data vem de XLSX.utils.sheet_to_json

## O que já tentei
- Verifiquei se workbook tem sheets
- Console.log mostra data como undefined
```
→ Direto ao ponto, sem fluff

---

## 2. Template de Contexto Rápido

**Use o arquivo `00-template-contexto-rapido.md`** no início de toda conversa:

```markdown
## 🎯 Projeto Ativo
Converter-Pro - Central de Conversão

## 📋 Stack
React 18 + Vite + TypeScript + Supabase

## 🏗️ Arquitetura
- core/ → lógica de negócio
- pages/ → apenas UI

## 🔥 Fluxo Atual
[Fase 1: Produtos / Fase 2: Pedidos]

## ⚠️ Regras
- Usar React Query
- Não acessar Supabase direto

## 📋 Tarefa
[DESCREVA O QUE PRECISA]

## 🐛 Erro
[SE HOUVER, COLE AQUI]
```

---

## 3. Técnicas de Redução de Tokens

### 3.1. Referências em vez de Cópia

**❌ Ruim:**
```
"Aqui está todo o código do arquivo src/core/engine.ts:
[pasta 200 linhas de código]"
→ ~500 tokens
```

**✅ Bom:**
```
"Arquivo: src/core/engine.ts
Função problemática: recalcularPrecos (linha 45-67)
Erro: retorna NaN quando desconto é 0"
→ ~30 tokens
```

### 3.2. Use Links para Documentação

**❌ Ruim:**
```
"Esse projeto usa React Query para gerenciamento de estado..."
[explicação longa]
```

**✅ Bom:**
```
"Ver documentação em: docs/obsidian-context/01-converter-pro-arquitetura.md
Seção: Padrões de Código → Acesso a Dados"
```

### 3.3. Contexto Incremental

**Abordagem em camadas:**

1. **Mensagem 1**: Contexto mínimo + erro (use template)
2. **Se a IA pedir**: Então envie código específico
3. **Se ainda precisar**: Então envie mais contexto

**Por quê funciona:**
- 80% dos problemas são resolvidos com contexto mínimo
- Você só gasta tokens extras quando realmente necessário

---

## 4. Prompts Prontos para Copiar

### Para bugs:
```markdown
## Bug Report Otimizado
**Arquivo:** `src/core/[nome].ts` (linha XX)
**Erro:** [mensagem de erro]
**Comportamento esperado:** [o que deveria acontecer]
**Comportamento atual:** [o que está acontecendo]
**Passos para reproduzir:** [1, 2, 3]
```

### Para novas features:
```markdown
## Feature Request Otimizado
**Fluxo:** [Fase 1 Produtos / Fase 2 Pedidos]
**Funcionalidade:** [o que precisa fazer]
**Referência similar:** [arquivo/componente existente similar]
**Regras de negócio:** [pontos importantes]
```

### Para refatoração:
```markdown
## Refactor Otimizado
**Arquivo alvo:** `src/[caminho]`
**Problema atual:** [descrição curta]
**Objetivo:** [o que melhorar]
**Restrições:** [o que NÃO pode mudar]
```

---

## 5. Checklist Pre-Chat

Antes de iniciar qualquer conversa com IA:

- [ ] Colei o **template de contexto rápido**?
- [ ] Descrevi a tarefa em **máximo 3 linhas**?
- [ ] Se tem erro, colei apenas a **mensagem de erro** (não stack trace inteiro)?
- [ ] Se preciso mostrar código, selecionei apenas a **função/arquivo específico**?
- [ ] Removi **explicações desnecessárias** ("então", "tipo assim", "sabe")?

---

## 6. Estimativa de Economia

| Cenário | Sem Otimização | Com Otimização | Economia |
|---------|---------------|----------------|----------|
| Bug simples | ~2.000 tokens | ~500 tokens | **75%** |
| Nova feature | ~5.000 tokens | ~1.500 tokens | **70%** |
| Refatoração | ~3.000 tokens | ~800 tokens | **73%** |
| Debug complexo | ~10.000 tokens | ~3.000 tokens | **70%** |

---

## 7. Exemplo Real Comparativo

### Cenário: "Converter-Pro não está parseando pedidos"

**Abordagem Ruim (~8.000 tokens):**
```
"Oi, meu projeto Converter-Pro tá com problema. 
Vou te contar a história toda do projeto primeiro...
[explicação longa da arquitetura]
...e ontem tava funcionando, mas hoje quando eu tento 
converter uma planilha de pedidos do Mercos, dá erro...
[stack trace de 50 linhas]
...você pode olhar tudo e ver o que está errado?"
```

**Abordagem Otimizada (~1.200 tokens):**
```
## 🎯 Projeto
Converter-Pro (React + Vite + TS + Supabase)

## 📋 Fluxo
Fase 2 - Pedidos (orderParser.ts)

## 🐛 Erro
TypeError: Cannot read property 'map' of undefined
Arquivo: src/core/orderParser.ts:42

## 🔍 Contexto
- Função: parsePedidosMercos
- Entrada: XLSX.WorkBook
- Linha 42: data.map() → data está undefined
- Planilha de pedidos Mercos (funcionava ontem)

## ✅ O que já verifiquei
- workbook.Sheets existe
- workbook.SheetNames tem valores
- XLSX.utils.sheet_to_json retorna undefined
```

**Resultado:** Mesma solução, **85% menos tokens**.

---

## 8. Boas Práticas de Contexto

### Mantenha no Obsidian:

1. **00-template-contexto-rapido.md** → Copie no início de toda conversa
2. **01-converter-pro-arquitetura.md** → Referencie quando precisar
3. **Links para documentação oficial** → React, Supabase, etc.

### Fluxo de Trabalho:

```
1. Abra Obsidian
2. Copie o template de contexto rápido
3. Cole na IA + descreva tarefa
4. Se precisar de mais contexto, referencie doc completa
5. Envie código específico apenas se solicitado
```

---

## 9. Anti-Patterns (Evite!)

❌ **NUNCA faça:**
- Enviar código de múltiplos arquivos sem pedir
- Colar stack traces de 100+ linhas
- Explicar "a história toda" do problema
- Usar "Oi, tudo bem?" em mensagens técnicas
- Enviar prints de tela (use texto)

✅ **SEMPRE faça:**
- Ser direto e técnico
- Referenciar documentação existente
- Usar formatos estruturados (markdown)
- Separar contexto em mensagens curtas

---

## 10. Métricas de Sucesso

**Meta:** Reduzir consumo médio de tokens em **70%**.

**Como medir:**
- Antes: Anote tokens usados em 5 conversas típicas
- Depois: Use essas técnicas e compare
- Resultado esperado: 1/3 do consumo anterior

---

*Este guia é vivo. Atualize conforme aprenda novas técnicas!*
