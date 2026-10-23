# Central de Conversão — Guia de Implantação

> Para a equipe da Nunes Representações. Explica o que o conversor faz, como usar no dia a dia,
> onde cada parte roda, como publicar uma mudança e como assumir as contas, se for o caso.
> Detalhes técnicos de servidor: `CLAUDE.md`, seção 0 (referência única de infraestrutura).
> Atualizado em 23/10/2026 (versão 297).

---

## 1. O que o conversor faz

Recebe o catálogo de um fornecedor (PDF ou Excel) e devolve uma planilha pronta para o Mercos. Cada produto sai com:

- código;
- nome;
- preço e preço promocional;
- quantidade por caixa;
- IPI e desconto;
- foto.

**Caminho de um catálogo**

```
Catálogo do fornecedor (PDF / Excel)
        │
        ▼
Conversão de Produtos ── PDF: o motor de conversão lê com IA (Gemini) e confere no próprio PDF
        │                 Excel: lido direto no navegador, pelas regras de colunas
        ▼
Base Padronizada ─────── revisar, editar (duplo clique), aplicar desconto
        │
        ▼
Descontos e Catálogos ── desconto e IPI em massa, catálogo comercial
        │
        ▼
Exportações Mercos ───── checklist de validação → planilha no formato de importação do Mercos
```

Além disso:

- **Conversão de Pedidos:** lê o pedido do Mercos e gera o arquivo para o ERP (inclui o modelo JAWEB).
- **Cortar PDF:** separa as páginas de um catálogo grande. O corte acontece no navegador e nada sai do computador.

## 2. Telas e para que servem

| Tela | Uso |
|---|---|
| Dashboard | Visão geral e atividades recentes |
| Conversão de Produtos | Enviar catálogos. Vários podem ficar na fila; a conversão segue mesmo se você trocar de tela |
| Base Padronizada | Conferir e corrigir produtos antes de exportar |
| Descontos e Catálogos | Desconto e IPI em massa, catálogo comercial |
| Exportações Mercos | Gerar a planilha de importação do Mercos, com checklist |
| Conversão de Pedidos | Pedido do Mercos para o ERP |
| Cortar PDF | Dividir catálogos grandes |
| Fornecedores | Desconto e IPI padrão de cada fornecedor e **regras em texto livre** (ex.: "a quantidade da caixa vem como CAIXA MASTER no topo da página"). O conversor aplica essas regras na próxima conversão |
| Regras de Colunas | Para catálogos em Excel: qual coluna é código, nome, preço etc. |
| Histórico | Tudo que foi convertido, de que servidor veio e o que falhou |
| Usuários | Criar usuários e trocar senhas (só administrador) |
| Assinatura | Só aparece se a cobrança estiver ligada (hoje está desligada) |

**Selo da versão e novidades:** o número no topo (ex.: `v297`) é a versão no ar. O ✨ abre a Central de novidades, que mostra o que mudou e o que conferir. Quando sai uma versão nova, aparece a barra "Nova atualização disponível": é só clicar.

## 3. Como conferir uma conversão

O conversor acerta a grande maioria dos itens, mas catálogo de fornecedor muda de layout sem avisar. Antes de exportar, confira na Base Padronizada:

1. **Quantidade de produtos:** bate com o catálogo? Os produtos esgotados e os "EM BREVE" ficam de fora de propósito.
2. **Preço e promoção:** confira 5 a 10 itens no PDF. Quando o catálogo traz preço DE/POR ou selo de promoção, sai o preço menor e o nome ganha `***PROMOCAO***`.
3. **Caixa e pacote:** em kits e pacotes, o preço é o do pacote impresso no catálogo.
4. **Fotos:** veja se cada foto é do produto certo, principalmente nas páginas com muitos itens.
5. **Cores:** quando o mesmo produto tem mais de uma cor (códigos diferentes), o nome sai com `***CORES***` e a cor vai para as observações.

