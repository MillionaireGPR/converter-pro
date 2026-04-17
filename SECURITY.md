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
