# Template: Contexto Rápido para IAs

> **COLE ISSO NO INÍCIO DE TODA CONVERSA** para economizar tokens

---

## 🎯 Projeto Ativo
**Converter-Pro** - Central de Conversão de Planilhas

## 📋 Stack Tecnológica
- React 18 + Vite + TypeScript
- React Router v6
- Tailwind CSS + shadcn/ui + Radix
- React Query + Context API
- React Hook Form + Zod
- Supabase (PostgreSQL)
- XLSX + jsPDF + date-fns

## 🏗️ Arquitetura (REGRA DE OURO)
```
src/core/     → TODA lógica de negócio (engine, parsers, normalizers, validators, types)
src/pages/    → APENAS UI e chamadas ao core
src/hooks/    → Acesso a dados e estado
src/context/  → Estado global
```

**NUNCA misture lógica de negócio em components/pages!**

## 🔥 Fluxos Críticos
1. **Fase 1 - Produtos**: `engine.ts` recalcula e exporta para Mercos
2. **Fase 2 - Pedidos**: `orderParser.ts` lê planilhas Mercos → preview ERP
3. **Upload XLSX**: Processado em memória (sem backend)

## ⚠️ Regras de Ouro
- ✅ Usar React Query para fetch/mutações
- ✅ Acessar Supabase via hooks/context (nunca direto em componentes)
- ✅ Respeitar RLS (user_id)
- ❌ NÃO acessar Supabase em componentes "burros"
- ❌ NÃO misturar Fase 1 e Fase 2
- ❌ NUNCA sugerir editar no Lovable (tudo local)

## 📁 Contexto Adicional (se necessário)
- Ver `docs/obsidian-context/01-converter-pro-arquitetura.md` para detalhes completos
- Ver `guide.md` na raiz para fluxos de negócio

---

**Tarefa atual:** [DESCREVA AQUI O QUE PRECISA FAZER]

**Erro/Problema (se houver):** [COLE AQUI]

**O que já tentou:** [DESCREVA AQUI]
