---
description: Verificação de Arquitetura Pré-Alteração
---

# Workflow: Verificação de Arquitetura Antes de Alterações

## Quando Usar
Antes de qualquer alteração estrutural no Converter-Pro, especialmente:
- Modificações no motor de extração de imagens
- Alterações no pipeline de importação
- Mudanças em tipos compartilhados
- Novos adaptadores de fornecedor

## Passos Obrigatórios

### 1. Identificar Motor Correto (30 segundos)
Verificar qual motor está sendo modificado:
```
Motor PDF  → backend/image_extractor/
Motor Excel → src/core/images/imageExtractorExcel.ts
Motor Pipeline → src/core/pipeline/importPipeline.ts
Motor Pedidos → src/core/orders/
```

### 2. Mapear Dependências (1 minuto)
Listar todos os arquivos que dependem do arquivo a ser modificado:
```bash
# Buscar imports do arquivo
grep -r "imageExtractorExcel" src/ --include="*.ts" --include="*.tsx"
grep -r "importPipeline" src/ --include="*.ts" --include="*.tsx"
```

### 3. Adicionar Diagnósticos (2 minutos)
Antes de alterar lógica, adicionar logs em todos os pontos de entrada/saída:
```typescript
console.log(`[NomeComponente] Input:`, { chave: valor });
console.log(`[NomeComponente] Processando...`);
console.log(`[NomeComponente] Output:`, { resultado });
```

### 4. Verificar Fluxo de Dados (2 minutos)
Traçar o caminho dos dados:
```
Origem → Transformação 1 → Transformação 2 → ... → Destino
```
Marcar pontos onde dados podem ser perdidos.

### 5. Testar Múltiplos Cenários (antes do commit)
Testar com pelo menos 2 fornecedores diferentes:
- Excel com abas múltiplas (Nix House)
- Excel simples (Moment)
- PDF com grid (GIRA)
- PDF sem grid (Clink)

### 6. Documentar Alterações
Atualizar `PROJECT_SUMMARY.md` ou `guide.md` com:
- O que mudou
- Por que mudou
- Impacto em outros componentes

## Checklist de Segurança

- [ ] Logs de diagnóstico adicionados
- [ ] Testado com múltiplos fornecedores
- [ ] Verificado que não quebrou PDFs (se alterou Excel)
- [ ] Verificado que não quebrou Excel (se alterou PDFs)
- [ ] Documentação atualizada
- [ ] Memory atualizada (se aplicável)

## Emergência: Rollback
Se algo quebrar em produção:
1. Reverter PR imediatamente
2. Notificar stakeholders
3. Corrigir em ambiente de staging
4. Novo PR com correção
