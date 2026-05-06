# 📋 PROTOCOLO DE DESENVOLVIMENTO SEGURO

> **LEIA ANTES DE QUALQUER ALTERAÇÃO NO CÓDIGO**

---

## 🎯 PROPÓSITO

Este protocolo garante que:
1. ✅ Nada que já funciona seja quebrado
2. ✅ Trabalho existente seja preservado
3. ✅ Novas features sejam adicionadas com segurança
4. ✅ Código tenha qualidade e testes

---

## 🚦 SEMÁFORO DE DECISÃO

### 🟢 PODE FAZER (Sem restrições):
- Adicionar novos arquivos em `src/core/orders/` (novo conversor)
- Criar novos componentes de UI
- Adicionar testes
- Corrigir bugs com testes de cobertura
- Refatorar código COM testes existentes

### 🟡 PRECISA DE CUIDADO (Verificar antes):
- Modificar `src/core/engine.ts` → Testar todos os fornecedores
- Alterar `src/core/pipeline/importPipeline.ts` → Validar com Excel/PDF
- Mudar `src/context/AppContext.tsx` → Verificar interfaces
- Atualizar tipos do Supabase → Verificar RLS

### 🔴 NUNCA FAÇA (Bloqueado):
- Alterar parsers de Excel que já funcionam
- Modificar lógica de Fase 1 (Produtos) na Fase 2 (Pedidos)
- Remover funções sem substituir
- Commitar direto na `main`
- Deixar de rodar testes

---

## 📁 ESTRUTURA DE PASTAS (O que proteger)

```
src/
├── core/                           ← 🛡️ PROTEGIDO
│   ├── engine.ts                   ← 🔴 NUNCA ALTERAR sem testes
│   ├── pipeline/
│   │   └── importPipeline.ts      ← 🔴 NUNCA ALTERAR sem testes
│   ├── supplierRules/             ← 🟡 CUIDADO (adicionar, não modificar)
│   │   ├── petrin.ts
│   │   ├── levivan.ts
│   │   └── ... (regras existentes)
│   └── orders/                    ← 🟢 PODE ADICIONAR
│       ├── orderParser.ts         ← 🟡 CUIDADO
│       └── orderExporter.ts       ← 🟢 PODE MODIFICAR (novo)
├── context/
│   └── AppContext.tsx             ← 🟡 CUIDADO (adicionar, não remover)
└── pages/                         ← 🟢 LIVRE (apenas UI)
```

---

## 🔄 FLUXO DE TRABALHO CORRETO

### 1. Antes de Começar
```bash
# 1. Verificar status atual
git status

# 2. Criar branch nova (NUNCA trabalhar na main)
git checkout -b feature/nome-da-feature

# 3. Rodar testes existentes
npm run test -- --run

# 4. Verificar build
npm run build
```

### 2. Durante Desenvolvimento
```bash
# A cada alteração:
# 1. Rodar testes afetados
npm run test -- --run nome-do-teste

# 2. Verificar tipos
npx tsc --noEmit

# 3. Verificar lint
npm run lint

# 4. Commit com mensagem clara
git add .
git commit -m "feat: descrição clara do que foi feito"
```

### 3. Antes de Finalizar
```bash
# 1. Rodar TODOS os testes
npm run test -- --run

# 2. Verificar cobertura
npm run test -- --run --coverage

# 3. Build final
npm run build

# 4. Push para branch
git push origin feature/nome-da-feature

# 5. Abrir Pull Request no GitHub
# - Descrever o que foi feito
# - Linkar issues relacionadas
# - Solicitar revisão
```

---

## ⚠️ CHECKLIST PRÉ-ALTERAÇÃO

### Para todo código:
- [ ] Criei branch `feature/*` ou `fix/*`
- [ ] Rodei `npm run test` e todos passaram
- [ ] Verifiquei `npm run build` sem erros
- [ ] Não há `console.log` no código
- [ ] Não há chaves/secrets hardcoded

### Se alterar arquivo em `core/`:
- [ ] Criei testes unitários para nova função
- [ ] Testei com dados reais (se possível)
- [ ] Verifiquei que não quebrou outros fornecedores
- [ ] Documentei a mudança

### Se alterar interface/tipo:
- [ ] Atualizei todos os usos do tipo
- [ ] Verifiquei tipagem TypeScript (`npx tsc --noEmit`)
- [ ] Não removi campos obrigatórios

---

## 🧪 TESTES OBRIGATÓRIOS

### Todo novo código DEVE ter:

1. **Testes Unitários** (`*.test.ts`):
```typescript
describe('Nova Funcionalidade', () => {
  it('deve fazer X corretamente', () => {
    const resultado = novaFuncao(dadosTeste);
    expect(resultado).toBe(esperado);
  });
  
  it('deve lidar com erro Y', () => {
    expect(() => novaFuncao(dadosInvalidos)).toThrow();
  });
});
```

2. **Testes de Integração**:
- Testar fluxo completo
- Testar com dados reais (mockados)
- Testar casos de erro

3. **Cobertura mínima**: 70%

---

## 🔒 REGRAS DE SEGURANÇA

### SEMPRE:
- ✅ Validar inputs de usuário
- ✅ Usar variáveis de ambiente para secrets
- ✅ Sanitizar dados antes de exibir
- ✅ Respeitar RLS do Supabase

### NUNCA:
- ❌ Usar `innerHTML` com dados de usuário
- ❌ Fazer query SQL direto em componente
- ❌ Commitar `.env` ou chaves
- ❌ Usar `any` sem justificativa

---

## 🆘 EMERGÊNCIA - ROLLBACK

### Se deploy quebrou:

```bash
# 1. Identificar último commit bom
git log --oneline -10

# 2. Reverter imediatamente
git revert HEAD --no-edit

# 3. Push da reversão
git push origin main

# 4. Notificar usuário no chat
```

### Checklist pós-rollback:
- [ ] Verificar se funcionalidade voltou a funcionar
- [ ] Investigar causa no ambiente local
- [ ] Criar nova branch para correção
- [ ] Testar extensivamente antes de novo deploy

---

## 📞 QUANDO PEDIR AJUDA

### Peça ajuda se:
- Não entender regra de negócio existente
- Precisar alterar arquivo em `core/` crítico
- Testes falharem e não souber resolver
- Houver conflito com trabalho existente

### NÃO peça ajuda para:
- Criar componente de UI simples
- Adicionar teste básico
- Rodar comandos de verificação

---

## ✅ CONFIRMAÇÃO FINAL

**Antes de cada alteração, leia em voz alta:**

> "Eu estou seguindo o protocolo.
> Eu criei uma branch separada.
> Eu verifiquei que não estou quebrando código existente.
> Eu rodei todos os testes.
> Eu estou pronto para commitar."

---

**Criado em:** 2026-04-26  
**Última atualização:** 2026-04-26  
**Autor:** CI/CD Protocol
