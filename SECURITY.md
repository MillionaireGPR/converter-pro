# 🛡️ FRAMEWORK DE CIBERSEGURANÇA PARA PROJETOS WEB

> **SECURITY-FIRST DEVELOPMENT FRAMEWORK**
> 
> Aplica-se a: React, Vue, Angular, Next.js, Node.js, Python, PHP, ou qualquer stack web.
> Este guia DEVE ser consultado antes de qualquer implementação de código.

---

## 1. PRINCÍPIOS FUNDAMENTAIS (Non-Negociáveis)

### 1.1 Defesa em Profundidade
- Múltiplas camadas de segurança (nunca confiar em apenas uma)
- Falha em uma camada não compromete todo o sistema
- Princípio do menor privilégio (mínimo acesso necessário)

### 1.2 Zero Trust Architecture
- Nunca confiar em input do usuário (mesmo que "interno")
- Nunca confiar em dados de terceiros sem validação
- Autenticação e autorização em TODAS as camadas

### 1.3 Security by Design
- Segurança implementada desde o início (não como afterthought)
- Cada feature nova inclui análise de risco de segurança
- Code review focado em vulnerabilidades antes de merge

---

## 2. CHECKLIST OBRIGATÓRIO (Pré-Código)

Verificar TODOS os itens antes de iniciar desenvolvimento:

### 2.1 Gestão de Secrets
- [ ] NENHUMA chave API hardcoded no código
- [ ] NENHUMA senha ou token em variáveis de ambiente commitadas
- [ ] `.env` adicionado ao `.gitignore` ANTES do primeiro commit
- [ ] Secrets armazenados apenas em: 
  - Variáveis de ambiente do servidor (Vercel, AWS, etc.)
  - Secret managers (1Password, AWS Secrets Manager, Vault)
- [ ] Chaves de desenvolvimento DIFERENTES de produção
- [ ] Rotação de chaves a cada 90 dias (calendário)

### 2.2 Arquitetura Segura
- [ ] Camada de Service/Repository entre UI e banco de dados
- [ ] Nunca queries SQL diretas concatenadas com input de usuário
- [ ] Nunca acesso direto a storage/s3/buckets públicos
- [ ] API Gateway ou middleware de autenticação em todos os endpoints
- [ ] Rate limiting configurado em endpoints sensíveis

### 2.3 Validação e Sanitização
- [ ] TODOS os inputs de usuário validados (schema/tipo/tamanho)
- [ ] TODOS os dados de usuário sanitizados antes de exibição
- [ ] TODOS os arquivos validados (tipo, tamanho, conteúdo)
- [ ] TODOS os dados de terceiros (APIs externas) validados antes de uso

---

## 3. VULNERABILIDADES CRÍTICAS - COMO PREVENIR

### 3.1 Cross-Site Scripting (XSS)
**O que é:** Injeção de código JavaScript malicioso

**Prevenção Obrigatória:**
```
✅ Usar framework com escaping automático (React, Vue, Angular)
✅ Sanitizar dados ANTES de armazenar no banco
✅ Content Security Policy (CSP) header configurado
✅ Nunca usar innerHTML, document.write, ou eval()
✅ Sanitizar rich text com bibliotecas como DOMPurify

❌ PROIBIDO:
- element.innerHTML = userInput
- dangerouslySetInnerHTML sem sanitização
- eval() ou new Function() com dados de usuário
```

**Checklist XSS:**
- [ ] Tentar injetar: `<script>alert('xss')</script>` em todos os inputs
- [ ] Tentar injetar: `<img src=x onerror=alert('xss')>` em campos de texto
- [ ] Verificar se CSP bloqueia scripts inline não autorizados

### 3.2 SQL Injection / NoSQL Injection
**O que é:** Injeção de comandos no banco de dados

**Prevenção Obrigatória:**
```
✅ Usar ORM ou prepared statements (100% das queries)
✅ Validar e tipar todos os parâmetros de entrada
✅ Nunca concatenar strings diretamente em queries
✅ Principio do menor privilégio no banco (usuário com mínimo de permissões)
✅ WAF (Web Application Firewall) ativo em produção

❌ PROIBIDO:
- db.query("SELECT * FROM users WHERE id = " + userId)
- NoSQL: { $where: "this.password === '" + userInput + "'" }
```

**Checklist Injection:**
- [ ] Testar: `' OR '1'='1` em campos de busca
- [ ] Testar: `'; DROP TABLE users; --` em formulários
- [ ] Verificar se ORM escapa automaticamente
- [ ] Auditar permissões do usuário do banco

