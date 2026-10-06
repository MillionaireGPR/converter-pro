# CONTINUIDADE — onde paramos (Converter-Pro / MICHELE_CONVERSOR)

> **Qualquer conta do Claude: leia este arquivo primeiro, depois `CLAUDE.md` e `git log --oneline -10`.**
> Este arquivo diz ONDE paramos e POR QUÊ. A referência técnica fica no `CLAUDE.md`,
> o detalhe de cada correção no `guide.md`, o estado para a IQC Machine no `IQC_STATUS_ATUAL.md`.

## Regras de manutenção (valem para toda sessão)

1. **Pasta certa:** `C:\Users\Gabriel Pantoni\Desktop\Projetos LOVABLE e GITHUB\Converter-Pro-Merged`.
   Existe uma cópia em `...\OneDrive\Desktop\...` SEM git (o OneDrive corrompe o `.git`): nunca trabalhe nela.
   Confirme com `git log --oneline -1` antes de tudo.
2. **Início de sessão:** ler este arquivo + `git log --oneline -10` + `git status`. Se algo aqui
   divergir do repositório, corrija este arquivo ANTES da tarefa.
3. **Fim de cada bloco relevante (ou aviso de troca de conta):** nova entrada no Diário +
   atualizar "Onde parou" e "Próximo passo". Commitar junto com o trabalho e dar push.
4. **Nunca** registrar senha, token, chave ou URL com credencial. Só o NOME da variável.
5. Entradas curtas (3–6 linhas). Detalhe técnico vai para o `guide.md`, não aqui.

## Onde parou (06/10/2026)

- `main` em `f144264` (PR #180). Teste 9 do Josef entregue em 2 PRs: dados (#179) e fotos (#180).
- Código do backend no servidor = código da `main` (conferido por hash em 06/10).
- Frontend na Vercel com o commit `f144264` (deploy de 05/10).
- Resumo e mensagem para o Josef já foram enviados ao Gabriel; falta o Josef reconverter
  os catálogos e conferir.

## Raciocínio e decisões recentes

- **Correção sempre genérica, medida no arquivo** (nunca `if fornecedor == X`). Motivo: cada
  remendo por fornecedor quebrava outro catálogo. Descartado: regras por nome de fornecedor.
- **Validação por A/B sem API:** rodar código antigo × novo sobre PDFs e resultados de jobs
  reais já gravados no servidor; aceitar só quando tudo o que muda é item da lista do Josef.
  Motivo: poupar Gemini (~R$100 já gastos). Descartado: reconverter catálogos inteiros a cada ajuste.
- **Assinatura (#178) nasce DESLIGADA.** InfinitePay não tem recorrência na API, então é um link
  por período e o pagamento é reconferido na InfinitePay (webhook não é assinado).
- **PETRIN fotos (15) ficou de fora do #180:** a tentativa mudava fotos que estavam certas.

## Configurações em andamento (só nomes, nunca valores)

- **Backend primário:** VPS Integrator (`conversor-vps.metodoiqc.com.br`), deploy por `scp` + `docker compose`
  (passo a passo em `infra/integrator/README.md` e no `CLAUDE.md`). Chave SSH local: `~/.ssh/converter_pro_integrator_ed25519`.
- **Render (reserva, `VITE_BACKEND_URL_FALLBACK`):** em 06/10 responde "Service Suspended". O failover
  para ele não funciona enquanto estiver assim.
- **Gemini:** `GEMINI_API_KEY` no `.env` local e no servidor. Teste que chama a API = custo: só com aval.
- **Banco:** `SUPABASE_DB_URL` em `.env.local` (nunca imprimir).
- **Billing:** tabelas `app_assinatura*` em produção, estado `desligada`. Para ligar: checklist em `guide.md #17`.
- **Versão em `/health`:** continua `2026.08.25-v52-...` porque `SERVICE_VERSION` não é incrementado
  a cada deploy. Para saber o que está no ar, compare o hash dos arquivos (não a versão).

## Pendências

**Esperando o Gabriel / Josef**
- Josef: reconverter GIRA (4), Goal, Tuka, FORTAL, Lila, Neo, DUTE, DAGIA, FOLIA (2) e BM36 e conferir.
- Josef: como separar BM36 × World Classic (o código 439890 não tem prefixo).
- Gabriel: ativar "Checkout externo" na InfinitePay, preencher a InfiniteTag no painel e ligar a assinatura.
- Gabriel: decidir o Render (reativar como reserva ou tirar do failover).
- Gabriel: decidir a pasta solta `_IQC_STATUS_UPDATE_MICHELE_CONVERSOR_PR73/` (pacote de status antigo
  do PR #73, 6 arquivos .md). `scripts/server-ops/` (token Cloudflare + cópia de DNS) agora fica
  inteiro ignorado pelo git; nada foi apagado.
- **Cobrança só começa com "100% funcional"**: critério = Josef aprovar a reconversão do Teste 9
  sem erro novo nos 15 fornecedores. Até lá, poupar API (rodar só páginas, nunca o catálogo inteiro sem aval).

**Em investigação / próxima rodada (sem custo de API para medir)**
- Fotos: PETRIN (15), GIRA Malas/Papelaria (foto de grupo), DUTE pedaços de layout + 3 fotos, Neo restante.
- Neo: quantidade das caixas do kit de Natal (61), cor do nome × bolinha (47), 82775.
- Outros: GIRA TP1792 (código só na imagem), GIRA Malas sem 20", FORTAL YM-09/10, FOLIA GEL→GELO e PESTISQUEIRA.
- Recurso "Solicitar ajuste" no painel: só proposta, aguarda o Gabriel.

## Próximo passo

Aguardar a reconversão do Josef. Enquanto isso, a próxima rodada técnica sugerida é a PETRIN (fotos),
medindo com A/B sem API sobre os jobs do Teste 9 já gravados no servidor.

## Diário

- **06/10/2026** — Criado este arquivo e `.claude/settings.json` (só comandos de leitura/teste).
  Verificado: servidor = `main` (hash), Vercel = `f144264`, testes sem API passando
  (vitest 494/494 na 2ª rodada; a 1ª teve 1 falha intermitente; pytest 141 sem os 2 scripts manuais `test_cv.py`/`test_e2e.py`, que pedem PDF local).
  Achado: Render suspenso. Nenhum segredo versionado.
- **05/10/2026** — PR #180 (fotos do Teste 9) mergeado e no servidor.
- **04/10/2026** — PR #179 (dados do Teste 9) mergeado e no servidor.
