# Instruções para Claude (e qualquer agente assistente)

---

## 📍 ONDE PARAMOS — 18/09/2026 (leia primeiro se está retomando)

> Para um agente NOVO assumir sem reler o histórico. Detalhe técnico em
> `guide.md #14.5` a `#14.12`; estado operacional completo em
> `IQC_STATUS_ATUAL.md` (esse é a fonte de verdade — este resumo aponta pra ele).

### Os 6 problemas que o Josef reportou, MAIS o que ele achou na retestagem — tudo resolvido e em produção

| PR | O que resolveu | Prova no arquivo real |
|---|---|---|
| #130 | Petrin/Dute: o sistema escolhe sozinho a aba do Excel com o catálogo (os fornecedores trocaram a 1ª aba por formulário de pedido) | Petrin `Pedido`→`Tabela` = 831 produtos; Dute `BLOCO`→`TABELA ATUAL` = 729 |
| #131 | (a) preço trocado/ausente — a IA lia o texto SEM a posição; (b) `IMG-GEN` — upload das fotos morria aos 180s fixos; (c) sair da tela apagava as conversões em andamento | Dute 12/24→**24/24** preços, TUKA 0/4→**4/4**, FORTAL 24/24 sem regressão. Catálogo Dute inteiro: 651 produtos, 557 preços, **0 erro de preço** (eram 353) |
| #132 | FOLIA: PDF sem produtos na camada de texto (só marca d'água) → rota de VISÃO | **18 produtos / 0 válidos → 288 produtos / 288 com preço**; gabarito lido à mão 9/9 |
| #134 | Dute: composição de imagem pegava só uma peça do produto | **651/651 imagens associadas**, 0 sem match, 0 recorte com lado <80px (eram 611, com saídas de 39×59px) |
| #135 | FOLIA: casamento de foto pelo cartão visual (não existe texto de SKU no PDF). FORTAL: `R$ 72,00` da caixa entrava como preço unitário no lugar do `UND: R$ 7,20` | Folia **367 produtos / 367 imagens / 0 sem imagem**; Fortal **81 preços de caixa corrigidos** em 949 produtos (ex.: `BDZ-2523` 72,00 → 7,20) |
| #138 | FOLIA: a foto vinha com o PREÇO impresso dentro dela (card = 1 imagem só, arte e dado são a mesma coisa) — Josef: "não pode, gera divergência quando o preço muda" | Recorte por pixel pela cor da borda; **298/298 cards do catálogo real** cortados, 0 sobra de preço/texto |
| #140 | DUTE: mesmo defeito do #138, causa diferente — a composição (embalagem+brinquedo) usa a UNIÃO de vários objetos de imagem; quando ficam na diagonal sobra espaço morto onde o preço/título (texto real da página) está desenhado, e a união virava recorte do RASTER da página, trazendo esse texto junto. Achado pior no meio da validação: algumas imagens têm retângulo declarado no PDF muito maior que a página (chega a começar em coordenada negativa, pág. 34 "livro sensorial") — engolia o produto vizinho inteiro, preço incluso | Máscara por retângulo de cada imagem (pinta de branco o que não é imagem) + descarte de retângulo >20% fora da página; **649/649 SKUs do catálogo real**, 0 unmatched, 0 vazamento nas amostras inspecionadas |
| #143 | **PETRIN/LEVIVAN/FORTAL — a raiz do "tudo que funcionava quebrou".** Cada fornecedor novo virava um `if fornecedor == X`; o layout do próximo não batia com a premissa embutida e o que já rodava quebrava. Trocado premissa por MEDIÇÃO: orientação da foto (a PETRIN põe código em cima e foto embaixo — 142 SKUs sem imagem e o selo "PREÇO REDUZIDO" virando foto de produto), piso de tamanho pra ser foto, costura de fotos fatiadas (LEVIVAN LV1052), "EM BREVE" genérico (era travado na DAGIA), dedup por código+descrição (FORTAL repete o 5085) e tamanho de fonte chegando até a IA (nome em 2 linhas virava código) | PETRIN **142 → 48** sem imagem (798 SKUs); LEVIVAN **73/73**; A/B real na FORTAL corrige `36-30`→`MULTIUSO` em 2/2 rodadas, com **regressão zero** em TUKA/LEVIVAN/PETRIN. Detalhe em `guide.md #14.14` |
| #133, #136 | Documentação (deploy do Integrator é por `scp`, não `git pull`) | — |
| #148 | **GIRA — preço trocado entre 3 produtos de nome idêntico** ("KIT 6 PORTA-COPOS BAMBU"), achado direto no `status.json` real de produção (não em arquivo pedido ao Josef) — corrige a conclusão errada do #145/#146. **FOLIA — 331 vs 288 fotos**: confirmado como falha pontual da IA numa única página (9/9 ao reprocessar), não bug. **Observabilidade**: todo job passa a gravar `supplier`; nome duplicado no lote vira aviso no próprio resultado | GU0132/TP1679/TP2003 tinham os 3 preços rotacionados entre si no job real; reprocessado com o prompt corrigido. Página 39 da Folia: 0/9 na produção, 9/9 ao reprocessar duas vezes (dias diferentes) — confirma falha transiente |
| #145 | **FOLIA e afins — preço PROMOCIONAL em coluna própria** (TABELA + PROMO lado a lado no Excel) era extraído mas nunca decidia o preço final: 63/64 produtos com promoção saíam com o preço cheio. **VAESO — corrida "última gravação vence"** ao escolher as 3 tabelas de preço extra em sequência rápida na tela: cada escolha mesclava em cima de um `columnMappings` que só atualiza DEPOIS do round-trip do Supabase, e a gravação que resolvesse por último apagava as outras duas | Preço: guarda de magnitude (promo < tabela) — protege NEO FESTAS, que reusa o mesmo nome de coluna pra preço de KIT (maior, não desconto). VAESO: teste prova que o código antigo falha (3ª gravação apaga as 2 primeiras) e o novo (merge síncrono em ref + fila por fornecedor) passa mesmo com respostas de rede fora de ordem |
| #153 | **BM36 — nome trocado com o produto vizinho (13/13 amostras do Josef).** `_apply_template` fatiava o bloco a partir do código pra frente, mas nesse catálogo o nome vem ANTES do código; e a classe de caractere que a IA sintetiza pro nome corta acento/minúscula. Fix genérico no motor `template-synth` (busca bidirecional + `_widen_nome_capture`), sem `if BM36` | Catálogo real 140 págs: **1188 produtos (= total do Josef), 99,3% com nome**, `BM361552` sai "FACA PATE C/4 -15cm DOURADO" |
| #154 | **PETRIN — preços trocados entre vizinhos (a IA passava o preço da coluna direita pro código "EM BREVE" da esquerda).** `_verify_prices_by_geometry` MEDE a posição código→preço no catálogo e corrige só o inequívoco; catálogo sem padrão não é tocado | Petrin **62 preços corrigidos (Josef pegou 12) — os 12 dele 12/12**; regressão real em Fortal (6 latentes corrigidos, unitário preservado), Dute/Dagia/Gira/Folia 0 mudanças. Detalhe em `guide.md #14.18` |
| #155 | **DUTE — 31 códigos ativos sumiam da exportação + DTY0730 vazando foto.** (a) `shouldExclude` aplicava `total\|subtotal\|soma` ao texto todo do produto e "(Total 144 UND)" derrubava 37 válidos: linha com código não é linha de total; (b) linha da página com 1 produto ganhava a largura inteira e engolia a foto do vizinho: usa a faixa da própria coluna quando as colunas são consistentes | Dute **614 → 651/651** produtos e **651 fotos (eram 614)**, 24 fotos sem vizinho; 6 testes novos + caso pág. 162. Detalhe em `guide.md #14.19` |
| #160 | **VAESO — as 3 tabelas extras (V50/V250/V.R.) não saíam na exportação (0 de 178 linhas).** A extração estava certa (verificado com a planilha real), mas a base padronizada (`Produto`) descartava `precosTabela`/`camposMercos` e a tela de Exportações montava o produto sem eles. Agora atravessam `addProdutosNormalizados` → estado → exportação; persistem em `standardized_products.mercos_extras` (migration `20260918_...`), com fallback se a coluna ainda não existir | Teste `ProdutosContext.tabelas-extras.test.tsx` (com e sem a coluna) + `engine.tabelas-extras.test.ts` (2ª causa achada em 21/09 no teste real: `processarArquivoV2` também descartava `precosTabela`/`camposMercos` no formato de compatibilidade); `npm run verify` 481 testes. **Aplicar a migration no Supabase para persistir após recarregar.** Detalhe em `guide.md #14.24` |
| #162 | **VAESO (PDF, teste real 21/09) — fotos deslocadas em 29 produtos e 5 sem foto, com o relatório dizendo "157 associadas".** Caminho EMBEDDED (`_match_via_embedded`): com a foto ACIMA do código, o código de cada cartão fica quase equidistante da miniatura de cima (a dele) e da de baixo, e o casamento por distância absoluta pegava a de baixo (PUMF0002 Rosé saía com a foto Pistache; o 7º item sobrava sem foto). Mesmo defeito do #158, em outro caminho | `orientacao` passa a chegar ao embedded; foto que começa abaixo do código ganha +100 no score quando a orientação é "acima" (desempate suave, não veto) | Teste `test_embedded_foto_acima_empate.py` (geometria real da pág. 25); A/B contra o código anterior: VAESO 29 fotos mudaram (conferidas visualmente: todas corretas agora), 162/162 casadas; DAGIA, DUTE, FOLIA, GIRA, BM36 e FORTAL sem nenhuma diferença (o A/B da FORTAL pegou uma 1ª versão que reprovava o HL186-B; o desempate agora só reordena, sem mexer no teto). Detalhe em `guide.md #14.25` |
| #163 | **BM36 (retestagem Josef 22/09) — BM362346 não saía na exportação.** No catálogo o preço vem com asterisco de rodapé marcando promocional (`B8460*B10152**`, "B" = glifo quebrado de "R$"); o PRECO regex sintetizado no `template-synth` nunca viu essa variante na amostra e não batia com o "\*" no meio do número, então o produto ficava sem `preco` e caía como erro silencioso (sem disparar o fallback AI-first, que só olha cobertura de nome/qtd/código) | `extract_via_template` remove `*` do texto de TODAS as páginas antes de sintetizar e aplicar o template — asterisco de rodapé nunca carrega valor pros campos CODE/NOME/PRECO/QTD, fix genérico (não é `if BM36`) | `test_preco_asterisco_promocional.py`: com o texto real da pág. 37, prova que SEM o fix o produto fica sem `preco` (reproduz o bug) e COM o fix sai `84.60`; suíte Python 44/44 sem regressão |
| #164 | **BM36 (retestagem Josef 22/09) — WC410004 (pág. 119) saía sem foto.** O PDF desenha a MESMA imagem embutida (mesmo xref) em 2 células diferentes (WC410003 e WC410004 são frascos com a foto idêntica reaproveitada). `_match_via_grid` dedupava imagem "já usada" pelo XREF — a 2ª posição da mesma imagem contava como consumida pela 1ª e o 2º produto ficava sem foto (`no_img_in_col`) | Dedup trocado de `xref` pra `id(img)` (identidade do dict de cada posição) em toda `_match_via_grid`/`_foto_principal_da_celula` — cada posição desenhada na página é uma foto elegível independente, mesmo repetindo o recurso de imagem. Fix genérico, não específico de frasco/BM36 | `test_xref_duplicado_2_posicoes.py` com a geometria real da pág. 119 (2 imagens, mesmo xref, posições diferentes): 6/6 casadas (era 5/6). Mudança é estritamente uma RELAXAÇÃO da regra de dedup — nunca pode remover um match que já funcionava, só resgatar os que eram rejeitados à toa; suíte completa sem regressão |
| #165 | **FOLIA (retestagem Josef 22/09, catálogo Utilidades 300 produtos) — 113 produtos sem foto + 12 códigos com "50" virando "S0".** (a) `_costurar_tiles` (costura fatias de foto cortada pelo exportador, achado no LEVIVAN) juntava 2-3 cards QUADRADOS independentes de 192×192 que só ficam a ~2pt um do outro no layout de grade — 3 fotos de produtos diferentes viravam 1 imagem só; (b) catálogo é 100% Gemini Vision (sem camada de texto) e a leitura do dígito "5" saiu como a letra "S" em alguns cartões isolados, mesmo com "50" certo em 294 de 297 códigos do mesmo segmento | (a) `_costurar_tiles` só une pedaços de TAMANHO DIFERENTE (fatiamento real do LEVIVAN é assimétrico; tamanho igual = grade de produtos diferentes, mesmo com 2 só); (b) `_fix_ocr_digit_letter_confusion` corrige letra→dígito só quando o resultado bate com a MAIORIA dos próprios códigos do lote (evidência do catálogo, não lista fixa por fornecedor) | Reprodução real via POST em `/extract_products_ai` + `/process` contra o catálogo do Drive: fotos sem match **113 → 3** (297/300); os 3 "S0" do lote real **3/3 corrigidos**. `test_grade_de_cards_do_mesmo_tamanho_colados_nao_e_costurada` + `test_par_de_cards...` (geometria real pág. 3) e `test_ocr_digito_letra.py`; LEVIVAN (`test_fatias_contiguas_da_mesma_foto_viram_uma_imagem_so`) e BM36 sem regressão |
| #166 | **PETRIN (retestagem Josef 22/09) — RD1602 saía com preço errado (R$35, do vizinho RD1604), e o par "DE R$16 POR R$8" impresso perto dele ia parar no RD1098-1, bem mais longe na página.** A IA seguia a ORDEM em que leu o texto, não a posição — o rótulo DE/POR mais próximo geometricamente do código nem sempre é o próximo a ser lido | `_fix_labeled_promo_price` mede a posição real (`page.get_text("dict")`) dos rótulos "DE"/"POR" e atribui o par ao código com o retângulo de busca (`page.search_for`) MAIS PERTO deles na página, não ao primeiro da leitura. Fix genérico — qualquer catálogo com rótulo DE/POR impresso se beneficia, sem `if PETRIN` | `test_promo_de_por.py` com a geometria real da pág. 163 (rótulo perto do RD1602, RD1604 sem rótulo fica intocado). Rodado contra o catálogo real (800 produtos): **1 mudança (RD1602: 35,00 → 16,00/8,00)**, 0 mudanças no DUTE (sem falso positivo); suíte Python 52/52 sem regressão |
| #167 | **Supabase Storage no limite (22/09/2026) — bucket grátis de 1GB em 1,71GB, alerta de "Organization exceeded its quota" com corte previsto pra 21/10.** Cada job de `/process` sobe um ZIP em `{jobId}/imagens_extraidas.zip` e nunca apagava — mês após mês de catálogos testados foi enchendo o bucket sozinho (o usuário já baixa o ZIP na hora; não precisa ficar guardado) | `cleanup_old_storage_files` (`storage.py`) lista o bucket pela própria API do Storage (sem depender de nenhuma tabela) e apaga ZIP com mais de `STORAGE_RETENTION_DAYS` (padrão **3 dias** — pedido explícito do usuário: histórico curto, o cliente baixa na hora). Roda sozinho 1x/dia em thread de fundo desde o boot do processo, mais `POST /admin/storage/cleanup` pra disparar na mão | `test_storage_cleanup.py` (3 testes com dublê da API do Storage: só apaga o que passou da retenção, não mexe em nada quando não há nada vencido, ignora com segurança arquivo sem data). **Rodado em produção**: bucket real (live) caiu de 295,6MB → **78,4MB**. O "1,69GB / 169%" que continuou aparecendo no painel do Supabase depois do 1º deploy (retenção de 10 dias) é a MÉDIA do ciclo de faturamento (20/09-20/10) puxada pelos 2 dias iniciais de estouro antes do fix — não dado ao vivo; cai sozinha a cada dia que o armazenamento real fica baixo. Detalhe em `guide.md #14.30` |
| #168 | **Base cortada em 1000 produtos + limpeza de telas sem função (23/09/2026).** (a) `ProdutosContext` carregava `standardized_products` com um `select('*')` só — o Supabase devolve no máximo 1000 linhas, então depois de recarregar a página a Base Padronizada, a Exportação Mercos e o Dashboard viam só 1000 de 6275 produtos (produto "sumindo" da exportação sem erro nenhum). (b) `suppliers.total_products` SOMAVA a cada conversão, mas a conversão SUBSTITUI os produtos do fornecedor (MOMENT mostrava 102.042; real 1.484). (c) Telas sem função real: botão "Seed Dados Base" (injetava 16 fornecedores de referência — contra a regra de não amarrar nada a fornecedor), sino de notificação com ponto vermelho fixo, campo "Buscar..." do topo sem ação, página Configurações com CNPJ/telefone fictícios e botão Salvar que não salvava nada | (a) carga paginada com `.order('id').range()` em lotes de 1000; (b) `total_products = count` da conversão (não soma) + correção única no banco para a contagem real; (c) removidos botão/`seedSuppliers`, sino, busca e a página `/configuracoes` (rota + menu) | Consulta real no Supabase: sem paginar 1000, paginado **6275 = total da tabela**; totais dos fornecedores corrigidos em 32 linhas (8 com produtos, somando exatamente 6275). `npm run verify` 482/482 |
| #169 | **Fornecedor novo — tratamento do catálogo deixa de depender do NOME (23/09/2026)**, antes do Josef apagar os fornecedores antigos e recadastrar. Havia 6 comportamentos ligados por nome: FOLIA (grade de cards sem texto + releitura de N cards), FORTAL (preço `UND:`), GOAL KIDS (prefixo `GK`), DUTE (foto montada por várias imagens) e DAGIA (IA escolhe a foto). Recadastrar com outro nome desligaria tudo sem aviso | 4 viraram DETECÇÃO no próprio arquivo (`_detectar_grade_de_cards`, releitura de cards em qualquer catálogo sem texto, `_fix_labeled_unit_prices`, `_fix_missing_code_prefix` pela maioria do lote). DUTE e DAGIA viraram OPÇÕES no cadastro (`suppliers.opcoes_catalogo`, migration aplicada, DUTE/DAGIA atuais já marcados): medido em 9 catálogos, a PETRIN fica perto demais do DUTE pra decidir sozinho (0,28 × 0,19 de imagens sobrepostas) e o AI picker custa 1 chamada/página | A/B sem API — código anterior com nome real × código novo com nome neutro, MD5 de cada foto: BM36 1188, DAGIA 70, DUTE 650, FOLIA 288+297, GIRA 177, PETRIN 787, VAESO 146, FORTAL 943, **0 diferentes**. `UND:` sem nome: FORTAL os mesmos 82 preços, outros 8 catálogos 0 mudanças. Ainda por nome: dicas de extração (`SUPPLIER_HINTS`) e leitores de planilha — ver `guide.md #14.32` |
| #170 | **Retestagem do Josef após o recadastro (23/09/2026)**: FOLIA exportando o card inteiro com preço; BM36 BM361548 com o nome do vizinho BM362770 e ímãs GH-1/GH-2BI fora; PETRIN RD1820 com o preço do vizinho RD1819 | FOLIA: o detector de grade (#169) usava "SKU sem posição" como prova de código fora do texto, mas a leitura por visão dá posição a todo produto → agora mede o TEXTO do PDF. BM36: `_apply_template` mede de que lado do código fica o nome (antes/depois, >=80%) e aceita códigos com o mesmo rótulo do CODE regex (`CD: `) quando o bloco tem preço (`_codigos_fora_do_padrao`, trava de 10%). PETRIN: `_verify_prices_by_geometry` aceita preço ÚNICO do card um pouco fora da janela quando nenhum outro código está mais perto (`_preco_mais_perto_de`) | FOLIA com posições reais de produção: grade detectada, 297/297 fotos idênticas ao código pré-#169 com nome FOLIA; detector nos 9 catálogos só marca as 2 FOLIA. BM36 template real: +GH-1, +GH-2BI, +439890 (produto real que também sumia), BM361548 com o nome certo, 1257 outros idênticos. Geometria nos 9 catálogos: só RD1820 muda (19,00→12,80). 67 testes backend. Ver `guide.md #14.33` |
| #159 | **GIRA — os 3 preços trocados voltaram ("KIT 6 PORTA-COPOS BAMBU").** A conferência de preço por geometria (#154) só reconhecia preço com "R$"; a GIRA imprime o preço solto no fim da linha ("10cm CX50 6,95"), então nunca rodava. Sem nenhum "R$" na página, agora reconhece o último número com 2 casas no fim da linha (dimensão "13,5*34cm" não conta) | GIRA: 6 preços corrigidos, os 3 do Josef + 3 outros, todos conferidos no texto do PDF; Dagia/Dute/Folia 0 mudanças, Fortal igual (6 já existentes). Detalhe em `guide.md #14.23`, teste `test_price_geometry_sem_rs.py` |
| #158 | **BM36 — foto trocada em rodízio (elefante↔abacaxi↔dog).** Em catálogo com foto ACIMA do código, a distância era em valor absoluto: a foto do cartão de baixo (começa 22pt DEPOIS do código) ganhava da foto do próprio cartão (42pt acima). Foto que começa depois do código agora só vale se nenhuma foto acima/sobreposta casar | Os 5 códigos citados pelo Josef corrigidos; BM36 inteira: 30 de 1187 fotos mudaram; Dagia 0 e Fortal 0 mudanças (939 fotos). Detalhe em `guide.md #14.22`, teste `test_foto_acima_proxima.py` |
| #157 | **PETRIN — 9 fotos trocadas com o vizinho.** Catálogo com foto abaixo do código agrupava imagem por coluna de X: a foto principal longe em X perdia para o zoom perto do código. Agora a foto é a maior imagem da CÉLULA do produto (código → próximo código) | Petrin sem imagem 47 → 14; os 9 do Josef corrigidos; 343 SKUs mudaram de foto (amostra conferida). Detalhe em `guide.md #14.21`, teste `test_foto_celula_abaixo.py` |
| #156 | **BM36 — 137 produtos que não saíam na exportação = nome vazio** (o export descarta produto sem nome). Nome que o template-synth não casava (código sozinho na linha / bloco sem EAN) agora usa a última linha de texto antes do código, só quando ficaria vazio | 137 → **0 nomes vazios**, 0 nomes existentes alterados no catálogo inteiro (1188); páginas 71/92 travadas em `test_bm36_nome_shift.py`. Detalhe em `guide.md #14.20` |