### 3.3 Authentication & Authorization Vulnerabilities
**O que é:** Falhas em controle de acesso

**Prevenção Obrigatória:**
```
✅ JWT com expiração curta (15-30 min) + refresh tokens
✅ Senhas: bcrypt/argon2 com salt, nunca MD5/SHA1
✅ Rate limiting em login (5 tentativas = bloqueio temporário)
✅ MFA (2FA) para ações sensíveis (opcional mas recomendado)
✅ RBAC (Role-Based Access Control) em todas as rotas
✅ Validar ownership de recursos (usuário A não acessa dados do B)

❌ PROIBIDO:
- Tokens JWT sem expiração ou secret fraco
- Senhas em plain text ou hash simples
- IDOR (Insecure Direct Object Reference): /api/user/123 (sem verificar se é o dono)
- Privilege escalation sem validação
```

**Checklist Auth:**
- [ ] Tentar acessar /api/user/123 sendo usuário 456
- [ ] Tentar brute force (6+ logins rápidos)
- [ ] Verificar se token expira corretamente
- [ ] Testar CSRF em ações de modificação

### 3.4 Path Traversal / File Upload Vulnerabilities
**O que é:** Acesso a arquivos fora do diretório permitido ou upload malicioso

**Prevenção Obrigatória:**
```
✅ Sanitizar nome de arquivo: remove path separators, null bytes
✅ Validar extensão E tipo MIME (não confiar apenas na extensão)
✅ Limitar tamanho de upload (configurável, padrão 10MB)
✅ Salvar em storage isolado, nunca em diretório web acessível
✅ Renomear arquivo com UUID (não manter nome original)
✅ Scan de malware/virus em uploads (ClamAV, VirusTotal API)

❌ PROIBIDO:
- Nome de arquivo: ../../../etc/passwd
- Permitir upload de .php, .exe, .sh sem validação de conteúdo
- Salvar em /public/uploads/ com nome original
```

**Checklist Upload:**
- [ ] Tentar upload: `../../../.env` como nome de arquivo
- [ ] Tentar upload: arquivo.php disfarçado de .jpg
- [ ] Tentar upload: arquivo > limite configurado
- [ ] Verificar se arquivo salvo tem nome aleatório (UUID)

### 3.5 Denial of Service (DoS / DDoS)
**O que é:** Sobrecarga do sistema para torná-lo indisponível

**Prevenção Obrigatória:**
```
✅ Rate limiting por IP e por usuário
✅ Limitar tamanho de payload (body-parser, max file size)
✅ Timeouts em operações longas (banco, APIs externas)
✅ Regex seguras (evitar catastrophic backtracking - ReDoS)
✅ CDN e WAF para absorver tráfego malicioso
✅ Limitar número de registros retornados (pagination obrigatória)

❌ PROIBIDO:
- Regex sem limitar tamanho do input: /^(a+)+$/
- Queries sem LIMIT que podem retornar milhões de registros
- Uploads de arquivos gigantes sem validação
- Endpoints exponenciais (nested recursão)
```

**Checklist DoS:**
- [ ] Enviar payload de 100MB para endpoint
- [ ] Tentar ReDoS: input com 10.000+ caracteres repetidos
- [ ] Fazer 1000 requests simultâneos (verificar rate limiting)
- [ ] Buscar sem paginação em tabela grande

### 3.6 Insecure Deserialization
**O que é:** Execução de código através de dados serializados manipulados

**Prevenção Obrigatória:**
```
✅ Nunca desserializar dados de usuário não confiáveis
✅ Usar JSON padrão (não pickle, java serialization, etc.)
✅ Validar schema antes de desserializar
✅ Assinar digitalmente dados sensíveis (HMAC)

❌ PROIBIDO:
- pickle.loads(userInput)
- ObjectInputStream.readObject() com dados externos
- yaml.load(userInput) (usar yaml.safe_load)
```

### 3.7 Security Misconfiguration
**O que é:** Configurações padrão inseguras ou expostas

**Prevenção Obrigatória:**
```
✅ Remover endpoints de debug (/admin, /phpinfo, /actuator)
✅ Desabilitar stack traces em produção (logs apenas no servidor)
✅ Headers de segurança configurados (CSP, HSTS, X-Frame-Options)
✅ CORS restrito (nunca '*', sempre origins específicas)
✅ TLS 1.2+ obrigatório (nunca HTTP em produção)
✅ Remover comentários de código que revelem estrutura interna

❌ PROIBIDO:
- CORS: Access-Control-Allow-Origin: *
- API keys em URLs (query params)
- Servidor enviando stack trace para cliente
- Portas de serviços expostas publicamente (Redis, MongoDB, etc.)
```