Achou erro? Anote o fornecedor, a página e o código, e corrija a mão na Base Padronizada. Se o erro se repetir em todo catálogo daquele fornecedor, uma regra no cadastro do fornecedor costuma resolver. Se não resolver, é ajuste no motor de conversão (seção 6).

## 4. Onde roda cada parte

| Parte | Onde | Observação |
|---|---|---|
| Site (tela) | Vercel, `centraldeconversao.vercel.app` | Publica sozinho quando o código entra na `main` |
| Motor de conversão | Servidor Integrator (VPS com Docker), `conversor-vps.metodoiqc.com.br` | Atualizado à mão a cada entrega (seção 6) |
| Servidor reserva | **Nenhum funcionando hoje.** O Render (opcional) está suspenso | Se o Integrator cair, a conversão de PDF para até ele voltar |
| Banco de dados, login e arquivos | Supabase | Produtos, fornecedores, histórico, usuários |
| Inteligência artificial | Google Gemini (`gemini-2.5-flash`, com plano B em `2.0-flash` e `2.5-pro`) | É o único custo que varia: depende de quantos catálogos são convertidos |
| Código | GitHub | Branch `main` = o que está no ar |

O detalhe técnico (endereços, comandos, nomes de variáveis) está no `CLAUDE.md`, seção 0. Senhas e chaves **nunca** ficam no código: ficam no painel de cada plataforma e no arquivo de configuração do servidor.

## 5. Custos mensais (confirmados em 23/10/2026)

| Plataforma | Para quê | Custo |
|---|---|---|
| Google Gemini | Leitura dos catálogos com IA | ~R$ 100–150 por mês (varia com o volume de catálogos) |
| Integrator (VPS) | Motor de conversão | R$ 34,90 por mês |
| Supabase | Banco, login, arquivos | gratuito |
| Vercel | Site | gratuito |
| GitHub | Código | gratuito |
| Render (opcional) | Servidor reserva, se quiserem manter | hoje suspenso; reativar só se a Nunes quiser reserva |
| Domínio | Endereço do motor de conversão | hoje usa um domínio do Gabriel (`metodoiqc.com.br`) |

**Total hoje: ~R$ 135–185 por mês**, quase tudo do Gemini.

O Google pede que a conta de faturamento do Gemini seja **pré-paga**. Mantenha saldo e um teto de gasto mensal, senão a IA para de responder.

### Pontos de atenção se as contas forem para a Nunes

- **Vercel:** o plano gratuito (Hobby) é para uso pessoal e não comercial, pelos termos da Vercel. Uma empresa normalmente precisa do plano Pro (~US$ 20 por mês).
- **Supabase:** o plano gratuito pausa o projeto depois de alguns dias sem uso e não inclui backup automático. Também tem limite de espaço para banco e arquivos.
- **Gemini:** faturamento pré-pago. Alguém precisa acompanhar o saldo e o teto de gasto, senão a conversão de PDF para.
- **Servidor:** atualizações de segurança, renovação do certificado, limpeza de disco e reinício quando cair ficam por conta de quem administra.

### Assinatura de operação (opção mantida pelo Gabriel): R$ 249 por mês

Uma cobrança única no lugar das plataformas separadas. Inclui:

- todas as plataformas acima, inclusive a variação de uso do Gemini até o uso normal da equipe;
- monitoramento do servidor e retomada quando cair;
- atualizações de segurança;
- backups e certificado;
- correções de erro e ajustes quando um fornecedor muda o layout do catálogo, com versão nova e nota na Central de novidades;
- revisão e publicação das mudanças que a equipe fizer no código.

O código continua sendo da Nunes, nos dois formatos.

## 6. Como mudar o sistema com segurança

O conversor tem uma bateria de testes automáticos que trava o que já funciona: são 503 testes do site, 174 do motor de conversão e verificações de pontos que não podem quebrar (`ARCHITECTURE.md`). Toda mudança segue este caminho:

