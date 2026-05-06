# 🛡️ REGRAS DE DESENVOLVIMENTO - PROTEÇÃO DE CÓDIGO

> **ESTE ARQUIVO É OBRIGATÓRIO PARA TODA INTERVENÇÃO**
> 
> Antes de QUALQUER alteração, leia e confirme que entendeu todas as regras abaixo.

---

## ⚠️ REGRA DE OURO ABSOLUTA

### O que funciona, NÃO SE MEXE!

Qualquer alteração em código que já está em produção e funcionando deve:
1. Ter testes automatizados cobrindo o comportamento atual
2. Ser aprovada pelo usuário final
3. Ter plano de rollback definido
4. Ser feita em branch separada, NUNCA direto na main

---

## 📋 CHECKLIST OBRIGATÓRIO (Não Negociável)

### Antes de Começar:
- [ ] **Verificar se já existe função similar** em `core/` ou `lib/`
- [ ] **Revisar `guide.md`** para entender arquitetura
- [ ] **Revisar `SECURITY.md`** para requisitos de segurança
- [ ] **Verificar testes existentes** - rodar: `npm run test`
- [ ] **Criar branch**: `feature/nome-descritivo` (nunca trabalhar na main)

### Durante o Desenvolvimento:
- [ ] **Isolar impacto**: Nova feature não pode quebrar existente
- [ ] **Manter padrão de código**: Seguir ESLint e Prettier
- [ ] **Adicionar tipagem TypeScript**: Zero `any` sem justificativa
- [ ] **Testes unitários**: Cobertura mínima de 70%
- [ ] **Não alterar parsers existentes**: Criar novo se necessário

### Antes de Commit:
- [ ] **Rodar testes**: `npm run test -- --run` (todos devem passar)
- [ ] **Verificar build**: `npm run build` (não pode ter erro)
- [ ] **Verificar tipos**: `npx tsc --noEmit`
- [ ] **Sem console.log**: Remover logs de debug
- [ ] **Sem secrets**: Nenhuma chave hardcoded

### Antes de Merge:
- [ ] **Revisão obrigatória**: Outro desenvolvedor deve revisar
- [ ] **Testes de integração**: Fluxos críticos funcionando
- [ ] **Validação visual**: Testar na UI se aplicável
- [ ] **Documentação**: Atualizar se necessário

---

## 🚫 PROIBIDO (NUNCA FAZER)

### ❌ NUNCA alterar:
- `src/core/engine.ts` sem testes de regressão
- `src/core/pipeline/importPipeline.ts` sem validar todos os fornecedores
- `src/core/supplierRules/` - crie novos arquivos, não modifique existentes
- `src/context/AppContext.tsx` - adicione, não remova interfaces
- Parsers de Excel que já funcionam (Fase 1)
- Lógicas de Fase 1 (Produtos) na Fase 2 (Pedidos)

### ❌ NUNCA:
- Usar `innerHTML` ou `dangerouslySetInnerHTML` com dados de usuário
- Fazer queries SQL/Supabase direto em componentes de UI
- Propor serviços/libs pagos (priorizar open-source/free tier)
- Commitar na branch `main` diretamente
- Sugerir edições no Lovable (fazer tudo local)
- Deixar `console.log` em produção
- Usar `any` sem justificativa documentada

---

## 🔒 SEGURANÇA (Security-First)

### Toda alteração DEVE:
1. **Validar inputs**: Sanitizar tudo que vem de usuário/API
2. **Usar variáveis de ambiente**: Secrets nunca no código
3. **Respeitar RLS**: Queries Supabase sempre com validação
4. **Prevenir XSS**: React já escapa, mas verificar bindings
5. **Prevenir injeção**: Nunca concatenar strings em queries

### Checklist de Segurança:
- [ ] Nenhuma chave API hardcoded
- [ ] `.env` no `.gitignore`
- [ ] Inputs validados (tipo, tamanho, formato)
- [ ] Dados de usuário sanitizados
- [ ] Sem `eval()` ou `new Function()` com dados externos

---

## 🏗️ ARQUITETURA (Core vs Pages)

### `src/core/` - CÉREBRO DO SISTEMA
- Lógica de negócio pesada
- Parsers e engines
- Regras de fornecedores
- **Protegido**: Alterações requerem testes extras

### `src/pages/` - APENAS UI
- Componentes de visualização
- Chama funções do `core/`
- Nunca lógica de negócio complexa

### `src/components/ui/` - shadcn/ui
- Usar componentes existentes
- Não criar componentes HTML brutos desnecessários

---

## 🧪 TESTES (Obrigatórios)

### Cobertura Mínima: 70%

### Todo novo código DEVE ter:
- **Testes unitários**: Funções isoladas
- **Testes de integração**: Fluxos completos
- **Testes de regressão**: Garantir que não quebrou existente

### Comandos:
```bash
# Rodar todos os testes
npm run test -- --run

# Com cobertura
npm run test -- --run --coverage

# Testes específicos
npm run test -- --run orderExporter
```

---

## 🔄 FLUXO DE TRABALHO (Git)

### Branches:
- `main`: Produção - **PROTEGIDA**
- `develop`: Desenvolvimento
- `feature/*`: Novas features
- `fix/*`: Correções de bug
- `hotfix/*`: Correções urgentes

### Processo:
1. Criar branch a partir de `develop`
2. Desenvolver com commits pequenos e claros
3. Abrir PR para `develop`
4. Revisão obrigatória
5. Merge só após CI passar
6. Deploy para produção via `main`

---

## 📊 MÉTRICAS DE QUALIDADE

### CI/CD bloqueia se:
- Build falhar
- Testes falharem
- Cobertura < 70%
- Lint encontrar erros
- TypeScript tiver erros
- Secrets detectados
- Arquivos críticos modificados sem aprovação

---

## 🆘 EM CASO DE PROBLEMA

### Se algo quebrou:
1. **Não panique**
2. **Revert** imediato: `git revert HEAD`
3. **Testar** local antes de novo deploy
4. **Comunicar** o usuário
5. **Documentar** o que aconteceu

### Checklist de Rollback:
- [ ] Reverter código
- [ ] Verificar banco de dados (se necessário)
- [ ] Testar funcionalidade afetada
- [ ] Comunicar stakeholders

---

## ✅ CONFIRMAÇÃO

**Antes de qualquer alteração, confirme:**

> "Eu li e entendi as regras. 
> Eu verifiquei que não estou quebrando código existente.
> Eu criei testes para minha alteração.
> Eu rodei todos os testes e eles passaram."

---

**Última atualização:** 2026-04-26  
**Responsável:** CI/CD Automation