---

## 4. UTILITÁRIOS DE SEGURANÇA (Implementar em Todo Projeto)

### 4.1 Sanitização Padrão
```typescript
// Exemplo TypeScript - adaptar para sua linguagem
class SecurityUtils {
  // Sanitizar para exibição HTML
  static sanitizeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  // Sanitizar nome de arquivo
  static sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/[.]{2,}/g, '.')
      .substring(0, 100);
  }

  // Validar tipo de arquivo
  static isValidFileType(
    file: File, 
    allowedTypes: string[]
  ): boolean {
    return allowedTypes.includes(file.type);
  }
}
```

---

## 5. RECURSOS DE SEGURANÇA

### 5.1 Ferramentas Recomendadas
- **Snyk** - Scan de dependências vulneráveis
- **DOMPurify** - Sanitização de HTML (já que estamos usando React)

> ## 📌 REGRA DE OURO
> 
> **"Segurança > Funcionalidade > Velocidade"**
> 
> Nunca sacrificar segurança por prazo de entrega. 
> Uma vulnerabilidade em produção custa 100x mais para corrigir do que em desenvolvimento.

## 6. Assinatura / pagamentos (28/09/2026)

- Webhook de pagamento **nunca é confiado sozinho**: a InfinitePay não assina o
  webhook, então todo aviso (webhook ou retorno do navegador) é reconferido em
  `/payment_check` antes de liberar acesso. Pedido que não começa com `conv-`
  (não é nosso) é ignorado sem consultar nada.
- Tabelas de assinatura: RLS sem policies e sem grant para o cliente; funções de
  escrita só `service_role`. O cliente lê apenas o estado e o histórico
  resumido via RPCs de leitura.
- Controle da cobrança (ligar, preço, liberação manual) fica atrás do token de
  admin do servidor, não do admin do cliente.
- Nenhum dado de cartão passa pelo sistema: o pagamento acontece na página da
  InfinitePay.


## 7. Dependências (13/10/2026, atualizada 18/10/2026)

84 alertas do Dependabot, todos em bibliotecas JavaScript (o backend Python
não tinha alerta). Corrigidos no PR de segurança:

- **pdfjs-dist 5 → 6.4** (alta): PDF malicioso podia executar código ao ser
  aberto no navegador — o cliente abre catálogo de fornecedor.
- **xlsx 0.18.5 → 0.20.3** (alta: ReDoS e prototype pollution): a SheetJS não
  publica correção no npm; o pacote vem do site oficial
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, no `package.json`).
- **vite 5 → 6.4 e vitest 3 → 4.1** (crítico/alto, só ambiente de
  desenvolvimento: servidor de dev e UI de teste).
- `npm audit fix` nas transitivas; `uuid` forçado para 11.1 dentro do exceljs
  (`overrides`).

Ficam abertos, de propósito: **react-router** (open redirect — a correção só
existe na v7, que exige migrar o app; os links do app são internos),
**braces** e **postcss-selector-parser** (ferramentas de build do tailwind 3,
não vão para o navegador). Revisar quando migrar tailwind 4 / react-router 7.

**18/10/2026 (v296) — 0 alertas.** Os 4 restantes fechados:
- **react-router-dom 6.30 → 7.18.4** (react-router médio ×2). O app usa só a API
  de rotas no navegador (sem SSR), nenhuma mudança de código.
- **Tailwind 3.4 → 4.3.3** (`@tailwindcss/upgrade`, PostCSS `@tailwindcss/postcss`;
  `tailwind.config.ts` virou `@theme` no `src/index.css`): saem `braces` (alto) e
  `postcss-selector-parser` (médio). Removidos `@tailwindcss/typography` (sem
  `prose`) e `autoprefixer`. Compatibilidade visual no `index.css` (alturas de
  linha do v3, paleta do v3 nas famílias usadas, margem depois de `<label>` e do
  cabeçalho de card em linha; degradês em sRGB). `tailwind-merge` 2 → 3.7.0: o 2
  não conhece as classes do v4 e descartava o fundo do card (`bg-linear-to-r` × `bg-card`).
- **Vite fica em 6.4.4** de propósito: sem alerta, e o 7 traria o
  `@vitejs/plugin-react-swc` 4 com o `@swc/core` 1.16, que não carrega no Windows.
- **Motor Python:** `pip-audit` sem vulnerabilidade, tanto no `requirements.txt`
  quanto nos 72 pacotes instalados no container de produção (Python 3.11).
- Versões escolhidas com ≥2 semanas de publicação (`npm view <pacote> time`).