1. **Branch nova** a partir da `main` (`fix/...`, `feat/...`, `docs/...`). Nunca altere a `main` direto.
2. **Mudança + teste** que prove a correção, usando o catálogo real do fornecedor.
3. **Portão local:** `npm run verify` (testes + tipos + invariantes). O `git push` roda isso sozinho e bloqueia se falhar.
4. **Pull request** no GitHub: os testes rodam de novo e o merge só libera com tudo verde. A Vercel gera uma prévia do site.
5. **Versão e novidades:** cada entrega sobe o número em `src/lib/versao.ts` e escreve o que mudou em `src/data/novidades.ts` (o teste quebra se esquecer).
6. **Merge:** o site atualiza sozinho.
7. **Motor de conversão:** se a mudança mexeu em `backend/`, é preciso publicar no servidor (copiar os arquivos e reconstruir o container). Passo a passo no `CLAUDE.md`, seção 0.

**Ajuste por fornecedor:** a regra é medir no PDF real e não criar um `if fornecedor == X`. O histórico de cada correção, com o porquê, está em `guide.md` (§14 em diante). Leia antes de mexer num fornecedor que já teve correção.

**Teste com IA custa dinheiro:** cada conversão real chama o Gemini. Prefira comparar com conversões já guardadas no servidor e só rode a IA de novo para confirmar.

## 7. Assumir as contas (migração)

Use esta parte se a Nunes decidir operar o sistema nas próprias contas. A ordem evita deixar o site fora do ar:

| # | Conta | O que fazer | Quem precisa |
|---|---|---|---|
| 1 | Google (Gemini) | Criar um projeto no Google Cloud com e-mail da Nunes, ativar a cobrança com teto de gasto e gerar a chave da API | E-mail + cartão da Nunes |
| 2 | GitHub | Transferir o repositório ou criar uma organização da Nunes | E-mail/usuário GitHub |
| 3 | Supabase | Transferir o projeto para a organização da Nunes (os dados vão junto) | E-mail |
| 4 | Vercel | Importar o repositório numa conta da Nunes e cadastrar as 5 variáveis (nomes no `CLAUDE.md` §0) | E-mail |
| 5 | Servidor | Contratar uma VPS (ou transferir a atual) e rodar `infra/integrator/deploy.sh` com o arquivo de configuração preenchido | E-mail + cartão |
| 6 | Domínio | Criar um subdomínio da Nunes para o motor de conversão e apontar para o servidor | Acesso ao DNS da Nunes |
| 7 | Troca final | Trocar a chave do Gemini e o endereço do motor nas variáveis, publicar e testar uma conversão de ponta a ponta | — |

Depois da migração, as chaves antigas são desativadas. Nenhuma senha deve circular por WhatsApp ou e-mail: cada um cadastra as próprias senhas direto no painel da plataforma.

## 8. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Servidor indisponível" ao converter PDF | Abrir `https://conversor-vps.metodoiqc.com.br/health`. Se não responder, o servidor caiu: reiniciar o container (`docker compose ... up -d`) |
| Conversão parada em "na fila" | O servidor processa um catálogo por vez. Espere o anterior terminar |
| Catálogo muito grande demora ou falha | Use **Cortar PDF** e converta em partes |
| Preço, caixa ou nome errados de um fornecedor inteiro | Primeiro tente uma regra no cadastro do fornecedor. Se não resolver, ajuste no motor (seção 6) |
| Site mostra versão antiga | Clique na barra "Nova atualização disponível" ou recarregue a página |
| Erro do Gemini (cota ou chave) | Ver a cobrança e o teto no Google Cloud. A chave fica só no servidor |

## 9. Onde está cada documento

| Documento | Conteúdo |
|---|---|
| `CLAUDE.md` | Regras de trabalho e **seção 0: infraestrutura** |
| `ARCHITECTURE.md` | Pontos que não podem quebrar (IV-01 a IV-23) e por quê |
| `guide.md` | Histórico técnico de cada correção |
| `SECURITY.md` | Regras de segurança e dependências |
| `CONTINUIDADE.md` | Onde paramos e pendências |
| `docs/historico/` | Documentos antigos, só para consulta |