**Retestagem do Josef em 17/09 — o que ainda está aberto** (métrica pra cada um no guide): BM36 foto trocada (21/21) [corrigido no #158: a foto do cartão de BAIXO ganhava da do próprio cartão; conclusão anterior de 18/09 "era só o nome" estava ERRADA — Josef reconfirma] [137 sem exportar → corrigido no #156]; [PETRIN 9 fotos trocadas → corrigido no #157]; FOLIA 338 produtos sem foto (séries JRF-50/20/30/90); [VAESO 3 tabelas extras → corrigido no #160]; [GIRA 3 preços trocados → corrigido no #159].

**Diretriz do Gabriel (18/09):** o objetivo NÃO é remendar cada fornecedor que já existe — é o fluxo de "fornecedor novo" funcionar sozinho. Ao investigar um erro, procurar a causa estrutural GENÉRICA, e validar como fornecedor novo (mini-teste com um pedaço do catálogo real), medindo antes de mexer. Foi assim que #153 e #154 saíram sem nenhum `if fornecedor == X`.

Confirmado pelo cliente:
- 11/09: **TUKA TOYS 335/335 produtos, 326 imagens** (era "rodando sem retorno" 39min).
- 15/09: **FORTAL "processou e rodou certinho com valor das unidades"** — ele mesmo retestou o #135 e aprovou.
- 16/09: Josef reportou o Dute com "relatório de erros" (88 SKUs sem campo
  obrigatório, `relatorio_erros_2026-09-16.xlsx`) **e** "as imagens várias
  pegaram o preço junto" → o segundo é o #140, corrigido e em produção no
  mesmo dia. O primeiro **não é bug**: conferidos os 88/88 SKUs contra o PDF
  real, todos têm "EM BREVE" no lugar do preço na própria página do
  catálogo — produto que o Dute ainda não lançou/precificou. O sistema
  corretamente recusa gravar um produto sem preço.

### ⛔ O que está aberto (é por aqui que se retoma)

**A retestagem do Josef de 17/09 reabriu bugs reais** (lista logo acima da tabela: BM36 foto/137 sumindo, PETRIN foto, [DUTE 31 sumindo → corrigido no #155], FOLIA 338 sem foto, VAESO tabelas extras, GIRA). Além disso, verificação e limpeza:

1. **Josef ainda não confirmou** o #138 (preço fora da foto na Folia), o #134
   (composição do Dute), o #140 (preço do vizinho na composição do Dute) nem o
   #143 (PETRIN/LEVIVAN/FORTAL). Peça pra rodar os quatro de novo.
1b. **CORRIGIDO EM #148 — GIRA: preço trocado entre 3 produtos de nome
   idêntico.** A conclusão anterior aqui ("não achei mecanismo do sistema,
   provável erro na planilha do fornecedor") estava **ERRADA** — só foi
   possível perceber o erro porque o Gabriel pediu pra checar o `status.json`
   real do job de produção (`ssh` + `/opt/converter-pro/data/temp/<job>/`)
   antes de pedir qualquer arquivo novo pro Josef. O resultado gravado tinha
   os 3 preços rotacionados EXATAMENTE como ele reportou (GU0132↔TP1679↔TP2003)
   — bug real na extração via IA (o catálogo é lido como PDF/texto, não pela
   planilha genérica que eu tinha investigado). Ver `guide.md #14.16`.
1c. **CONFIRMADO EM #148 — FOLIA: falha pontual da IA, não bug de código.**
   Achei o job de produção real da Folia no servidor, comparei página a
   página a contagem medida de cards vs produtos que a IA retornou: bateu em
   43 das 45 páginas. A única divergência real foi a página 39, que voltou
   com ZERO produtos numa página de 9 cards legítimos — reprocessei essa
   página agora contra a API real (e achei outro job de produção da mesma
   página, de outro dia) e ambos vieram 9/9 corretos. Foi uma falha pontual
   da chamada à IA naquele momento, não algo reproduzível. Nada a corrigir
   em código; mitigado por observabilidade (ver 1d). Ver `guide.md #14.16`.
1d. **Observabilidade dos jobs (#148):** todo job agora grava `supplier` no
   `status.json` (antes só tinha contadores, forçando adivinhar o fornecedor
   pelo padrão do código de SKU pra achar o job certo), e nomes duplicados no
   mesmo lote de extração via IA ficam sinalizados no próprio resultado
   (`avisosNomeDuplicado`) — visível na tabela de jobs do
   `/admin/dashboard` sem precisar entrar via SSH. **Use isso primeiro** da
   próxima vez que o Josef reportar um erro: `ssh` no Integrator, achar o job
   pelo fornecedor/timestamp em `/opt/converter-pro/data/temp/<job>/status.json`
   (ou `/admin/jobs`), e SÓ pedir arquivo novo pro Josef se o que já foi
   gravado não bastar.
2. **PETRIN: 48 SKUs ainda sem imagem** (eram 142) — 35 `no_img_in_col` +
   13 `no_plausible_match`. NÃO investigado ainda se é layout sem foto,
   produto realmente sem imagem no catálogo, ou lacuna restante do
   casamento. **Meça antes de mexer**: rode o catálogo inteiro e olhe as
   páginas dos que falharam, como está descrito no método abaixo.
3. **REGRA DE ARQUITETURA (vale pra toda extração daqui pra frente):** o que
   varia entre fornecedores é **medido no arquivo**, nunca declarado num
   `if fornecedor == X`. Antes do #143 havia 3 capacidades prontas trancadas
   num fornecedor só (composição no Dute, "EM BREVE" na DAGIA, orientação
   fixa pra todos) — era exatamente isso que fazia catálogo novo quebrar
   catálogo velho. Se precisar de um ramo por fornecedor, primeiro procure o
   sinal que dá pra medir.
4. **LEVIVAN** — último dado conhecido: 73 imagens casadas contra 53 códigos e
   20 produtos excluídos por falta de preço. É anterior ao #131 (preço por
   coordenada) e ao #134, então **provavelmente já melhorou sozinho**.
   **Meça antes de investigar** — não abra código sem número novo.
5. **Produção assistida (combinado com o Gabriel):** rodar catálogos reais,
   inclusive >100MB, e teste de carga. **Não desligar o Render** até ele
   encerrar esses testes. Quando o servidor do Wesley voltar, comparar se tem
   algum perfil Phase 0 a mais.
6. **Limpeza não bloqueante — PARCIAL em 18/09/2026:** `cf_tunnel_watcher.sh`
   e `update_vercel_backend_url.py` (obsoletos desde o túnel nomeado do #120)
   foram apagados do repo. **Não verificado**: se o processo do Quick Tunnel
   antigo ainda roda no servidor do Wesley — não existe credencial de SSH
   documentada pra esse host (só o `monitor_wesley_token` que a Integrator
   usa pra ler status), então matar o processo em si ainda depende de acesso
   direto a essa máquina.
7. **Achado durante a validação do #140, NÃO corrigido ainda** (baixa
   severidade, não é preço): ~10% das composições Dute cujo produto fica na
   última linha de uma página têm a foto genuinamente colada na faixa de
   navegação de categorias do rodapé da página (ex.: `DT10371` pág. 6,
   `DT10221` pág. 89) — a foto real (não texto solto) se estende até ali, e
   a máscara do #140 preserva tudo que é imagem legítima, então a faixa de
   categorias aparece na base do recorte. Tentei um detector de rodapé por
   cor de pixel (queda pra ~0% não-branco seguida de salto pra >70%, muito
   consistente: 539-540pt em 27 de 29 páginas testadas), mas achei 1
   falso-positivo (pág. 162, disparou em y=452 sem rodapé real ali) — não
   confiável o suficiente pra arriscar cortar foto de produto de verdade.
   Ver `_filtrar_imagens_fora_da_pagina` e `_crop_composition_masked` em
   `cv_extractor.py` antes de tentar de novo.

### O método de validação que funcionou — repita, não invente outro

Tem `GEMINI_API_KEY` no `.env` local (gitignored, nunca imprima).

1. Baixe o PDF real do servidor — ficam 21 dias em
   `/opt/converter-pro/data/temp/<job>/input.pdf`.
2. Renderize a página com PyMuPDF e **leia a imagem você mesmo** para montar um
   gabarito à mão.
3. Rode A/B contra esse gabarito com a API real, e só então deploye.
4. Sempre que der pra medir estruturalmente (não só amostra), rode contra o
   catálogo INTEIRO — foi assim que o #138 achou seu próprio bug antes do
   Josef: testar 47 cards escolhidos à mão deu 100% de acerto, mas rodar os
   298 cards reais (as 45 páginas inteiras) achou 1 caso com nome de produto
   mais largo que quebrava a lógica original. Amostra pequena esconde o
   outlier; o catálogo inteiro não. O #140 repetiu o padrão: os 2 primeiros
   casos reportados (`DTY1364`, `DTE0338`) pareciam corrigidos com a máscara
   simples, mas rodar os 649 SKUs do catálogo achou um caso MUITO pior
   (`DT10235` saindo com o preço do produto vizinho inteiro) que só aparecia
   numa página com imagens de retângulo deformado — nenhuma amostra pequena
   ia pegar isso por acaso.

Foi esse método que revelou coisas que nenhum teste sintético pegaria: com 4
páginas por chamada de visão o modelo **inventava os códigos** (0/9) enquanto
os preços saíam certos; a 110 DPI ele lia `JRF-10.3090` onde estava
`JRF-10.1090` — um dígito e o produto vira outro; e um algoritmo de corte que
procura o FIM de uma faixa de texto varrendo de baixo pra cima é frágil (texto
largo cria falso-positivo), enquanto procurar a ARESTA de cima (sempre reta,
sem ruído) não é. Hoje: **1 página por chamada de visão, 160 DPI**.

### Infra — o essencial que mudou

- **O primário é o Integrator** (`conversor-vps.metodoiqc.com.br`), não o
  Render. Failover: 1º Integrator → 2º Render → 3º Wesley (porta fechada).
- **SSH:** `ssh -i ~/.ssh/converter_pro_integrator_ed25519 root@23.80.89.90`
- **Deploy do backend é por `scp`**, não `git pull` — `/opt/converter-pro/repo`
  NÃO é checkout Git. Passo a passo em `infra/integrator/README.md`. Sempre
  rode `sed -i 's/
$//'` no que copiar (checkout Windows grava CRLF).
- **Frontend:** Vercel, deploy automático no merge em `main`.
- **Domínio:** `metodoiqc.com.br` na Cloudflare com túnel nomeado permanente.
- ⚠️ **Perfil Phase 0 pode envenenar um fornecedor.** O da FOLIA foi gravado a
  partir da marca d'água (definia *"código = número inteiro sozinho na linha"*)
  e está em quarentena no servidor como
  `supplier_profiles/FOLIA_BRINQUEDOS.json.envenenado-20260911.bak`.
  **Sintoma:** códigos extraídos que são números de página. Primeiro lugar a
  olhar: o perfil em cache.

### Princípio que o Gabriel fixou e vale pra tudo aqui

> *"Se o cliente não colocar nenhum dado novo sobre onde estariam os dados
> corretos, o certo seria que o próprio sistema fizesse a identificação. A
> diferença entre ele colocar é que daríamos uma direção a mais pra IA. Agora
> se ele não preencheu e o sistema simplesmente falhar e quebrar, não tem o
> menor sentido."*

Todas as correções acima seguem isso: o sistema descobre sozinho a aba certa, a
posição do preço, se o PDF tem texto, qual foto é do produto, e agora também
onde a foto termina e a etiqueta de preço começa. Configuração do cliente é
reforço, nunca pré-requisito.

---

## ⚠️ ANTES DE QUALQUER MUDANÇA — LEIA

Este projeto teve uma sessão difícil de debug em 27/05/2026 que afetou
o cliente (Nunes Representações). Vários bugs em produção foram corrigidos
em sequência (PRs #7 a #11). A entrega NIX HOUSE finalmente funcionou:
285 produtos, 91 preços via Gemini em ~60s, 0 erros, R$ 0,65 de custo.

**Sua MISSÃO PRIMÁRIA**: não quebrar o que está funcionando.

## 🔒 Leitura obrigatória

Antes de tocar qualquer arquivo, leia:

1. **`ARCHITECTURE.md`** — invariantes IV-01 a IV-23 que NÃO podem mudar
2. **`scripts/verify-invariants.mjs`** — o verificador LOCAL (`npm run verify`) que trava tudo
3. **`src/core/__tests__/regression-locks.test.ts`** — testes que travam esses invariantes

Se sua mudança vai tocar:
- `backend/image_extractor/gemini_extractor.py` → IV-01, IV-04, IV-10, IV-15, IV-18
- `backend/image_extractor/main.py` → IV-02, IV-03, IV-11, IV-12, IV-13, IV-20
- `backend/image_extractor/cv_extractor.py` → IV-09, IV-14, IV-16, IV-17
- `backend/image_extractor/gemini_image_picker.py` → IV-16, IV-17
- `src/core/engine.ts` → IV-05, IV-15
- `src/core/pipeline/geminiExtractionApi.ts` → IV-06, IV-07, IV-08
- `src/core/pipeline/aiFirstExtractionApi.ts` → IV-15
- `src/core/pipeline/importPipeline.ts` (`aiBrutos`) → IV-15
- `src/core/images/imageExtractionApi.ts` → IV-07, IV-08, IV-20
- `src/core/net/uploadTimeout.ts` → IV-07, IV-08 (prazo do upload; usado pelos
  DOIS caminhos que sobem o PDF — foi a duplicação que deixou um corrigido e o
  outro quebrado em 10/09/2026)
- `src/core/jobs/conversionJobsStore.ts` → fila de conversões fora do React

**Re-leia o IV correspondente em `ARCHITECTURE.md` ANTES.**

### 🤖 Arquitetura AI-FIRST (v23+) — leitura essencial

O sistema mudou de "14 parsers regex" para **Gemini lê o catálogo PDF inteiro**
(IV-15) + **Gemini escolhe a imagem do produto** (IV-16/17). Consequências:
- Para AJUSTAR um fornecedor, edite o `SUPPLIER_HINTS` (3-4 linhas de prompt
  em `gemini_extractor.py`), **NÃO** crie/edite parser regex. (IV-18)
- O regex continua como FALLBACK automático se a IA falhar. NÃO o remova.
- `NIX` e `GOAL KIDS` estão na BLOCKLIST do AI-first (continuam no regex). (IV-15)
- Imagens: o AI Picker é **memory-safe** — manda 1 página anotada, extrai só a
  escolhida. **NUNCA** volte a extrair todas as candidatas antes da decisão
  (foi o que causou o OOM do v21). (IV-16)

### 🔑 Iteração local rápida (imagens / prompts Gemini)

Existe `GEMINI_API_KEY` no `.env` local (gitignored). Para iterar decisões do
Gemini SEM ciclo deploy→spike (~5min cada), escreva um script local que carrega
`from dotenv import load_dotenv` e chama o picker/extractor direto. **NUNCA**
imprima o valor da key nem a commite. Valide contra o catálogo real, depois
deploye 1× só. (Foi assim que v26 resolveu LX15016/DXP57 em minutos.)

## ✅ Workflow obrigatório de qualquer mudança

1. **Crie branch** (nunca commit direto em main):
   ```
   git checkout -b feat/<descrição>
   ```

2. **Faça a mudança**

3. **Rode o PORTÃO LOCAL antes de commitar/pushar** (substitui o CI):
   ```
   npm run verify
   ```
   Isso roda: 17 checks de invariante backend (IV-01..20) + `tsc --noEmit` +
   suite completa (`vitest run`, 311+ testes, inclui golden/contract).
   Atalho só dos greps de backend (rápido): `npm run verify:backend`.

4. **Tudo deve passar**. Se um invariante/teste falhar, **NÃO ajuste o teste**
   — investigue a regressão (ver `ARCHITECTURE.md`).

5. **Pre-push hook automático**: `.githooks/pre-push` roda `npm run verify`
   antes de todo `git push` e BLOQUEIA se algo violar. Ative uma vez por clone
   com `npm run setup-hooks` (o `prepare` do npm install já faz isso).

> ⚠️ **Correção 18/09/2026**: esta seção dizia que o repo NÃO usava GitHub
> Actions — **estava errado**. `.github/workflows/regression-locks.yml`
> roda em todo PR/push pra `main` (mesmos invariantes do `npm run verify` +
> build + smoke test pós-deploy) e a branch protection do repo **exige**
> esses checks passarem antes do merge (confirmado tentando mergear um PR
> com checks ainda em andamento — bloqueado até ficarem verdes). `npm run
> verify` local + pre-push hook continuam sendo o portão RÁPIDO (pega erro
> antes de gastar um push), mas o GitHub Actions é quem trava de fato o
> merge, não só o hook local.

## 🚫 O que NUNCA fazer

- ❌ Push direto para `main`
- ❌ `--no-verify` para pular hooks
- ❌ Desativar workflows do CI
- ❌ Deletar/enfraquecer testes em `regression-locks.test.ts`
- ❌ Mudar `max_workers` de Gemini sem ler IV-03
- ❌ Voltar `/repair_prices_ai` para síncrono (IV-02)
- ❌ Remover `gc.collect()` de `cv_extractor.py` (IV-09)
- ❌ Remover `import fitz` de `gemini_extractor.py` (IV-01) — esse já quebrou produção UMA vez
- ❌ Fazer o AI Picker extrair TODAS as candidatas como arrays antes de decidir — causou OOM no v21 (IV-16)
- ❌ Voltar o badge do AI Picker pro canto da imagem (IV-17) — confunde imagens sobrepostas
- ❌ Tirar `NIX`/`GOAL KIDS` da BLOCKLIST do AI-first (IV-15)
- ❌ Criar parser regex novo para um fornecedor quando um `SUPPLIER_HINTS` resolve (IV-18)
- ❌ Enfraquecer/editar a fixture `ai-first-golden.test.ts` (IV-15)

## 🎯 Como diagnosticar problemas em produção

Ler seção "Como debugar produção" em `ARCHITECTURE.md`.

Comandos rápidos:
```bash
# Health do backend PRIMÁRIO (Integrator). O Render virou 2ª instância em 09/2026.
curl https://conversor-vps.metodoiqc.com.br/health

# Smoke test completo (7 checks) — ajuste a versão esperada à atual em /health
bash scripts/smoke-test.sh --expect-version v26-center-badge
```

## 📞 Padrão de commits

- `fix(<área>): <descrição>` — bug fix
- `feat(<área>): <descrição>` — feature nova
- `chore(<área>): <descrição>` — manutenção
- `docs(<área>): <descrição>` — documentação
- `test(<área>): <descrição>` — testes

Sempre inclua referência ao IV-NN se a mudança o afeta:
> `fix(repair): ajusta retry sem violar IV-07`

## 🗣️ Comunicação com o Gabriel (OBRIGATÓRIO)

O Gabriel toca 4-5 projetos em paralelo e o contexto desta sessão é caro
(estourar limite trava o trabalho). Portanto:

- **REGRA MASTER — narre só o que muda o projeto.** Durante a execução, só
  avise quando o passo alterar de fato **arquitetura, segurança ou regra de uso**
  do projeto (ex.: novo caminho de extração, mudança de invariante, alteração
  de credencial/permissão, mudança que afeta como o cliente opera). Todo o
  resto — diagnóstico, leitura de arquivo, teste, iteração de algoritmo, run de
  validação, deploy rotineiro — **roda calado**, sem gastar token explicando.
  Não descreva o que está prestes a fazer nem o raciocínio; faça e siga.
- **Fechamento: resumo único de 20-30 linhas no máximo**, cobrindo tudo que foi
  feito e alterado. É o único lugar com detalhe. Sem passo a passo do caminho
  percorrido.
- **Uma frase por passo**, quando o passo se enquadrar na regra master acima.
  Nada de parágrafos descrevendo cada ação; o detalhe fica no log/PR/commit.
- **Resumo final lido em ≤20s.** Use a tabela curta "o que mudou | versão |
  resultado". Sem passo a passo minucioso.
- **Vá direto ao COMO ficou e ao RESULTADO**, não ao processo.
- **Não repita** o que já está no `ARCHITECTURE.md`/PR/commit — esses são a
  fonte do detalhe. Aqui é só o essencial acionável.
- Pergunta/decisão: objetiva, com a recomendação primeiro.

## 🆘 Em caso de fogo em produção

1. Consulte `ARCHITECTURE.md` → "Como debugar produção em caso de fogo"
2. Cheque `/health` para versão atual
3. Veja os logs do Integrator (`docker logs converter-pro-backend`) e, se o
   failover tiver caído pro Render, o dashboard dele para OOM/restarts
4. Console do navegador (anônimo) para padrões `[GeminiRepair]` / `[Engine]`
5. **Não faça rollback automático** — investigue antes; pode ser ambiente, não código

---

## Contexto do cliente

- **Cliente**: Nunes Representações
- **Caso de uso crítico**: catálogos PDF → planilhas Mercos/JAWEB
- **Fornecedores em produção**: NIX HOUSE, FOLIA, GIRA, BM36, FREECOM, DAGIA, CLINK, MOMENT, FLASH, NeoFestas, LilaHome, Petrin, Levivan, GoalKids
- **Prazo**: ASAP (entrega em curso)
- **Restrição**: zero/baixo custo — Render Starter $7/mês, Gemini Flash ~$0.05/catálogo

A confiança do cliente já foi afetada por demora. Cada regressão piora isso.
**Velocidade ≠ pressa.** Validar localmente antes de pushar economiza muito tempo.

---

## 🔗 Integração permanente com IQC Machine

Este projeto (identificador `MICHELE_CONVERSOR`) está registrado no IQC Project
Runner (`C:\IQC_PROJECT_RUNNER`) para continuidade de estado com a IQC Machine.
Regras permanentes:

1. Antes de iniciar qualquer nova tarefa neste projeto, leia `IQC_STATUS_ATUAL.md`
   na raiz para entender o estado real antes de agir.
2. Após concluir qualquer tarefa relevante (fix, feature, merge, decisão),
   atualize `IQC_STATUS_ATUAL.md` refletindo o novo estado — não espere o
   Gabriel pedir a atualização.
3. Nunca registre senhas, tokens, API keys, credenciais ou dados
   sensíveis/financeiros em `IQC_STATUS_ATUAL.md` ou em qualquer outro
   Markdown na raiz do projeto (o Runner varre e transporta esses arquivos).
4. O transporte do status até a IQC Machine é automático via
   `sync_outbound.py` (monitora mudanças em `IQC_STATUS_ATUAL.md` por hash e
   gera pacote em `bridge_retorno` após estabilidade) — não é necessário nem
   desejável enviar manualmente.
5. Não gere pacote de retorno manual (`gerar_retorno.py`) exceto se o Runner
   automático falhar ou estiver indisponível.
6. Após uma futura migração de ambiente/pasta/branch deste projeto, atualize
   em `IQC_STATUS_ATUAL.md`: caminho, ambiente, estado e próxima ação — para
   a IQC Machine não trabalhar com informação desatualizada.
7. Mudanças de código continuam seguindo o workflow normal já descrito acima
   (branch → `npm run verify` → PR → merge); a integração IQC Machine é só
   de continuidade/observabilidade e não altera esse fluxo.
8. Esta integração é de **estado**, não de execução: a existência da IQC
   Machine não autoriza pular o fluxo normal de desenvolvimento nem agir sem
   confirmação do Gabriel em ações de alto risco (push, merge, deploy).

---

## Comunicação no chat — teto de 20 a 50 linhas

Cobrado pelo Gabriel em 16/09/2026, depois de respostas que diziam a mesma
coisa três ou quatro vezes (no corpo, na tabela e no fechamento):

> *"não precisa ficar explicando todos os passos (...) tudo isso pode rodar no
> back-end. Você só vai falar aqui basicamente as principais mudanças que vão
> afetar estruturalmente, financeiramente e alguma configuração padrão."*

**Entra na resposta:** o que muda **estrutura**, **dinheiro** ou
**configuração padrão**. Risco relevante, em uma linha. Decisão que depende
dele.

**NÃO entra:** passo a passo do que foi feito, contagem de testes, build,
typecheck, deploy, verificação de bundle, tabela recapitulando o que já foi
dito acima, e resumo final do estado geral. Isso tudo roda em silêncio — se a
tarefa foi só checagem ou validação, **não traga resposta nenhuma sobre ela**.

O detalhe completo já vai para a documentação no mesmo commit; repetir no chat
é gastar token, contexto e o tempo de leitura dele.
