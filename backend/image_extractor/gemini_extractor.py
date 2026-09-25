"""
Extração estruturada de produtos via Gemini 2.5 Flash (visão).

Substitui o pipeline frágil de regex+heurística por LLM com visão multimodal.
Mantém compatibilidade com o schema de ProdutoBruto/Extraido do frontend.

Custo aproximado por catálogo (~80 páginas):
  Gemini 2.5 Flash:  ~$0.005  (recomendado)
  Gemini 2.5 Pro:    ~$0.05   (fallback se Flash retornar baixa confiança)

Acurácia esperada: 95%+ em catálogos brasileiros típicos.
"""
import os
import json
import base64
import re
import time
from collections import Counter
from typing import List, Dict, Any, Optional, Tuple

import fitz  # PyMuPDF: renderiza páginas PDF como JPEG para enviar ao Gemini Vision

# LAZY IMPORT: google-generativeai é uma lib pesada (~200MB) que estoura o
# health check de 5s do Render no startup. Importamos só na primeira chamada.
genai = None
GEMINI_AVAILABLE = False

def _lazy_import_gemini() -> bool:
    """Importa google.generativeai sob demanda. Evita travar startup do Render."""
    global genai, GEMINI_AVAILABLE
    if GEMINI_AVAILABLE:
        return True
    try:
        import google.generativeai as _genai
        genai = _genai
        GEMINI_AVAILABLE = True
        return True
    except ImportError as e:
        print(f"[Gemini] google-generativeai não instalado: {e}")
        return False
    except Exception as e:
        print(f"[Gemini] Falha ao importar: {e}")
        return False


# ─────────────────────────────────────────────────────────────
# Configuração
# ─────────────────────────────────────────────────────────────

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()

# Modelos Gemini atuais (lista verificada em 2026).
# IMPORTANTE: gemini-1.5-flash foi DESCONTINUADO em 2025 (404 v1beta).
# Mantemos uma cadeia de fallbacks com modelos ATIVOS apenas.
MODEL_FLASH = "gemini-2.5-flash"          # padrão: rápido e barato
MODEL_PRO = "gemini-2.5-pro"              # fallback: mais preciso
MODEL_FLASH_STABLE = "gemini-2.0-flash"   # 2º fallback: estável intermediário
MODEL_FLASH_LATEST = "gemini-flash-latest"  # 3º fallback: alias do Google


_initialized = False
_init_error: str = ""  # captura motivo da falha para debug

def _get_api_key() -> str:
    """Lê a key SEMPRE do env (não cacheia em var global de módulo).
    Evita o bug onde a key é avaliada em import-time antes do dotenv carregar."""
    return os.environ.get("GEMINI_API_KEY", "").strip()


def _ensure_initialized() -> bool:
    """Importa lib (lazy) + configura a API key (uma vez)."""
    global _initialized, _init_error
    if _initialized:
        return True
    if not _lazy_import_gemini():
        _init_error = "google-generativeai não importável"
        return False
    api_key = _get_api_key()
    if not api_key:
        _init_error = "GEMINI_API_KEY não setada/vazia no env"
        print(f"[Gemini] ERRO: {_init_error}")
        return False
    try:
        genai.configure(api_key=api_key)
        _initialized = True
        print(f"[Gemini] Inicializado com sucesso (key len={len(api_key)}).")
        return True
    except Exception as e:
        _init_error = f"Falha em genai.configure: {e}"
        print(f"[Gemini] {_init_error}")
        return False


# ─────────────────────────────────────────────────────────────
# SDK NOVA (google-genai) — APENAS para as chamadas de TEXTO→JSON
# (text-chunk + síntese de template), que são o GARGALO DE CUSTO.
# Permite thinking_budget=0: o 2.5 Flash deixa de gastar ~13k tokens de
# "raciocínio" por chunk (medido), cortando ~60% dos tokens / ~67% do custo
# nos catálogos grandes, SEM perda de precisão (mesma contagem de produtos).
# Vision (Files API) e image-picker seguem na SDK legada (google.generativeai),
# INTOCADOS — esta mudança não os afeta.
# ─────────────────────────────────────────────────────────────
_genai_client = None
_genai_types = None


def _get_genai_client():
    """Cliente da SDK nova (lazy). Reusa a mesma GEMINI_API_KEY do env."""
    global _genai_client, _genai_types
    if _genai_client is not None:
        return _genai_client
    from google import genai as _ng
    from google.genai import types as _t
    _genai_types = _t
    _genai_client = _ng.Client(
        api_key=_get_api_key(),
        http_options=_t.HttpOptions(timeout=300_000),  # 300s em ms
    )
    return _genai_client


def _gen_text_json(model_name: str, prompt: str, max_output_tokens: int = 65535,
                   temperature: float = 0.1, json_out: bool = True):
    """Geração de TEXTO com thinking DESLIGADO (corte de custo). SDK nova.
    json_out=True → força application/json (extração); False → texto livre
    (template usa formato delimitado CHAVE===regex). Retorna o response
    (tem .text e .usage_metadata), igual ao legado."""
    client = _get_genai_client()
    t = _genai_types
    kwargs = dict(
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        thinking_config=t.ThinkingConfig(thinking_budget=0),  # NÃO pensar (mecânico)
    )
    if json_out:
        kwargs["response_mime_type"] = "application/json"
    cfg = t.GenerateContentConfig(**kwargs)
    return client.models.generate_content(model=model_name, contents=prompt, config=cfg)


# ─────────────────────────────────────────────────────────────
# Prompt estruturado (PT-BR) que define o schema de extração
# ─────────────────────────────────────────────────────────────

REPAIR_PROMPT_TEMPLATE = """Você é um assistente especializado em catálogos B2B brasileiros.

Você receberá UMA página de catálogo PDF e uma lista de SKUs/códigos.
Para cada SKU listado, encontre o PREÇO unitário do produto na página.

SKUs a buscar nesta página:
{skus_list}

REGRAS:
1. Preço em REAIS como número (ex: 6.99, NÃO "R$ 6,99"). Use ponto decimal.
2. Catálogos brasileiros usam vírgula como decimal — converta (6,99 → 6.99).
3. NÃO confunda NCM (formato XXXX.XX.XX) com preço.
4. NÃO confunda IPI (geralmente 1-30%) com preço.
5. Se um SKU NÃO aparecer nesta página, retorne null.
6. Se o preço não estiver visível, retorne null.

Retorne APENAS JSON puro (sem markdown, sem ```):
{{
  "precos": {{
    "SKU1": 6.99,
    "SKU2": 12.50,
    "SKU3": null
  }}
}}
"""


EXTRACTION_PROMPT = """Você é um assistente especializado em extrair dados estruturados de catálogos brasileiros de fornecedores (B2B).

Analise TODAS as páginas do PDF anexado e extraia CADA produto encontrado. Para cada produto identifique:

- **codigo**: SKU/referência (ex: NX020, GC0220, F0211, BM361645, JRF-10.0063). Mantenha a formatação original.
- **nome**: descrição completa do produto (ex: "FORMA DE GELO C/BASE SILICONE - 12 CUBOS")
- **preco**: preço unitário em REAIS como número (ex: 6.99, NÃO "R$ 6,99"). Use ponto decimal.
- **precoPromocional**: preço promocional se houver (número), senão null
- **quantidadeCaixa**: quantidade de peças por caixa como inteiro (ex: 96). Procure por "PEÇAS/CXS", "QT CX", "ITENS CX", "Cx c/ N", "MASTER". Se não houver, retorne 1.
- **ipi**: percentual de IPI como número (ex: 7.8 para "IPI:7,8%"). Sem o símbolo %. Se não houver, retorne 0.
- **ncm**: código NCM se aparecer (ex: "3924.10.00"), senão null
- **categoria**: categoria/linha do produto se aparecer (ex: "COZINHA & UD"), senão null
- **paginaOrigem**: número da página onde o produto aparece (1-based)
- **observacoes**: informações adicionais relevantes (dimensões, material, cor), max 200 chars
- **emBreve**: true se o produto está marcado como "EM BREVE" / "EM BREVE..." / lançamento futuro (sem preço por design). false caso contrário.
- **promocional**: true SOMENTE se o item exibir um selo/tag/texto indicando que o preço JÁ ESTÁ COM DESCONTO APLICADO — ex: "PROMOÇÃO", "PROMO", "OFF", "X% OFF", "-X%", "preço já com desconto", "desconto já aplicado", ou um preço cheio riscado ao lado do menor. Caso contrário false. NÃO marque true só porque o preço parece baixo.

REGRAS CRÍTICAS:
1. Extraia TODOS os produtos visíveis, mesmo que tenham informações parciais.
2. NÃO invente dados. Se um campo não está visível, retorne null/0 conforme tipo.
3. NÃO confunda NCM (formato XXXX.XX.XX) com preço.
4. NÃO confunda IPI (geralmente 1-30%) com preço.
5. Preços em catálogos brasileiros usam vírgula como decimal — converta para ponto (6,99 → 6.99).
6. Códigos podem ter sufixos de variação (NX445-A, NX445-P, NX445-V) — extraia TODOS como produtos separados.
7. Se um produto tem múltiplas variações no mesmo card (ex: 3 cores), liste cada variação separadamente se houver código distinto.
8. quantidadeCaixa é a quantidade da CAIXA DE EMBARQUE (master/transporte), normalmente numa etiqueta técnica separada (ex: "CX C/12Jgs", "CX: 36 PEÇAS"). NÃO confunda com a contagem de peças que faz parte do NOME do produto (ex: "Xicara C/ Pires C/12 Pçs" descreve o conteúdo do produto, não a caixa de embarque).
9. Produto marcado "EM BREVE" sem preço NÃO é erro: retorne preco=null e emBreve=true.
10. Um card com DOIS códigos separados por barra vertical (ex: "TL03 | 2063-5", "5028-40MM | HX-5328-40") é UM produto só, com código alternativo. Use o PRIMEIRO como `codigo` e coloque o segundo em `observacoes` (ex: "cód. alt.: 2063-5"). NÃO junte os dois num campo só e NÃO crie dois produtos.
11. O NOME do produto pode quebrar em DUAS LINHAS logo acima do código (ex: "RELÓGIO DE PAREDE ROSE" / "GOLD" / "726"). Nesse caso o código é a linha de baixo e o nome é a junção das duas linhas — nunca use a última palavra do nome como código. Código costuma vir em fonte maior/negrito que o nome.
12. Quando DOIS OU MAIS produtos tiverem o MESMO nome (ex: variações de tamanho/cor do mesmo item, "KIT 6 PORTA-COPOS BAMBU" repetido com códigos diferentes), preste atenção REDOBRADA para não trocar o preço entre eles — cada preço pertence ao card/bloco onde ele está IMPRESSO, nunca ao card vizinho. Releia cada bloco isoladamente antes de responder, mesmo que os nomes sejam idênticos.

RETORNE APENAS JSON VÁLIDO no seguinte formato:
{
  "fornecedor_detectado": "NIX HOUSE",
  "total_paginas": 106,
  "produtos": [
    {
      "codigo": "NX020",
      "nome": "FORMA DE GELO C/BASE SILICONE - 12 CUBOS",
      "preco": 5.50,
      "precoPromocional": null,
      "quantidadeCaixa": 96,
      "ipi": 6.5,
      "ncm": "3924.10.00",
      "categoria": "COZINHA",
      "paginaOrigem": 4,
      "observacoes": "DIMENSÃO: 25x11,5x3cm",
      "promocional": false
    }
  ]
}

NÃO inclua texto fora do JSON. NÃO use markdown (```). Apenas o objeto JSON puro.
"""


# ─────────────────────────────────────────────────────────────
# Hints por fornecedor (v23 — AI-first)
# ─────────────────────────────────────────────────────────────
# FILOSOFIA: em vez de manter um parser regex artesanal por fornecedor
# (manutenção infinita), cada fornecedor vira ~3 linhas de instrução
# anexadas ao prompt do Gemini. Catálogo mudou de layout? Ajusta a frase.
#
# Chave = nome normalizado (upper, sem acento). Lookup tolerante em
# get_supplier_hints().

SUPPLIER_HINTS: Dict[str, str] = {
    "DAGIA": (
        "DICAS ESPECÍFICAS DO FORNECEDOR DAGIA:\n"
        "- quantidadeCaixa = número da etiqueta técnica 'CX C/N Jgs' (jogos por caixa). "
        "NUNCA use o 'C/N Pçs' que faz parte do NOME do produto (esse é o conteúdo do jogo).\n"
        "  Exemplo: 'Copo 458 ml C/6 Pçs' com etiqueta 'CX C/8Jgs' → quantidadeCaixa=8 (não 6).\n"
        "- Produtos marcados '***EM BREVE***' ou 'EM BREVE...': marque emBreve=true. "
        "  SE houver um R$ visível na página associado ao produto, use-o como preco normalmente. "
        "  Só use preco=null quando NENHUM R$ estiver disponível para o produto.\n"
        "  Exemplo correto: DV003 marcado '***EM BREVE***' com tag 'R$37,37' → preco=37.37, emBreve=true.\n"
        "- Produtos marcados '***PROMOCAO***': é um selo de promoção — extraia o preço R$ normalmente. "
        "  NÃO confunda o preço de um produto PROMOCAO com o do produto anterior.\n"
        "- ATENÇÃO preços (CRÍTICO): no texto extraído, os preços (R$ X,XX) costumam vir "
        "  AGRUPADOS NO FIM de cada página, DEPOIS de todos os códigos/nomes, na MESMA ORDEM "
        "  em que os produtos aparecem. Mapeie o 1º R$ ao 1º produto da página, o 2º R$ ao 2º, etc. "
        "  Exemplo real de uma página: 'ES7018-1R Copo... ES7018-2R Copo... R$32,50 R$30,00' → "
        "  ES7018-1R=32.50 e ES7018-2R=30.00 (NÃO o contrário, e NUNCA o número do código como preço).\n"
        "- O preço NUNCA é o número que está dentro do código (ES7018 NÃO custa 7018). "
        "  Se não encontrar um 'R$ X,XX' para um produto, use preco=null (não invente).\n"
        "- Produtos DXPD51-55 marcados 'EM BREVE' no catálogo antigo não tinham preço — "
        "  se não houver R$ visível, preco=null. Mas não generalize: outros EM BREVE podem ter preço.\n"
        "- Jogos DZ01-DZ04 vêm 2 jogos por caixa (etiqueta 'CX C/2Jgs')."
    ),
    "LILA HOME": (
        "DICAS ESPECÍFICAS DO FORNECEDOR LILA HOME:\n"
        "- O NOME do produto é a linha em CAIXA ALTA próxima ao bloco (ex: 'KIT BOWL DE CERÂMICA'), "
        "NUNCA o campo MATERIAL (ex: 'CERÂMICA' ou 'FIBRA DE BAMBU ECO' são materiais, não nomes).\n"
        "- quantidadeCaixa = número do campo 'CX: N PEÇAS'.\n"
        "- Cada bloco 'CÓD:' é um produto; nome e preço podem estar visualmente distantes do bloco.\n"
        "- PROMOÇÃO: a Lila marca itens já com desconto com uma TAG (ex: '50%', "
        "'preço já com desconto', 'desconto já aplicado'). Para esses, promocional=true "
        "e use o preço exibido (que já é o com desconto)."
    ),
    "FORTAL": (
        "DICAS ESPECÍFICAS DO FORNECEDOR FORTAL:\n"
        "- Layout por bloco: NOME (em CAIXA ALTA) → código → dimensão/material → "
        "'Qtd. p/ Caixa: N UND' → 'R$ X,XX'.\n"
        "- quantidadeCaixa = o N de 'Qtd. p/ Caixa: N UND'.\n"
        "- O código é variado (ex: SZ-01, SZ-02-08, JIN-2501, JXX-2502, ENS-01, HL100, UP012). "
        "Extraia EXATAMENTE como aparece, logo abaixo do nome.\n"
        "- PREÇO UNITÁRIO (CRÍTICO): quando o card tiver 'UND: R$ X,XX' e logo abaixo "
        "outro 'R$ Y,YY', use SEMPRE o valor escrito depois de 'UND:' como preco. "
        "O segundo valor é o total da embalagem/caixa e NÃO pode ir para preco. "
        "Exemplo real: 'UND: R$ 7,20' + 'R$ 72,00' → preco=7.20 (não 72.00).\n"
        "- Se houver apenas um 'R$ X,XX' no card, ele já é o preço FINAL. Use como 'preco'.\n"
        "- PROMOÇÃO: quando houver 'OFF N%' e DOIS preços na linha (ex: 'R$ 61,60 R$ 77,00'), "
        "o preço FINAL é o MENOR (o PRIMEIRO: 61,60); o segundo (77,00) é o original riscado — IGNORE-O.\n"
        "- 'CORES SORTIDAS' / dimensões (ex: 40x40cm) / 'OFF N%' vão em observacoes, NÃO no nome. "
        "NUNCA junte o texto de mais de um produto no mesmo nome — cada bloco (nome→código→preço) é UM produto.\n"
        "- Ignore a página de ÍNDICE (lista de categorias com números de página)."
    ),
    "FOLIA": (
        "DICAS ESPECÍFICAS DO FORNECEDOR FOLIA BRINQUEDOS:\n"
        "- A página é uma arte: leia código, nome, preço e dados dentro de cada card visual.\n"
        "- Retorne os produtos rigorosamente na ordem visual: linha de cima para baixo e, "
        "dentro de cada linha, da esquerda para a direita. Essa ordem liga cada código à foto correta.\n"
        "- O código costuma começar por JRF- e deve manter pontos, hífens e zeros exatamente como aparecem."
    ),
    "NEOTRENTINA": (
        "DICAS ESPECÍFICAS DO FORNECEDOR NEOTRENTINA (reunião 22/07/2026):\n"
        "- Layout por bloco: NOME (CAIXA ALTA, 1-3 linhas) → especificações/medidas → "
        "preço unitário 'R$ X,XX Un.' + preço de pacote 'R$ Y,YY Pct./Kit/Cx. c/N un.' → "
        "um ou mais códigos numéricos (6 dígitos) no final do bloco.\n"
        "- preço: use o PRIMEIRO valor 'R$ X,XX' (unitário); o segundo é o preço do "
        "pacote/kit maior — NÃO confunda os dois.\n"
        "- CRÍTICO — múltiplos códigos no mesmo bloco (variantes/cores SEM rótulo): "
        "às vezes um bloco tem 1 nome + 1 preço, mas 2 OU MAIS códigos numéricos "
        "empilhados em sequência, sem nenhuma palavra de cor/variante os distinguindo "
        "(ex: bloco 'FAIXA DECORATIVA PAPEL DIZERES C/FITILHO' com os códigos 124273 "
        "e 124290 um embaixo do outro; ou 'SAIA TULE LISA 30cm' com 8 códigos "
        "seguidos). Nesses casos, os códigos são cores/variantes diferentes do MESMO "
        "produto, mas o catálogo não diz qual é qual. Quando isso acontecer: crie UM "
        "PRODUTO PARA CADA CÓDIGO (mesmo nome, mesmo preço, mesmas especificações) e "
        "ACRESCENTE ' ***CORES***' ao final do nome de cada um — isso sinaliza pro "
        "time comercial verificar manualmente a cor/variante de cada código depois. "
        "NUNCA escolha só um código do grupo e descarte os outros.\n"
        "- Se a variante JÁ estiver rotulada explicitamente (ex: nome já diz 'SACOLA "
        "PAPEL BRANCO' com seu próprio código logo abaixo, ou um rótulo tipo 'ALEMÃ | "
        "119601' antes do código), NÃO use ***CORES*** — o produto já está "
        "identificado, extraia normalmente como blocos separados.\n"
        "- 'ESGOTADO' perto do bloco: ainda extraia o produto, não pule."
    ),
    "GIRA": (
        "DICAS ESPECÍFICAS DO FORNECEDOR GIRA IMPORTS:\n"
        "- código: começa com 2-4 letras + dígitos (ex: TP1968, GU0220). Fica no início "
        "do bloco. NUNCA confunda com EAN, NCM, IPI ou CX.\n"
        "- nome: texto após o código (ex: 'VASO VIDRO BOTICA').\n"
        "- preço: número COMPACTO com zeros à esquerda (ex: '0690', '0520', '0017900'). "
        "Os ÚLTIMOS 2 dígitos são CENTAVOS: '0690'→6.90, '0520'→5.20, '0017900'→179.00.\n"
        "- quantidadeCaixa: o N de 'CXnn' (ex: 'CX48'→48, 'CX80'→80).\n"
        "- ipi: 'IP 9,75%' ou 'IPI 9,75%'."
    ),
    "BM36": (
        "DICAS ESPECÍFICAS DO FORNECEDOR BM36 (e WORD CLASSIC):\n"
        "- nome: linha de descrição em CAIXA ALTA (ex: 'LUMINARIA LED GLOBO 8CM').\n"
        "- código: o valor de 'CD: BM######' ou 'CD: WC######'. O OUTRO 'CD:' com 13 "
        "dígitos é o EAN/código de barras (vai em ncm/codigoBarras), NUNCA o código.\n"
        "- preço: padrão 'B<n1>B<n2>' (ex: 'B3600B4320'). Use o PRIMEIRO número (n1) "
        "em CENTAVOS → divida por 100: 'B3600B4320'→36.00.\n"
        "- quantidadeCaixa: 'CX: N'."
    ),
    "NEO FESTAS": (
        "DICAS ESPECÍFICAS DO FORNECEDOR NEO FESTAS (Tabela Fast):\n"
        "- nome: linhas em CAIXA ALTA (ex: 'BANDEIRA TECIDO POLIÉSTER BRASIL').\n"
        "- preço: prefira o UNITÁRIO 'R$ X,XX Un.' (ex: 'R$ 0,83 Un.'→0.83). Se só houver "
        "preço de pacote 'R$ X,XX Pct. c/N un.', use esse.\n"
        "- quantidadeCaixa: o N de 'c/N un' / 'Pct. c/N un' (ex: 'Pct. c/24 un'→24).\n"
        "- código: número de 6 dígitos (ex: 153060).\n"
        "- 'ESGOTADO' → produto sem estoque. Código com '*' = poucas unidades.\n"
        "- Uma linha pode ter VÁRIAS variantes (ex: '90x120cm | R$238,44 c/12un | 124788'): "
        "cada uma é um produto separado com seu próprio código, preço e dimensão."
    ),
    "NIX HOUSE": (
        "DICAS ESPECÍFICAS DO FORNECEDOR NIX HOUSE:\n"
        "- código: NX + dígitos (ex: NX020, NX445), pode ter sufixo de variação (-A, -P, -V).\n"
        "- nome: descrição após o código (ex: 'FORMA DE GELO C/BASE SILICONE').\n"
        "- preço: 'R$ X,XX'. quantidadeCaixa: 'CX N' ou 'C/N'. ipi: 'IPI N%'.\n"
        "- O texto pode vir fragmentado/fora de ordem — agrupe por código NX."
    ),
    "GOAL KIDS": (
        "DICAS ESPECÍFICAS DO FORNECEDOR GOAL (Brinquedos):\n"
        "- bloco: código (ex: GK3493) → NOME em CAIXA ALTA → 'Quant: N PÇ/CX' → 'Preço: R$ X,XX'.\n"
        "- código: GK + dígitos. quantidadeCaixa: o N de 'Quant: N PÇ/CX'.\n"
        "- preço: o número de 'Preço: R$ X,XX' (é o preço de catálogo; desconto é aplicado depois no Mercos).\n"
        "- 'Medidas'/'Embalagem' vão em observacoes, não no nome."
    ),
    "UNIVERSAL": (
        "DICAS ESPECÍFICAS DO FORNECEDOR UNIVERSAL (catálogo UNIVERSAL - PRECO FINAL):\n"
        "- Layout: planilha exportada como PDF. Cada linha: número sequencial + descrição do produto "
        "+ código após traço (ex: '1 Papel PVC 60x60 - UC202806'). O código fica SEMPRE ao FINAL da linha, "
        "após o último traço.\n"
        "- código: prefixo 'UC' + 6 dígitos (ex: UC202806, UC202015). Extraia EXATAMENTE como aparece.\n"
        "- preço: valor 'R$ X,XX' na coluna 'Price'. Use esse valor normalmente.\n"
        "- PROMOÇÃO — PREÇO (CRÍTICO): quando um produto tem tag de promoção e a coluna 'Price' exibir "
        "DOIS valores (ex: 'R$4,35 / R$3,87' ou 'R$4,35 R$3,87'), use SEMPRE o SEGUNDO valor (o MENOR) "
        "como preço final (preco=3.87 no exemplo). O PRIMEIRO é o preço original sem desconto — IGNORE-O. "
        "Nunca use o primeiro preço para produtos em promoção com dois valores listados.\n"
        "- quantidadeCaixa: coluna 'Qtd/Cx' ou equivalente.\n"
        "- nome: a descrição antes do traço e do código (sem o número sequencial inicial e sem o código)."
    ),
}


# ===================================================================
# REGRAS ESCRITAS PELO CLIENTE — COMPILAÇÃO (19/08/2026)
# ===================================================================
# Motivação (Gabriel): cada fornecedor novo com layout próprio exigia o
# desenvolvedor editar SUPPLIER_HINTS + PR + deploy. Agora o CLIENTE
# descreve a particularidade em português, na tela do fornecedor.
#
# Mas o texto NÃO vai cru pro prompt. Pedido explícito do Gabriel: "seria
# importante otimizar isso pra chegar já em estrutura de prompt melhorado
# e não entrar em devaneios". Texto de usuário costuma vir com contexto
# desnecessário, história ("o fornecedor mudou o layout ano passado") e
# ambiguidade — jogado direto no prompt, isso rouba atenção do modelo e
# piora a extração.
#
# Então uma chamada barata traduz o texto em regras imperativas, curtas e
# verificáveis, no MESMO formato do SUPPLIER_HINTS. O resultado é cacheado
# por hash do texto: só recompila quando o cliente edita.

_COMPILE_RULES_PROMPT = """Você converte observações de um usuário sobre um catálogo de produtos em REGRAS DE EXTRAÇÃO objetivas.

O texto abaixo foi escrito por um vendedor (não técnico) descrevendo particularidades do catálogo deste fornecedor.

Converta em regras imperativas, curtas e VERIFICÁVEIS, referindo-se aos campos: codigo, nome, preco, precoPromocional, quantidadeCaixa, ipi, ncm, categoria, emBreve, promocional.

REGRAS DA CONVERSÃO:
- Uma instrução por linha, começando com "- ".
- Só inclua o que estiver AFIRMADO no texto. NÃO invente, NÃO complete, NÃO generalize.
- Descarte conversa, história e justificativa; mantenha só o que muda a extração.
- Se o texto não disser nada aproveitável, responda exatamente: (sem regras)
- Máximo 10 linhas. Sem preâmbulo, sem comentário final.

TEXTO DO USUÁRIO:
---
{texto}
---

REGRAS DE EXTRAÇÃO:"""


def compile_client_rules(supplier: str, raw_text: str) -> str:
    """
    Traduz o texto livre do cliente em regras objetivas p/ o prompt.
    Cacheado por hash — só chama a IA quando o texto muda.
    Falha é SILENCIOSA: sem regras é melhor que quebrar a conversão.
    """
    raw = (raw_text or "").strip()
    if not raw:
        return ""

    try:
        from supplier_profile import get_cached_client_rules, save_client_rules
        cached = get_cached_client_rules(supplier, raw)
        if cached is not None:
            return cached
    except Exception:
        pass

    try:
        # Usa o helper do projeto: SDK nova + thinking DESLIGADO. Com o SDK
        # legado e max_output_tokens baixo, o 2.5 Flash gasta o orçamento
        # "pensando" e devolve a resposta CORTADA no meio — comprovado aqui
        # (a compilação truncou em "quantidadeCaixa deve ser extraído do topo"
        # e perdeu a última regra). Mesmo problema já visto na Phase 0.
        # json_out=False porque a saída é texto em linhas, não JSON.
        resp = _gen_text_json(
            "gemini-2.5-flash",
            _COMPILE_RULES_PROMPT.format(texto=raw[:4000]),
            max_output_tokens=4096,
            temperature=0.0,
            json_out=False,
        )
        compiled = (getattr(resp, "text", "") or "").strip()

        if not compiled or compiled.lower().startswith("(sem regras"):
            compiled = ""
        else:
            compiled = (
                f"REGRAS INFORMADAS PELO CLIENTE PARA {supplier.upper()} "
                f"(prevalecem sobre suposições genéricas):\n{compiled}"
            )

        try:
            from supplier_profile import save_client_rules
            save_client_rules(supplier, raw, compiled)
        except Exception:
            pass
        print(f"[Regras] Regras do cliente compiladas para '{supplier}' "
              f"({len(compiled)} chars)")
        return compiled
    except Exception as e:
        # Nunca derruba a conversão por causa disso — segue sem as regras.
        print(f"[Regras] Falha ao compilar regras de '{supplier}': {e}")
        return ""


def get_supplier_hints(supplier: str, client_rules: str = "") -> str:
    """
    Retorna hints do fornecedor.
    Prioridade: 1) SUPPLIER_HINTS hardcoded  2) perfil auto-gerado (Phase 0).
    IV-23: hardcoded sempre vence o cache.

    As regras escritas pelo CLIENTE (client_rules) são ADICIONADAS ao final,
    não substituem — os hints hardcoded carregam correções de bugs reais
    (ex.: gate de preço-vindo-do-código da DAGIA) que não podem ser perdidas
    caso o cliente escreva algo conflitante.
    """
    base = _get_supplier_hints_base(supplier)
    extra = compile_client_rules(supplier, client_rules) if client_rules else ""
    if extra:
        return f"{base}\n\n{extra}" if base else extra
    return base


def _get_supplier_hints_base(supplier: str) -> str:
    if not supplier:
        return ""
    norm = supplier.strip().upper()
    for a, b in [("Á", "A"), ("Ã", "A"), ("Â", "A"), ("É", "E"), ("Ê", "E"),
                 ("Í", "I"), ("Ó", "O"), ("Õ", "O"), ("Ô", "O"), ("Ú", "U"), ("Ç", "C")]:
        norm = norm.replace(a, b)
    # 1. Hardcoded (alta confiança)
    for key, hints in SUPPLIER_HINTS.items():
        if key in norm or norm in key:
            return hints
    # 2. Cache Phase 0 (auto-gerado)
    try:
        from supplier_profile import get_cached_hints
        cached = get_cached_hints(supplier)
        if cached:
            return cached
    except Exception:
        pass
    return ""


def _ensure_supplier_profile(pdf_path: str, supplier: str) -> None:
    """
    Phase 0 (IV-23): se não há hints para este fornecedor, analisa a estrutura
    do catálogo via Gemini e cacheia as dicas para todas as conversões futuras.
    Falhas são silenciosas — extração continua sem hints se a análise falhar.
    """
    if not supplier:
        return
    try:
        from supplier_profile import get_cached_hints
        if get_cached_hints(supplier):
            return  # já cacheado, nada a fazer
        # A Phase 0 lê o TEXTO das páginas. Num PDF cujo texto é só marca
        # d'água (FOLIA), ela analisa a moldura e grava um perfil errado em
        # cache — que depois contamina TODAS as conversões futuras desse
        # fornecedor. Melhor não ter hints do que ter hints inventados.
        doc = fitz.open(pdf_path)
        try:
            if camada_de_texto_inutil(doc):
                print(f"[Phase0] '{supplier}' sem produtos na camada de texto — "
                      f"análise pulada (evita perfil baseado na marca d'água)")
                return
        finally:
            doc.close()
        from supplier_analyzer import analyze_and_cache
        analyze_and_cache(pdf_path, supplier)
    except Exception as e:
        print(f"[Phase0] Análise ignorada p/ '{supplier}': {e}")


# ─────────────────────────────────────────────────────────────
# Função principal
# ─────────────────────────────────────────────────────────────

def extract_products_with_gemini(
    pdf_path: str,
    model_name: str = MODEL_FLASH,
    max_retries: int = 2,
    supplier_hints: str = ""
) -> Dict[str, Any]:
    """
    Extrai produtos de um PDF de catálogo usando Gemini com visão.

    Args:
        pdf_path: caminho local do PDF
        model_name: modelo Gemini ('gemini-2.5-flash' ou 'gemini-2.5-pro')
        max_retries: tentativas em caso de erro de API

    Returns:
        {
            "success": bool,
            "model": str,
            "produtos": List[Dict],
            "fornecedor_detectado": str,
            "total_paginas": int,
            "elapsed": float (segundos),
            "error": str | None
        }
    """
    if not _ensure_initialized():
        return {
            "success": False,
            "produtos": [],
            "error": "Gemini não configurado (verifique GEMINI_API_KEY no Render)",
            "model": model_name,
        }

    start = time.time()
    file_handle = None

    for attempt in range(1, max_retries + 1):
        try:
            print(f"[Gemini] Tentativa {attempt}/{max_retries} | modelo={model_name}")

            # 1. Upload do PDF para a Files API (mais eficiente que inline base64
            #    para PDFs grandes; Gemini suporta nativamente)
            if file_handle is None:
                file_handle = genai.upload_file(pdf_path, mime_type="application/pdf")
                # Aguarda o arquivo estar pronto (geralmente <2s)
                while file_handle.state.name == "PROCESSING":
                    time.sleep(0.5)
                    file_handle = genai.get_file(file_handle.name)
                if file_handle.state.name != "ACTIVE":
                    raise RuntimeError(f"Upload falhou: {file_handle.state.name}")

            # 2. Configurar geração com JSON mode
            model = genai.GenerativeModel(model_name)

            generation_config = genai.GenerationConfig(
                temperature=0.1,           # determinismo (queremos extração fiel)
                response_mime_type="application/json",
                max_output_tokens=65535,    # catálogos grandes podem ter muitos produtos
            )

            # v23: anexa hints do fornecedor ao prompt (substitui parsers regex)
            full_prompt = EXTRACTION_PROMPT
            if supplier_hints:
                full_prompt = f"{EXTRACTION_PROMPT}\n\n{supplier_hints}"

            response = model.generate_content(
                [file_handle, full_prompt],
                generation_config=generation_config,
                request_options={"timeout": 300},  # 5min timeout
            )

            # 3. Parse da resposta
            raw_text = (response.text or "").strip()
            if raw_text.startswith("```"):
                # remove cercas de markdown se o modelo enviar
                raw_text = raw_text.strip("`")
                if raw_text.startswith("json"):
                    raw_text = raw_text[4:].strip()

            data = json.loads(raw_text)

            produtos = data.get("produtos", [])
            elapsed = time.time() - start
            print(
                f"[Gemini] ✓ {len(produtos)} produtos extraídos "
                f"em {elapsed:.1f}s (modelo={model_name})"
            )

            return {
                "success": True,
                "model": model_name,
                "produtos": produtos,
                "fornecedor_detectado": data.get("fornecedor_detectado", ""),
                "total_paginas": data.get("total_paginas", 0),
                "elapsed": elapsed,
                "error": None,
            }

        except json.JSONDecodeError as e:
            print(f"[Gemini] JSON inválido (tentativa {attempt}): {e}")
            if attempt < max_retries:
                time.sleep(2)
                continue
            return {
                "success": False,
                "produtos": [],
                "error": f"Resposta do Gemini não é JSON válido: {e}",
                "model": model_name,
                "elapsed": time.time() - start,
            }

        except Exception as e:
            err_str = str(e)
            print(f"[Gemini] Erro tentativa {attempt}: {err_str[:200]}")
            # Se for 429 (rate limit) ou 503 (overload), retry com backoff
            if any(code in err_str for code in ["429", "503", "RESOURCE_EXHAUSTED"]):
                if attempt < max_retries:
                    time.sleep(5 * attempt)
                    continue
            if attempt >= max_retries:
                return {
                    "success": False,
                    "produtos": [],
                    "error": err_str[:300],
                    "model": model_name,
                    "elapsed": time.time() - start,
                }

    return {
        "success": False,
        "produtos": [],
        "error": "Falha após todas as tentativas",
        "model": model_name,
        "elapsed": time.time() - start,
    }


def _render_page_to_jpeg(pdf_path: str, page_num: int, dpi: int = 90) -> Optional[bytes]:
    """Renderiza uma única página do PDF como JPEG em memória.

    DPI 90: suficiente para Gemini ler texto, ~20% menos RAM/tokens que 100.
    """
    try:
        doc = fitz.open(pdf_path)
        if page_num < 1 or page_num > len(doc):
            doc.close()
            return None
        page = doc.load_page(page_num - 1)  # 0-based
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        jpeg_bytes = pix.tobytes("jpeg")
        # Libera pixmap explicitamente (segura ~5-10MB intermediários)
        pix = None
        doc.close()
        return jpeg_bytes
    except Exception as e:
        print(f"[Gemini] Falha ao renderizar página {page_num}: {e}")
        return None


def _render_pages_batch(pdf_path: str, page_nums: List[int], dpi: int = 90) -> Dict[int, bytes]:
    """
    Renderiza um LOTE de páginas SERIALMENTE usando UMA ÚNICA instância de fitz.

    Por que serial e não paralelo: cada `fitz.open(pdf_path)` carrega o PDF
    inteiro na RAM (12MB+ para NIX). Com 3-6 workers paralelos isso estoura
    o limite de 512MB do Render Starter (OOM confirmado em produção).

    Aqui:
      - UMA única abertura do PDF (~12MB)
      - Loop sequencial render → JPEG bytes → libera pixmap
      - gc.collect() periódico para evitar acumular
      - Footprint: ~12MB (PDF) + ~200KB × N (JPEGs já em RAM final)

    Retorna {page_num: jpeg_bytes}. Páginas que falharam são omitidas.
    """
    import gc
    results: Dict[int, bytes] = {}
    if not page_nums:
        return results
    try:
        doc = fitz.open(pdf_path)
        n_pages = len(doc)
        for i, page_num in enumerate(page_nums):
            if page_num < 1 or page_num > n_pages:
                continue
            try:
                page = doc.load_page(page_num - 1)
                zoom = dpi / 72.0
                mat = fitz.Matrix(zoom, zoom)
                pix = page.get_pixmap(matrix=mat)
                results[page_num] = pix.tobytes("jpeg")
                pix = None
                page = None
            except Exception as e:
                print(f"[Gemini] Falha ao renderizar página {page_num}: {e}")
            # gc a cada 10 páginas evita acúmulo
            if (i + 1) % 10 == 0:
                gc.collect()
        doc.close()
        gc.collect()
    except Exception as e:
        print(f"[Gemini] Falha ao abrir PDF para batch render: {e}")
    return results


def _call_gemini_with_jpeg(
    jpeg_bytes: bytes,
    page_num: int,
    skus_in_page: List[str],
    model_name: str = MODEL_FLASH,
) -> Dict[str, float]:
    """
    Chama Gemini Vision em UMA página JÁ RENDERIZADA (bytes JPEG passados).
    Não toca disco, não abre PDF. Só faz a chamada de API.

    Retorna {sku: preco}. Preços não encontrados são omitidos.
    """
    if not _ensure_initialized():
        print(f"[Gemini Repair] Pág {page_num}: _ensure_initialized FALHOU dentro do worker")
        return {}
    print(f"[Gemini Repair] Pág {page_num}: JPEG já em memória ({len(jpeg_bytes)} bytes), chamando Gemini...")

    try:
        # Monta o prompt com a lista de SKUs específicos
        skus_text = "\n".join(f"- {s}" for s in skus_in_page)
        prompt = REPAIR_PROMPT_TEMPLATE.format(skus_list=skus_text)

        model = genai.GenerativeModel(model_name)
        generation_config = genai.GenerationConfig(
            temperature=0.0,
            response_mime_type="application/json",
            max_output_tokens=4096,  # SKUs são pequenos, resposta pequena
        )

        # Envia imagem inline + prompt (mais rápido que upload de arquivo)
        response = model.generate_content(
            [
                {"mime_type": "image/jpeg", "data": jpeg_bytes},
                prompt,
            ],
            generation_config=generation_config,
            request_options={"timeout": 60},
        )

        raw = (response.text or "").strip()
        print(f"[Gemini Repair] Pág {page_num}: resposta crua ({len(raw)} chars): {raw[:300]}")
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.startswith("json"):
                raw = raw[4:].strip()
        data = json.loads(raw)
        precos = data.get("precos", {})
        print(f"[Gemini Repair] Pág {page_num}: precos parseados: {precos}")
        # Filtra null/0 e converte para float
        result = {}
        for sku, preco in precos.items():
            if preco is None:
                continue
            try:
                v = float(preco)
                if 0.10 <= v <= 9999.99:
                    result[sku] = v
            except (TypeError, ValueError):
                continue
        return result

    except Exception as e:
        print(f"[Gemini Repair] Falha pág {page_num} ({len(skus_in_page)} SKUs): {str(e)[:200]}")
        # Re-raise para que repair_prices_for_skus marque a página como
        # "exception" (e não como "empty" — preços não encontrados).
        # Isso permite distinguir erro de API vs ausência legítima.
        raise


def repair_prices_for_skus(
    pdf_path: str,
    skus_by_page: Dict[int, List[str]],
    max_workers: int = 3
) -> Dict[str, Any]:
    """
    Repara preços de SKUs específicos no PDF.

    ARQUITETURA (otimizada para Render Starter 512MB):
      FASE 1 (serial, rápido, leve em RAM):
        - Abre PDF UMA vez (~12MB para NIX)
        - Renderiza todas páginas como JPEG sequencialmente
        - gc.collect a cada 10 páginas
        - Footprint: ~12MB PDF + ~200KB × N JPEGs (típico ~15MB total)
        - Tempo: ~0.5s por página × 51 = ~25s

      FASE 2 (paralelo, lento por causa de API mas leve em RAM):
        - Manda JPEGs já em memória para Gemini em paralelo
        - max_workers=3 conservador (Gemini Flash free tier 15 RPM)
        - Footprint adicional: ~zero (só HTTP requests)
        - Tempo: ~3-5s por página, mas 3 em paralelo = ~30-50s

    POR QUE NÃO PARALELO total: cada `fitz.open()` carrega 12MB. Com 3 workers
    paralelos = 36MB + pixmap intermediário ~5MB × 3 = +15MB = pico ~50MB+ só
    pra renderizar. Causa OOM em Render Starter (512MB) com PDFs >= 10MB.

    Args:
      pdf_path: caminho do PDF
      skus_by_page: {numero_pagina: [sku1, sku2, ...]}
      max_workers: paralelismo APENAS na chamada Gemini (default 3)

    Returns:
      {
        "success": bool,
        "model": str,
        "precos": { "SKU1": 5.99, "SKU2": 12.50, ... },
        "paginas_processadas": int,
        "elapsed": float,
        "error": str | None
      }
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import gc

    if not _ensure_initialized():
        return {
            "success": False, "model": MODEL_FLASH, "precos": {},
            "paginas_processadas": 0, "elapsed": 0,
            "error": f"Gemini não configurado: {_init_error}",
        }

    start = time.time()
    all_precos: Dict[str, float] = {}
    paginas_processadas = 0
    debug_pages: Dict[str, Any] = {}

    total_skus_in = sum(len(s) for s in skus_by_page.values())
    pages_to_render = sorted([pn for pn, skus in skus_by_page.items() if skus])
    print(f"[Gemini Repair] Iniciando reparo de {total_skus_in} SKUs em {len(pages_to_render)} páginas")

    # ─── FASE 1: pre-render serial (1 fitz.open total, baixa RAM) ───
    print(f"[Gemini Repair] FASE 1: renderizando {len(pages_to_render)} páginas (serial, baixa RAM)...")
    t_render_start = time.time()
    jpegs_by_page = _render_pages_batch(pdf_path, pages_to_render, dpi=90)
    t_render = time.time() - t_render_start
    total_jpeg_bytes = sum(len(b) for b in jpegs_by_page.values())
    print(f"[Gemini Repair] FASE 1 OK: {len(jpegs_by_page)} páginas renderizadas em {t_render:.1f}s "
          f"({total_jpeg_bytes/1024/1024:.1f}MB de JPEGs)")

    # Páginas que falharam ao renderizar
    for pn in pages_to_render:
        if pn not in jpegs_by_page:
            debug_pages[str(pn)] = {"precos_found": 0, "status": "render_failed"}

    if not jpegs_by_page:
        elapsed = time.time() - start
        return {
            "success": False, "model": MODEL_FLASH, "precos": {},
            "paginas_processadas": 0, "elapsed": elapsed,
            "error": "Falha ao renderizar todas as páginas",
            "debug_pages": debug_pages,
            "debug_total_skus": total_skus_in,
            "debug_total_pages_input": len(skus_by_page),
        }

    # ─── FASE 2: Gemini em paralelo (só HTTP, baixa RAM) ───
    print(f"[Gemini Repair] FASE 2: chamando Gemini em paralelo (max_workers={max_workers})...")
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(_call_gemini_with_jpeg, jpegs_by_page[pn], pn, skus_by_page[pn], MODEL_FLASH): pn
            for pn in jpegs_by_page.keys()
        }
        for fut in as_completed(futures):
            page_num = futures[fut]
            try:
                page_precos = fut.result()
                if page_precos:
                    all_precos.update(page_precos)
                    paginas_processadas += 1
                    debug_pages[str(page_num)] = {"precos_found": len(page_precos), "status": "ok"}
                    print(f"[Gemini Repair] Pág {page_num}: {len(page_precos)} preços OK")
                else:
                    debug_pages[str(page_num)] = {"precos_found": 0, "status": "empty"}
            except Exception as e:
                debug_pages[str(page_num)] = {"precos_found": 0, "status": "exception", "error": str(e)[:200]}
                print(f"[Gemini Repair] Pág {page_num} erro: {e}")

    # Libera memória das JPEGs após processamento
    jpegs_by_page.clear()
    gc.collect()

    elapsed = time.time() - start
    print(f"[Gemini Repair] ✓ {len(all_precos)} preços resgatados em {elapsed:.1f}s")

    # Honestidade: se todas as páginas falharam silenciosamente (exception) e
    # nada foi processado, success=False com motivo agregado. Caso contrário
    # success=True (até para resultados vazios — Gemini pode legitimamente
    # não encontrar o SKU na página declarada).
    all_failed = (
        paginas_processadas == 0
        and total_skus_in > 0
        and len(debug_pages) > 0
        and all(p.get("status") == "exception" for p in debug_pages.values())
    )
    success = not all_failed
    error_msg = None
    if all_failed:
        first_err = next(
            (p.get("error") for p in debug_pages.values() if p.get("error")),
            "todas as páginas estouraram exceção (ver debug_pages)"
        )
        error_msg = f"Gemini falhou em todas as páginas: {first_err}"

    return {
        "success": success,
        "model": MODEL_FLASH,
        "precos": all_precos,
        "paginas_processadas": paginas_processadas,
        "elapsed": elapsed,
        "error": error_msg,
        "debug_pages": debug_pages,
        "debug_total_skus": total_skus_in,
        "debug_total_pages_input": len(skus_by_page),
    }


# ─────────────────────────────────────────────────────────────
# v27 — Extração por TEXTO em CHUNKS (catálogos grandes/pesados)
# ─────────────────────────────────────────────────────────────
# Por que existe: catálogos como FORTAL têm 81MB / 96 páginas com IMAGENS
# gigantes. Mandar o PDF inteiro pro Gemini (Files API/vision) dá 400
# "invalid argument" (arquivo grande demais). Mas o TEXTO de todo o catálogo
# é minúsculo (~18k tokens p/ 96 págs). Validado empiricamente:
#   - 10 págs por texto → 90 produtos, 100% preço, 100% qtd caixa, ~83s
#   - 30 págs numa só chamada → 504 (output longo demais)
# Logo: extrai o TEXTO por página, fatia em chunks de ~10 págs, chama Gemini
# (text-only, payload minúsculo) em PARALELO, e mescla deduplicando por código.

# ─────────────────────────────────────────────────────────────
# v33 — TEMPLATE SYNTHESIS (IA infere o padrão; código aplica no resto)
# ─────────────────────────────────────────────────────────────
# Decisão do cliente (16/06/2026): catálogos grandes via IA levam 10-15min
# (Gemini gerando milhares de produtos — teto de concorrência da conta).
# Inviável (meta 2-5min). MAS a maioria dos catálogos é ALTAMENTE PADRONIZADA
# (grid fixo, N produtos/página, campos rotulados). Para esses:
#   1. IA lê 2-3 páginas-amostra → infere um TEMPLATE de extração (regex).
#      (1 chamada barata, ~8s)
#   2. Código aplica o template em TODAS as páginas (determinístico, <1s, GRÁTIS).
#   3. Páginas que fogem do padrão → fallback IA só nelas (paga só o problema).
# Validado (Goal Kids): 576 produtos, 100% preço, ~8s total (era ~2,6min).
# SEGURANÇA: se o template tiver cobertura baixa, cai no AI-first text-chunked.

# Quantas páginas-amostra alimentam a síntese do template
TEMPLATE_SAMPLE_PAGES = 3
# Cobertura mínima (produtos com código E preço) para confiar no template;
# abaixo disso, faz fallback pro AI-first text-chunked.
TEMPLATE_MIN_COVERAGE = 0.80

# ─────────────────────────────────────────────────────────────
# TEXTO COM COORDENADAS (11/09/2026) — corrige preço trocado/ausente
# ─────────────────────────────────────────────────────────────
# `page.get_text()` devolve o texto em ORDEM DE LEITURA, e num catálogo em
# grade isso destrói a relação preço↔produto: no Dute Toys a página traz os 4
# códigos em sequência e SÓ DEPOIS os 4 selos de preço, todos soltos no fim:
#
#     DT10032 / DT10019 / DT10020 / DT10021
#     EM BREVE / DISPONÍVEL / DISPONÍVEL / DISPONÍVEL
#     R$ 5,00 / R$ 5,50 / R$ 5,50
#
# Nem o Gemini nem regex nenhum tem como saber de quem é cada preço — a única
# informação que resolve (a POSIÇÃO do selo na página) tinha sido jogada fora
# antes da IA ver o texto. Medido no catálogo real (A/B com API de verdade,
# págs 5-10 do Dute): texto puro acertou 12/24 preços; com coordenada, 24/24.
#
# O cliente não configura nada para isso funcionar: a posição já está no PDF.
COORD_GAP_COL = 30.0  # distância horizontal que separa COLUNAS diferentes (pt)

COORD_PROMPT_HINT = """
FORMATO DO TEXTO: cada linha vem como [X,Y] seguido do conteúdo, onde X,Y são as
coordenadas do canto superior esquerdo daquele trecho NA PÁGINA (X cresce para a
direita, Y cresce para baixo). Use as coordenadas para saber QUAL preço/selo
pertence a QUAL produto: numa página em grade, o preço e o selo ("DISPONÍVEL",
"EM BREVE") de um produto ficam no MESMO X aproximado (mesma coluna) e logo
ACIMA do código dele. NUNCA associe a um produto um preço de outra coluna
(X muito diferente) nem de outra linha da grade (Y distante).
As coordenadas são só para você raciocinar — não as copie para o JSON.
Trecho entre **asteriscos** está em fonte MAIOR que o corpo da página: em
catálogo é quase sempre o CÓDIGO ou o PREÇO, nunca a continuação de um nome
que quebrou de linha. Use isso para não confundir a última palavra do nome
com o código. Os asteriscos são marcação — não os copie para o JSON.
"""


def page_text_for_ai(page) -> str:
    """
    Texto da página anotado com a coordenada de cada trecho.

    Cada span do PDF vira uma linha `[x,y] conteúdo`. Spans vizinhos na mesma
    linha são colados (um rótulo e seu valor), mas um vão horizontal maior que
    `COORD_GAP_COL` quebra o trecho — é o que impede dois preços de colunas
    diferentes de virarem um texto só (o bug que trocava os preços do Dute).
    A saída sai ordenada por faixa de Y e depois por X, ou seja, na ordem em
    que a página é LIDA de verdade, e não na ordem em que o PDF guardou.
    """
    runs = []
    tamanhos = []
    for bloco in page.get_text("dict")["blocks"]:
        if bloco.get("type") != 0:  # 0 = texto (1 = imagem)
            continue
        for linha in bloco["lines"]:
            atual = None
            for span in linha["spans"]:
                texto = " ".join(span["text"].split())
                if not texto:
                    continue
                x0, y0, x1, _ = span["bbox"]
                tam = round(float(span.get("size") or 0), 1)
                tamanhos.append(tam)
                if atual and x0 - atual[2] <= COORD_GAP_COL:
                    atual = [atual[0], atual[1], x1, atual[3] + " " + texto,
                             max(atual[4], tam)]
                else:
                    if atual:
                        runs.append(atual)
                    atual = [x0, y0, x1, texto, tam]
            if atual:
                runs.append(atual)
    # Faixa de 8pt no Y: itens da mesma linha da grade ficam juntos mesmo com
    # o baseline levemente diferente (selo e código nunca alinham no pixel).
    runs.sort(key=lambda r: (round(r[1] / 8), r[0]))

    # Marca o trecho em DESTAQUE (fonte maior que o corpo da página).
    # Sem isso, só a posição sobrava para separar código de nome — e a posição
    # engana quando o nome quebra em duas linhas logo acima do código: a última
    # palavra do nome cai exatamente no slot do código. Foi o "726 (relógio de
    # parede rose gold) saiu com o código GOLD" do Josef (16/09/2026); na
    # FORTAL o nome é 9.0pt e o código 10.0pt em negrito, então o dado existia
    # e estava sendo descartado antes de chegar na IA. 26% dos cards do
    # catálogo têm nome em 2+ linhas, ou seja, expostos ao mesmo erro.
    corpo = max(set(tamanhos), key=tamanhos.count) if tamanhos else 0.0
    return "\n".join(
        f"[{int(r[0])},{int(r[1])}] " + (f"**{r[3]}**" if r[4] > corpo + 0.4 else r[3])
        for r in runs
    )


# ─────────────────────────────────────────────────────────────
# CATÁLOGO SEM DADOS EM TEXTO (11/09/2026) — FOLIA BRINQUEDOS
# ─────────────────────────────────────────────────────────────
# O caminho text-chunked pressupõe que os produtos estejam no texto do PDF.
# A FOLIA quebrou essa premissa: as 45 páginas têm camada de texto, mas ela
# contém APENAS a marca d'água de fundo ("FOLIA IMPORTS · UTILIDADES E
# BRINQUEDOS", repetida) — código, nome e preço fazem parte da ARTE, são
# pixels. O texto das páginas 5, 10 e 20 é byte a byte o mesmo.
#
# Sem essa checagem a IA recebia só a marca d'água, "achava" 18 produtos com
# códigos que eram números de página (18, 19, 20, 30, 31…) e o cliente via
# "18 produtos / 0 importados com sucesso / 18 erros" em 8min36. O catálogo
# não é ruim nem o modelo alucinou: não havia o que ler.
#
# Detectar isso é obrigação do sistema, não do cliente — ele não tem como
# saber se um PDF tem camada de texto útil.
BOILERPLATE_MIN_PAGES_FRAC = 0.6   # linha em >= 60% das páginas = moldura/marca d'água
# O critério NÃO pode ser "pouco texto": o TUKA TOYS tem ~100 chars úteis por
# página (1-2 produtos, só código, caixa e preço) e extrai 335 produtos
# perfeitamente. O que separa os dois casos é a PRESENÇA de informação de
# produto — preço ou código — e não o volume. Na FOLIA sobram 7 chars de ruído.
MIN_PAGINAS_COM_SINAL_FRAC = 0.25  # < 25% das páginas com preço/código = sem texto útil
RX_SINAL_PRECO = re.compile(r"\d+[.,]\d{2}\b")
RX_SINAL_CODIGO = re.compile(r"\b(?:[A-Z]{2,}[\-.]?\d{2,}|\d{4,})\b")
# UMA página por chamada. Medido na FOLIA contra gabarito lido à mão:
# com 4 páginas na mesma chamada o modelo INVENTAVA os códigos (pág 17:
# 0/9 certos — vinham JRF-10.0161, JRF-10.0159… no lugar de JRF-10.0581,
# JRF-10.0528…), embora os preços saíssem certos. Com 1 página por chamada:
# 8/9. O wall-time não piora, porque as chamadas correm em paralelo.
VISION_CHUNK_PAGES = 1
VISION_CHUNK_WORKERS = 8           # cada chamada é pequena; o gargalo é a rede
# 160 DPI: a 110 o modelo lia "JRF-10.3090" onde estava "JRF-10.1090" — um
# dígito, e o produto inteiro vira outro. A 160 o gabarito fecha 9/9; a 200
# não melhora mais e só engorda o JPEG (970KB contra 728KB).
VISION_DPI = 160

VISION_POSITION_HINT = """
Como esta entrada é uma IMAGEM da página, acrescente em CADA produto:
"posicaoVisual": {"x": N, "y": N}, onde x e y são o CENTRO do card visual
do produto numa escala de 0 a 1000 (0,0 = canto superior esquerdo; 1000,1000 =
canto inferior direito). Meça o card daquele produto, não o cabeçalho nem o
número da página. Mantenha também os produtos na ordem visual: de cima para
baixo e, em cada linha, da esquerda para a direita.
"""


def texto_util_por_pagina(doc) -> List[str]:
    """
    Texto de cada página SEM a moldura que se repete no catálogo inteiro.

    Cabeçalho, rodapé, índice lateral e marca d'água aparecem em quase toda
    página e não dizem nada sobre o produto. Removê-los é o que separa
    "página com pouco texto" de "página sem informação nenhuma".
    """
    paginas = [doc[i].get_text() for i in range(len(doc))]
    if not paginas:
        return []
    ocorrencias: Dict[str, int] = {}
    for texto in paginas:
        for linha in {l.strip() for l in texto.splitlines() if l.strip()}:
            ocorrencias[linha] = ocorrencias.get(linha, 0) + 1
    limite = max(2, int(len(paginas) * BOILERPLATE_MIN_PAGES_FRAC))
    boilerplate = {l for l, n in ocorrencias.items() if n >= limite}
    return [
        "\n".join(l for l in t.splitlines() if l.strip() and l.strip() not in boilerplate)
        for t in paginas
    ]


def camada_de_texto_inutil(doc) -> bool:
    """
    True quando o PDF não tem os produtos em texto — só arte e moldura.

    Mede em quantas páginas sobra algum SINAL de produto (um preço ou um
    código) depois de tirar a moldura. Uma página de catálogo real sempre tem
    pelo menos um dos dois; a página da FOLIA não tem nenhum, porque tudo isso
    está desenhado na arte.

    Medido nos catálogos do cliente: FOLIA 0% das páginas com sinal, TUKA 100%,
    Dute 100%, FORTAL 100% — mesmo o TUKA tendo só ~100 chars úteis por página.
    """
    uteis = texto_util_por_pagina(doc)
    if not uteis:
        return True
    com_sinal = sum(
        1 for t in uteis
        if RX_SINAL_PRECO.search(t) or RX_SINAL_CODIGO.search(t)
    )
    return (com_sinal / len(uteis)) < MIN_PAGINAS_COM_SINAL_FRAC


LARGE_CATALOG_MB = 15          # acima disso, vision do PDF inteiro falha
LARGE_CATALOG_PAGES = 30       # ou muitas páginas → modo texto-chunked
# Chunk de 6 págs (v31): catálogos DENSOS como NEO FESTAS têm ~15 produtos/pág;
# com 10 págs o output estourava (504) e o re-split sequencial levava ~39min.
# 6 págs mantém ~90 produtos/chunk (zona segura validada no Fortal) → poucos
# 504 → poucos re-splits → muito mais rápido.
TEXT_CHUNK_PAGES = 6
# Paralelismo ALTO (v32): o gargalo é o Gemini GERANDO o JSON (~83s/chunk),
# não RAM/CPU (texto, HTTP-bound). Mais workers = menos "ondas" = menos
# wall-time. Meta do cliente: 2-5min. Tier pago do Gemini aguarda dezenas de
# chamadas simultâneas, então 12 é seguro. Ex.: NeoFestas 23 chunks / 12 ≈ 2
# ondas ≈ ~3-4min (era ~15min com 5 workers).
TEXT_CHUNK_WORKERS = 12


def _extract_text_chunk_once(
    page_texts: List[str], first_page: int, supplier_hints: str, model_name: str
) -> List[Dict[str, Any]]:
    """UMA tentativa de extrair produtos do TEXTO de um chunk. Lança em erro."""
    bloco = "\n".join(
        f"--- PG {first_page + i} ---\n{t}" for i, t in enumerate(page_texts)
    )
    prompt = EXTRACTION_PROMPT + COORD_PROMPT_HINT
    if supplier_hints:
        prompt += f"\n\n{supplier_hints}"
    prompt += f"\n\nTEXTO DO CATÁLOGO (extraído por página):\n{bloco}"
    # SDK nova + thinking OFF (corte de custo ~67% nos catálogos grandes).
    resp = _gen_text_json(model_name, prompt, max_output_tokens=65535)
    raw = (resp.text or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:].strip()
    return _sanear_codigo_duplo(json.loads(raw).get("produtos", []))


def _sanear_codigo_duplo(produtos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Separa card com DOIS codigos no mesmo campo.

    A FORTAL imprime dois codigos para o mesmo item num unico span do PDF
    ("TL03 | 2063-5", "5028-40MM | HX-5328-40..."). Josef, 16/09/2026: "sairam
    com os dois codigos juntos, barra e tudo, num campo so". O modelo tambem
    erra pro outro lado as vezes, inventando dois produtos. Aqui o campo e
    normalizado de forma deterministica: fica o PRIMEIRO codigo e o segundo vai
    para observacoes, onde o cliente enxerga sem poluir a chave do produto.
    """
    for p in produtos:
        cod = str(p.get("codigo") or "").strip()
        if "|" not in cod:
            continue
        partes = [c.strip() for c in cod.split("|") if c.strip()]
        if len(partes) < 2:
            continue
        p["codigo"] = partes[0]
        alt = ", ".join(partes[1:])
        obs = str(p.get("observacoes") or "").strip()
        marca = f"cod. alt.: {alt}"
        p["observacoes"] = (f"{obs} | {marca}" if obs else marca)[:200]
    return produtos


def _extract_text_chunk(
    page_texts: List[str], first_page: int, supplier_hints: str, model_name: str
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Extrai produtos do TEXTO de um chunk com RESILIÊNCIA (sem perda silenciosa):
      1. tenta o chunk inteiro (2 tentativas);
      2. se falhar (504/timeout/JSON inválido) E o chunk tem >1 página, DIVIDE
         em duas metades e tenta cada uma recursivamente (páginas densas que
         estouram o output viram chamadas menores);
      3. página única que ainda falha é reportada como perdida.
    Retorna (produtos, sucesso_total). sucesso_total=False se alguma página
    do chunk não pôde ser extraída (visível no relatório, não some calado).
    """
    if not _ensure_initialized():
        return [], False
    last_err = None
    for attempt in range(2):
        try:
            return _extract_text_chunk_once(page_texts, first_page, supplier_hints, model_name), True
        except Exception as e:
            last_err = e
            print(f"[Gemini Chunk] pgs {first_page}-{first_page+len(page_texts)-1} tentativa {attempt+1}: {str(e)[:120]}")
            time.sleep(2)
    # Falhou as 2 tentativas → divide ao meio se possível
    if len(page_texts) > 1:
        mid = len(page_texts) // 2
        left, lok = _extract_text_chunk(page_texts[:mid], first_page, supplier_hints, model_name)
        right, rok = _extract_text_chunk(page_texts[mid:], first_page + mid, supplier_hints, model_name)
        return left + right, (lok and rok)
    print(f"[Gemini Chunk] ❌ PÁGINA {first_page} PERDIDA após retries: {str(last_err)[:120]}")
    return [], False


def _extract_vision_chunk(
    jpegs: List[Tuple[int, bytes]], supplier_hints: str, model_name: str,
    page_sizes: Optional[Dict[int, Tuple[float, float]]] = None,
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Lê um lote de páginas RENDERIZADAS. Mesmo prompt do texto — o que muda é
    que o modelo enxerga a página em vez de ler o texto dela.
    """
    if not _ensure_initialized() or not jpegs:
        return [], False
    prompt = EXTRACTION_PROMPT
    if supplier_hints:
        prompt += f"\n\n{supplier_hints}"
    prompt += (
        "\n\nAs imagens a seguir são as PÁGINAS do catálogo, na ordem. "
        "Os números de página correspondentes são: "
        + ", ".join(str(pn) for pn, _ in jpegs)
        + ". Use esses números em paginaOrigem."
    )
    prompt += "\n\n" + VISION_POSITION_HINT
    partes: List[Any] = [{"mime_type": "image/jpeg", "data": b} for _, b in jpegs]
    partes.append(prompt)
    for tentativa in range(2):
        try:
            modelo = genai.GenerativeModel(model_name)
            resposta = modelo.generate_content(
                partes,
                generation_config=genai.GenerationConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                    max_output_tokens=32768,
                ),
                request_options={"timeout": 180},
            )
            raw = (resposta.text or "").strip()
            if raw.startswith("```"):
                raw = raw.strip("`")
                if raw.startswith("json"):
                    raw = raw[4:].strip()
            produtos = _sanear_codigo_duplo(json.loads(raw).get("produtos", []))
            # Numa chamada de página única, a página de origem é FATO conhecido
            # aqui — não precisa (nem deve) depender do modelo acertar.
            if len(jpegs) == 1:
                for p in produtos:
                    page_number = jpegs[0][0]
                    p["paginaOrigem"] = page_number
                    pos = p.pop("posicaoVisual", None)
                    page_size = (page_sizes or {}).get(page_number)
                    if isinstance(pos, dict) and page_size:
                        try:
                            nx = float(pos.get("x"))
                            ny = float(pos.get("y"))
                            if 0 <= nx <= 1000 and 0 <= ny <= 1000:
                                page_width, page_height = page_size
                                # O restante do fluxo usa coordenada PDF.js:
                                # X da esquerda e Y a partir de baixo. A visão
                                # mede Y a partir de cima, então convertemos.
                                p["spatialContext"] = {
                                    "x": nx * page_width / 1000,
                                    "y": page_height - (ny * page_height / 1000),
                                    "width": 0,
                                    "height": 0,
                                    "page": page_number,
                                }
                        except (TypeError, ValueError):
                            pass
            return produtos, True
        except Exception as e:
            pgs = f"{jpegs[0][0]}-{jpegs[-1][0]}"
            print(f"[Gemini Vision] pgs {pgs} tentativa {tentativa+1}: {str(e)[:120]}")
            time.sleep(2)
    return [], False


def _card_rects(page: fitz.Page) -> List[fitz.Rect]:
    """Cards visuais grandes da página (imagem quase quadrada abaixo do
    cabeçalho), sem depender do texto — que não existe nos catálogos que
    chegam na leitura por imagem."""
    rects: List[fitz.Rect] = []
    for info in page.get_image_info(xrefs=True):
        bbox = info.get("bbox")
        if not bbox:
            continue
        rect = fitz.Rect(bbox)
        aspect = rect.width / max(rect.height, 1.0)
        if (
            rect.y0 > page.rect.height * 0.14
            and rect.width >= page.rect.width * 0.18
            and rect.height >= page.rect.height * 0.10
            and 0.70 <= aspect <= 1.45
            and not any(abs(rect.x0 - r.x0) < 1 and abs(rect.y0 - r.y0) < 1 for r in rects)
        ):
            rects.append(rect)
    return rects


def _expected_card_count(page: fitz.Page) -> int:
    return len(_card_rects(page))


CARD_CODE_DPI = 300

_CARD_CODE_PROMPT = """Você recebe {n} recortes de um catálogo. Cada recorte é UM card de produto.
Para CADA recorte, na mesma ordem, leia:
- "codigo": o código do produto EXATAMENTE como impresso no card. Confira dígito por dígito
  (6 x 8, 5 x S, 0 x O, 1 x I). Nunca copie o código de outro card.
- "nome": o nome do produto como impresso.
Responda APENAS JSON: {{"cards": [{{"i": 1, "codigo": "...", "nome": "..."}}, ...]}}"""


def _formato_codigo(codigo: str) -> str:
    return re.sub(r"[A-Za-z]", "A", re.sub(r"\d", "9", str(codigo or "").strip().upper()))


def _nome_chave(nome: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(nome or "").upper())


def _conferir_codigos_por_card(pdf_path: str, page_number: int, produtos: list,
                               model_name: str) -> list:
    """Relê SÓ o código de cada card da página, recortado em alta resolução,
    e corrige o código da leitura da página inteira quando ela errou.

    FOLIA pág. 11 (Josef 24/09/2026): o código fica em letra miúda no rodapé
    do card; lendo a página inteira a IA trocou 6 por 8 (JRF-50.0365 →
    0385) e copiou o número do card vizinho (JRF-50.0040 → 0847, ao lado do
    0848). Troca só quando é seguro:
    - o código da página não aparece em nenhum card relido;
    - existe exatamente um card relido, ainda sem dono, com o MESMO nome;
    - o código relido tem o mesmo formato (letras/dígitos) do original.
    Qualquer falha devolve os produtos intactos.
    """
    if not produtos:
        return produtos
    try:
        doc = fitz.open(pdf_path)
        page = doc.load_page(page_number - 1)
        rects = _card_rects(page)
        if not rects:
            doc.close()
            return produtos
        rects.sort(key=lambda r: (round(r.y0 / 20), r.x0))
        partes: List[Any] = []
        for rect in rects:
            pix = page.get_pixmap(clip=rect, dpi=CARD_CODE_DPI)
            partes.append({"mime_type": "image/jpeg", "data": pix.tobytes("jpeg")})
        doc.close()
        partes.append(_CARD_CODE_PROMPT.format(n=len(rects)))
        modelo = genai.GenerativeModel(model_name)
        resposta = modelo.generate_content(
            partes,
            generation_config=genai.GenerationConfig(
                temperature=0.0, response_mime_type="application/json", max_output_tokens=4096,
            ),
            request_options={"timeout": 120},
        )
        raw = (resposta.text or "").strip().strip("`")
        if raw.startswith("json"):
            raw = raw[4:].strip()
        relidos = [c for c in json.loads(raw).get("cards", []) if c.get("codigo")]
    except Exception as e:
        print(f"[ConfereCodigo] pág {page_number}: falha segura ({str(e)[:80]})")
        return produtos

    codigos_relidos = {str(c["codigo"]).strip().upper() for c in relidos}
    codigos_pagina = {str(p.get("codigo") or "").strip().upper() for p in produtos}
    livres = [c for c in relidos if str(c["codigo"]).strip().upper() not in codigos_pagina]
    trocas = []
    for p in produtos:
        atual = str(p.get("codigo") or "").strip().upper()
        if not atual or atual in codigos_relidos:
            continue
        mesmos = [c for c in livres if _nome_chave(c.get("nome")) == _nome_chave(p.get("nome"))]
        if len(mesmos) != 1:
            continue
        novo = str(mesmos[0]["codigo"]).strip().upper()
        if _formato_codigo(novo) != _formato_codigo(atual):
            continue
        livres.remove(mesmos[0])
        trocas.append((atual, novo))
        p["codigo"] = novo
    if trocas:
        print(f"[ConfereCodigo] pág {page_number}: {len(trocas)} código(s) corrigido(s) pelo recorte do card: {trocas}")

    # Nome: o recorte em alta resolução também lê o nome. Só corrige letra
    # comida/trocada (FOLIA pág. 11, Josef 25/09/2026: "KIT ABRIOR + ROLHA"
    # no lugar de "KIT ABRIDOR + ROLHA"; a releitura veio "ABRI DOR", com o
    # espaço da fonte) — UMA palavra de 4+ letras, UMA letra de diferença.
    # Qualquer outra diferença (2 palavras, número, palavra a mais, sufixo de
    # regra do cliente, só acento) deixa o nome como está: na pág. 12 a
    # releitura trazia "RALO DE DE PIA" pra "RALOS DE PIA".
    por_codigo = {str(c["codigo"]).strip().upper(): c for c in relidos}
    nomes = []
    for p in produtos:
        c = por_codigo.get(str(p.get("codigo") or "").strip().upper())
        if not c or not c.get("nome") or not p.get("nome"):
            continue
        corrigido = _corrigir_letras_pelo_relido(str(p["nome"]), str(c["nome"]))
        if corrigido and corrigido != p["nome"]:
            nomes.append((p["nome"], corrigido))
            p["nome"] = corrigido
    if nomes:
        print(f"[ConfereCodigo] pág {page_number}: {len(nomes)} nome(s) corrigido(s) pelo recorte do card: {nomes}")
    return produtos


def _corrigir_letras_pelo_relido(nome: str, relido: str) -> Optional[str]:
    """Troca no `nome` a (única) palavra que o `relido` mostra com 1 letra
    diferente; ela pode casar com DUAS palavras relidas juntas ("ABRI DOR").
    Devolve None se as leituras não se alinham assim."""
    a, b = nome.split(), relido.split()
    chave = lambda w: _sem_acento(w.upper())
    saida, i, j, trocas = [], 0, 0, 0
    while i < len(a) and j < len(b):
        if chave(a[i]) == chave(b[j]):
            saida.append(a[i]); i += 1; j += 1
            continue
        opcoes = [(b[j], 1)]
        if j + 1 < len(b):
            opcoes.append((b[j] + b[j + 1], 2))
        dist, palavra, passo = min((_distancia_letras(chave(a[i]), chave(w)), w, n) for w, n in opcoes)
        if dist == 0:
            saida.append(a[i]); i += 1; j += passo
            continue
        # número (medida, quantidade) não se corrige por releitura
        plural = chave(a[i]).rstrip("S") == chave(palavra).rstrip("S")
        if dist > 1 or trocas >= 1 or len(a[i]) < 4 or plural or any(ch.isdigit() for ch in a[i] + palavra):
            return None
        saida.append(palavra.upper() if a[i].isupper() else palavra)
        trocas += 1
        i += 1
        j += passo
    if i != len(a) or j != len(b):
        return None
    return " ".join(saida)


def _sem_acento(texto: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c))


def _distancia_letras(a: str, b: str) -> int:
    """Distância de edição (inserção/remoção/troca de 1 letra = 1)."""
    anterior = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        atual = [i]
        for j, cb in enumerate(b, 1):
            atual.append(min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (ca != cb)))
        anterior = atual
    return anterior[-1]


def _merge_vision_products(primary: list, retry: list, limit: int) -> list:
    """Une uma releitura visual sem duplicar códigos nem exceder os cards."""
    merged = []
    seen = set()
    for product in list(primary) + list(retry):
        code = str(product.get("codigo") or "").strip().upper()
        if not code or code in seen:
            continue
        seen.add(code)
        merged.append(product)
    return merged if len(merged) <= limit else list(primary)


def extract_with_vision_chunked(pdf_path: str, supplier: str = "", client_rules: str = "") -> Dict[str, Any]:
    """
    Extração lendo a IMAGEM das páginas — para catálogos cujos produtos não
    estão na camada de texto (ver `camada_de_texto_inutil`). Mesmo shape de
    retorno dos outros caminhos.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    if not _ensure_initialized():
        return {"success": False, "produtos": [], "error": f"Gemini não configurado: {_init_error}", "model": MODEL_FLASH}

    supplier_hints = get_supplier_hints(supplier, client_rules)
    inicio = time.time()
    try:
        doc = fitz.open(pdf_path)
        n_pages = len(doc)
        page_sizes = {
            index + 1: (float(page.rect.width), float(page.rect.height))
            for index, page in enumerate(doc)
        }
        # Cards grandes por página (achado na Folia): se a IA devolver MENOS
        # produtos que cards, relê a página uma vez. Só roda neste caminho,
        # que já é exclusivo de catálogo sem texto; vale pra qualquer nome.
        expected_cards = {
            index + 1: _expected_card_count(page)
            for index, page in enumerate(doc)
        }
        doc.close()
    except Exception as e:
        return {"success": False, "produtos": [], "error": f"Falha ao ler PDF: {e}", "model": MODEL_FLASH}

    lotes = [
        list(range(i + 1, min(i + 1 + VISION_CHUNK_PAGES, n_pages + 1)))
        for i in range(0, n_pages, VISION_CHUNK_PAGES)
    ]
    print(f"[Gemini Vision] {n_pages} págs → {len(lotes)} lotes de {VISION_CHUNK_PAGES} "
          f"(paralelo={VISION_CHUNK_WORKERS}, {VISION_DPI}dpi)")

    todos: List[Dict[str, Any]] = []
    conferir: List[Tuple[int, list]] = []
    lotes_ok = 0
    lotes_parciais = 0
    with ThreadPoolExecutor(max_workers=VISION_CHUNK_WORKERS) as pool:
        futuros = {}
        for paginas in lotes:
            # Renderiza NA HORA de submeter: segurar 45 JPEGs de uma vez seria
            # RAM à toa, e o render é serial de propósito (ver _render_pages_batch).
            jpegs = _render_pages_batch(pdf_path, paginas, dpi=VISION_DPI)
            lote = [(pn, jpegs[pn]) for pn in paginas if pn in jpegs]
            if lote:
                futuros[
                    pool.submit(
                        _extract_vision_chunk, lote, supplier_hints,
                        MODEL_FLASH, page_sizes,
                    )
                ] = (paginas, lote)
        for fut in as_completed(futuros):
            produtos, ok = fut.result()
            paginas, lote = futuros[fut]
            if len(paginas) == 1:
                page_number = paginas[0]
                expected = expected_cards.get(page_number, 0)
                unique_count = len({
                    str(product.get("codigo") or "").strip().upper()
                    for product in produtos if product.get("codigo")
                })
                if expected and unique_count < expected:
                    retry_hints = supplier_hints + (
                        f"\n- ESTA PÁGINA TEM EXATAMENTE {expected} CARDS DE PRODUTO. "
                        f"Revise todos e retorne os {expected} cards, inclusive os parecidos."
                    )
                    retried, retry_ok = _extract_vision_chunk(
                        lote, retry_hints, MODEL_FLASH, page_sizes,
                    )
                    produtos = _merge_vision_products(produtos, retried, expected)
                    ok = ok or retry_ok
                    print(
                        f"[Gemini Vision] pág {page_number}: "
                        f"{unique_count}/{expected} únicos → "
                        f"{len(produtos)} após releitura"
                    )
                if expected and produtos:
                    conferir.append((page_number, produtos))
            if produtos:
                todos.extend(produtos)
            if ok:
                lotes_ok += 1
            else:
                lotes_parciais += 1

    # Conferência do código card a card (ver `_conferir_codigos_por_card`).
    # Corrige os dicts no lugar — são os mesmos objetos que estão em `todos`.
    if conferir:
        with ThreadPoolExecutor(max_workers=VISION_CHUNK_WORKERS) as pool:
            list(pool.map(
                lambda item: _conferir_codigos_por_card(pdf_path, item[0], item[1], MODEL_FLASH),
                conferir,
            ))

    vistos, deduped = set(), []
    for p in todos:
        cod = str(p.get("codigo", "")).strip().upper()
        if not cod or cod in vistos:
            continue
        vistos.add(cod)
        deduped.append(p)

    decorrido = time.time() - inicio
    print(f"[Gemini Vision] ✓ {len(deduped)} produtos ({lotes_ok}/{len(lotes)} lotes OK, "
          f"{lotes_parciais} parciais) em {decorrido:.1f}s")
    return {
        "success": len(deduped) > 0,
        "model": f"{MODEL_FLASH} (vision-chunked)",
        "produtos": deduped,
        "fornecedor_detectado": supplier,
        "total_paginas": n_pages,
        "chunks_total": len(lotes),
        "chunks_ok": lotes_ok,
        "chunks_parciais": lotes_parciais,
        "elapsed": decorrido,
        "confianca": (sum(1 for p in deduped if p.get("codigo") and p.get("preco")) / len(deduped)) if deduped else 0,
        "error": None if deduped else "Nenhum produto extraído nas páginas renderizadas",
    }


def extract_with_fallback_text_chunked(pdf_path: str, supplier: str = "", client_rules: str = "") -> Dict[str, Any]:
    """
    Extração por TEXTO em chunks paralelos — para catálogos grandes/pesados.
    Retorna o mesmo shape de extract_with_fallback.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    if not _ensure_initialized():
        return {"success": False, "produtos": [], "error": f"Gemini não configurado: {_init_error}", "model": MODEL_FLASH}

    supplier_hints = get_supplier_hints(supplier, client_rules)
    start = time.time()

    # Extrai texto por página (rápido, baixa RAM — 1 fitz.open)
    page_texts: List[str] = []
    try:
        doc = fitz.open(pdf_path)
        for i in range(len(doc)):
            # Com COORDENADA: sem ela o preço de um produto vira o preço do
            # vizinho em catálogo de grade. Ver page_text_for_ai().
            page_texts.append(page_text_for_ai(doc[i]))
        doc.close()
    except Exception as e:
        return {"success": False, "produtos": [], "error": f"Falha ao ler PDF: {e}", "model": MODEL_FLASH}

    n_pages = len(page_texts)
    chunks = [(i, page_texts[i:i + TEXT_CHUNK_PAGES]) for i in range(0, n_pages, TEXT_CHUNK_PAGES)]
    print(f"[Gemini TextChunk] {n_pages} págs → {len(chunks)} chunks de {TEXT_CHUNK_PAGES} (paralelo={TEXT_CHUNK_WORKERS})")

    all_produtos: List[Dict[str, Any]] = []
    chunks_ok = 0
    chunks_parciais = 0
    with ThreadPoolExecutor(max_workers=TEXT_CHUNK_WORKERS) as pool:
        futures = {
            pool.submit(_extract_text_chunk, texts, first + 1, supplier_hints, MODEL_FLASH): first
            for first, texts in chunks
        }
        for fut in as_completed(futures):
            prods, ok = fut.result()
            if prods:
                all_produtos.extend(prods)
            if ok:
                chunks_ok += 1
            else:
                chunks_parciais += 1  # alguma página do chunk não extraiu (visível)

    # Dedup por código (chunks não se sobrepõem, mas é defensivo)
    seen, deduped = set(), []
    for p in all_produtos:
        cod = str(p.get("codigo", "")).strip().upper()
        if not cod or cod in seen:
            continue
        seen.add(cod)
        deduped.append(p)

    elapsed = time.time() - start
    print(f"[Gemini TextChunk] ✓ {len(deduped)} produtos ({chunks_ok}/{len(chunks)} chunks OK, "
          f"{chunks_parciais} parciais) em {elapsed:.1f}s")
    return {
        "success": len(deduped) > 0,
        "model": f"{MODEL_FLASH} (text-chunked)",
        "produtos": deduped,
        "fornecedor_detectado": supplier,
        "total_paginas": n_pages,
        "chunks_total": len(chunks),
        "chunks_ok": chunks_ok,
        "chunks_parciais": chunks_parciais,  # transparência: chunks com perda
        "elapsed": elapsed,
        "confianca": (sum(1 for p in deduped if p.get("codigo") and p.get("preco")) / len(deduped)) if deduped else 0,
        "error": None if deduped else "Nenhum produto extraído nos chunks",
    }


# ─────────────────────────────────────────────────────────────
# v33 — Template synthesis: IA infere regex de amostra; código aplica
# ─────────────────────────────────────────────────────────────

_TEMPLATE_PROMPT = """Você recebe páginas-amostra de um catálogo B2B. Cada PRODUTO é um BLOCO que começa por um CÓDIGO.
Crie regexes Python (módulo re, rodam com re.MULTILINE e re.DOTALL no texto de UMA página) para extrair os campos.

REGRAS DOS REGEX: Python re; NÃO use lookbehind de largura variável (?<=...) — só grupos de captura simples; cada regex deve COMPILAR em Python.

Responda EXATAMENTE estas linhas, formato CHAVE===valor, regex CRU (NÃO escape para JSON), 1 grupo de captura em cada regex:
CODE===<regex do código do produto, com 1 grupo>
NOME===<regex do nome/descrição, 1 grupo, ou NONE>
PRECO===<regex que captura o NÚMERO do preço, 1 grupo, ou NONE>
QTD===<regex que captura a quantidade por caixa, 1 grupo, ou NONE>
PRECO_FMT===<um de: BR (ex 19,84 ou 1.234,56) | CENTS (inteiro em centavos, ex 0690=6,90 ou 3600=36,00)>

{hints}
EXEMPLO de formato (NÃO copie — deduza dos dados reais):
CODE===^([A-Z]{{2}}\\d+)
NOME===(?s)^[A-Z]{{2}}\\d+\\s*\\n(.+?)\\nQuant:
PRECO===Pre[çc]o:\\s*R\\$\\s*([\\d.,]+)
QTD===Quant:\\s*(\\d+)
PRECO_FMT===BR

AMOSTRAS REAIS:
{samples}
"""


def _synthesize_template(sample_texts: List[str], supplier_hints: str, model_name: str) -> Optional[Dict[str, str]]:
    """1 chamada Gemini → template de extração (delimitador, sem JSON)."""
    if not _ensure_initialized():
        return None
    hints_block = (f"DICAS DO FORNECEDOR (use para acertar os regexes):\n{supplier_hints}\n" if supplier_hints else "")
    prompt = _TEMPLATE_PROMPT.format(hints=hints_block, samples="\n=====\n".join(sample_texts))
    try:
        resp = _gen_text_json(model_name, prompt, max_output_tokens=4096, temperature=0.0, json_out=False)
        tpl: Dict[str, str] = {}
        for line in (resp.text or "").splitlines():
            if "===" in line:
                k, v = line.split("===", 1)
                tpl[k.strip()] = v.strip()
        if "CODE" not in tpl or not tpl["CODE"]:
            return None
        # Compila os regexes pra validar (regex inválido → template inútil)
        re.compile(tpl["CODE"], re.M)
        for k in ("NOME", "PRECO", "QTD"):
            v = tpl.get(k, "NONE")
            if v and v != "NONE":
                re.compile(v, re.M | re.S)
        return tpl
    except Exception as e:
        print(f"[Template] síntese falhou: {str(e)[:160]}")
        return None


_TEMPLATE_FIX_PROMPT = """Você criou estes regexes de extração, mas eles capturaram PREÇO de apenas {cov}% dos produtos da amostra. CORRIJA.

Template atual (formato CHAVE===regex):
{tpl}

Produtos cujo PREÇO/QTD NÃO foram capturados (códigos): {fails}

{hints}
Olhe COM ATENÇÃO como preço e quantidade aparecem nas amostras abaixo e reescreva os regexes que falham. Lembre: PRECO_FMT=CENTS quando o preço é inteiro em centavos (ex 0690=6,90, 3600=36,00); BR quando tem vírgula decimal.
NÃO use lookbehind de largura variável (?<=...) — só grupos de captura. Cada regex deve COMPILAR em Python re.
Responda EXATAMENTE no MESMO formato (CODE===, NOME===, PRECO===, QTD===, PRECO_FMT===), regex CRU, 1 grupo cada.

AMOSTRAS:
{samples}
"""


def _correct_template(tpl: Dict[str, str], sample_texts: List[str], fails: List[str],
                      cov: float, supplier_hints: str, model_name: str) -> Optional[Dict[str, str]]:
    """Pede à IA para corrigir os regexes do template, dado o que falhou."""
    if not _ensure_initialized():
        return None
    tpl_str = "\n".join(f"{k}==={v}" for k, v in tpl.items())
    hints_block = (f"DICAS DO FORNECEDOR:\n{supplier_hints}\n" if supplier_hints else "")
    prompt = _TEMPLATE_FIX_PROMPT.format(
        cov=round(cov * 100), tpl=tpl_str, fails=", ".join(fails) or "(vários)",
        hints=hints_block, samples="\n=====\n".join(sample_texts))
    try:
        resp = _gen_text_json(model_name, prompt, max_output_tokens=4096, temperature=0.0, json_out=False)
        nt: Dict[str, str] = {}
        for line in (resp.text or "").splitlines():
            if "===" in line:
                k, v = line.split("===", 1)
                nt[k.strip()] = v.strip()
        if "CODE" not in nt or not nt["CODE"]:
            return None
        re.compile(nt["CODE"], re.M)
        for k in ("NOME", "PRECO", "QTD"):
            v = nt.get(k, "NONE")
            if v and v != "NONE":
                re.compile(v, re.M | re.S)
        return nt
    except Exception as e:
        print(f"[Template] correção falhou: {str(e)[:120]}")
        return None


def _eval_template(tpl: Dict[str, str], texts: List[str]) -> Tuple[List[Dict[str, Any]], float]:
    """Aplica o template e mede cobertura de preço (0..1)."""
    prods = _apply_template(texts, tpl)
    if not prods:
        return prods, 0.0
    return prods, sum(1 for p in prods if p.get("preco")) / len(prods)


def _synthesize_template_robust(sample_texts: List[str], supplier_hints: str,
                                model_name: str, max_fix_rounds: int = 2) -> Tuple[Optional[Dict[str, str]], float]:
    """
    Síntese ROBUSTA avaliada na AMOSTRA (barato):
      - tenta sintetizar (2x, pois síntese é não-determinística);
      - mede cobertura na amostra; se baixa, pede correção à IA (até N rodadas),
        mantendo só correções que MELHORAM;
      - retorna (melhor_template, melhor_cobertura_na_amostra).
    Tudo nas ~3 páginas-amostra → 1 a 4 chamadas pequenas, segundos.
    """
    tpl = None
    for _ in range(2):
        tpl = _synthesize_template(sample_texts, supplier_hints, model_name)
        if tpl:
            break
    if not tpl:
        return None, 0.0
    prods, cov = _eval_template(tpl, sample_texts)
    for rnd in range(max_fix_rounds):
        if cov >= TEMPLATE_MIN_COVERAGE:
            break
        fails = [p["codigo"] for p in prods if not p.get("preco")][:6]
        corrected = _correct_template(tpl, sample_texts, fails, cov, supplier_hints, model_name)
        if not corrected:
            break
        nprods, ncov = _eval_template(corrected, sample_texts)
        print(f"[Template] correção rodada {rnd+1}: {round(cov*100)}% → {round(ncov*100)}%")
        if ncov > cov:
            tpl, prods, cov = corrected, nprods, ncov
        else:
            break  # não melhorou; para
    return tpl, cov


def _code_looks_valid(code: str) -> bool:
    """Heurística genérica de CÓDIGO plausível (sem fornecedor-específico).
    Protege o caminho rápido quando a IA infere um CODE regex errado (ex:
    fornecedor NOVO sem hints, layout nome-antes-do-código) e captura preço/
    palavra como 'código'. Código bom: alfanumérico curto, sem espaço, sem R$,
    não é preço puro."""
    if not code:
        return False
    c = str(code).strip()
    if not (2 <= len(c) <= 24):
        return False
    if " " in c or "$" in c.upper().replace("R$", "$"):
        return False
    if "R$" in c.upper():
        return False
    if re.match(r"^\d{1,3}([.,]\d{3})*[.,]\d{2}$", c):  # preço puro (44,00 / 1.234,56)
        return False
    if not re.match(r"^[A-Za-z0-9][\w\-./]{1,23}$", c):
        return False
    return True


def _norm_price(raw: str, fmt: str) -> Optional[float]:
    """Normaliza preço capturado conforme o formato (BR ou CENTS)."""
    if raw is None:
        return None
    s = str(raw).strip()
    try:
        if fmt == "CENTS":
            digits = re.sub(r"\D", "", s)
            return round(int(digits) / 100.0, 2) if digits else None
        # BR: 1.234,56 → 1234.56 ; 19,84 → 19.84 ; 19.84 → 19.84
        s = s.replace(".", "").replace(",", ".") if ("," in s) else s
        v = float(s)
        return round(v, 2) if 0 < v < 1_000_000 else None
    except (ValueError, TypeError):
        return None


def _price_looks_like_code(codigo: str, preco: Any, fmt: str = "BR") -> bool:
    """True se o preço == número embutido no CÓDIGO (sinal de regex de preço
    FROUXO que capturou os dígitos do código em vez do preço real).

    Bug DAGIA (23/06/2026): catálogo com preços AGRUPADOS no fim da página +
    template sintetizado com PRECO regex frouxo → cada produto recebeu os
    dígitos do próprio código como "preço" (ES7018→7018, EY3003→3003, DV091→91).
    A cobertura ficava 100% (todo produto "com preço") e o gate não disparava
    o fallback. Validado deterministicamente contra o catálogo real.

    SEGURANÇA (validado por análise adversarial cross-supplier, 23/06):
      - SÓ fmt=='BR'. CENTS (GIRA '0690'→6.90, BM36 '3600'→36.00) divide por 100
        e nunca produz inteiro == dígitos do código → pulado de saída.
      - SÓ preço INTEIRO (sem centavos reais). R$ X,XX nunca é sinalizado.
      - SÓ preço >= 10. Evita falso-positivo de preço pequeno legítimo (R$2-R$9)
        que coincida com dígitos do código (ex.: HP002 custando R$2 de verdade).
      - Compara contra QUALQUER run de dígitos do código (ES7018-1R → '7018').
    A decisão de fallback usa a FRAÇÃO de produtos nesse estado (>=50% em
    extract_via_template), nunca 1 caso isolado — dupla proteção contra
    falso-positivo de um preço real que por acaso bate com o número do código.
    """
    if preco is None or str(fmt or "BR").upper() != "BR":
        return False
    try:
        pv = float(preco)
    except (ValueError, TypeError):
        return False
    if pv != int(pv) or pv < 10:
        return False  # centavos reais OU preço pequeno → trata como preço legítimo
    pv_str = str(int(pv))
    for run in re.findall(r"\d+", str(codigo or "")):
        if run == pv_str or run.lstrip("0") == pv_str:
            return True
    return False


def _widen_nome_capture(pattern: str) -> str:
    """Substitui o CONTEÚDO do único grupo de captura por [^\\n]+ (ou +?),
    preservando as âncoras (o que está FORA do grupo). A IA sintetiza a
    classe de caracteres do NOME olhando uma amostra pequena (ex.:
    [A-Z0-9\\s.,-]) e nomes de produto em português têm acento/minúscula que
    essa classe trunca no meio — a âncora (o texto fixo antes/depois do
    grupo) já delimita onde o nome começa e termina, então a classe de
    caracteres do meio é desnecessária e só atrapalha. Achado real: BM36
    catálogo 17/09/2026, nome cortado em 13/13 amostras (ver PR de correção).
    Falha segura: se não achar um grupo de captura real, devolve o original.
    """
    n = len(pattern)
    i = 0
    while i < n:
        ch = pattern[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "[":
            j = i + 1
            if j < n and pattern[j] == "]":
                j += 1
            while j < n and pattern[j] != "]":
                if pattern[j] == "\\":
                    j += 1
                j += 1
            i = j + 1
            continue
        if ch == "(":
            is_named = pattern[i:i + 4] == "(?P<"
            is_noncap = pattern[i:i + 2] == "(?" and not is_named
            if is_noncap:
                i += 1
                continue
            prefix_end = pattern.index(">", i) + 1 if is_named else i + 1
            depth = 1
            k = prefix_end
            while k < n and depth > 0:
                c2 = pattern[k]
                if c2 == "\\":
                    k += 2
                    continue
                if c2 == "[":
                    k += 1
                    if k < n and pattern[k] == "]":
                        k += 1
                    while k < n and pattern[k] != "]":
                        if pattern[k] == "\\":
                            k += 1
                        k += 1
                    k += 1
                    continue
                if c2 == "(":
                    depth += 1
                elif c2 == ")":
                    depth -= 1
                    if depth == 0:
                        break
                k += 1
            inner = pattern[prefix_end:k]
            suffix = "+?" if inner.rstrip().endswith("?") else "+"
            return pattern[:prefix_end] + "[^\\n]" + suffix + pattern[k:]
        i += 1
    return pattern


def _nome_linha_anterior(texto: str, codigo: str, skip_res: List["re.Pattern"]) -> str:
    """Último trecho de texto "de nome" no fim de `texto` (a janela antes do
    código). Ignora linhas que casam CODE/PRECO/QTD do template, EAN/numéricas,
    "Pag: N" e o próprio código. Só é usado quando o NOME sintetizado não casou
    (BM36 pág. 71: código sozinho na linha; pág. 92: bloco sem linha de EAN)."""
    for ln in reversed(texto.split(chr(10))):
        ln = ln.strip()
        if not ln or ln.upper() == codigo.upper():
            continue
        if re.fullmatch(r"(?:[A-Za-z]{1,6}:\s*)?[\d\s.,/:;+*#\-]+", ln) or re.match(r"(?i)^p[aá]g(ina)?", ln):
            continue
        if any(r.search(ln) for r in skip_res):
            continue
        nome = re.sub(rf"\s*{re.escape(codigo)}\s*$", "", ln, flags=re.I).strip()
        if len(nome) >= 3 and re.search(r"[A-Za-zÀ-ú]{2,}", nome):
            return re.sub(r"\s+", " ", nome)
    return ""


def _prefixo_do_codigo(pattern: str) -> Optional[str]:
    """Trecho do CODE regex ANTES do primeiro grupo de captura (o rótulo fixo
    do código, ex.: "CD: "). None se não houver grupo de captura."""
    i, n = 0, len(pattern)
    while i < n:
        ch = pattern[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "[":
            j = i + 1
            if j < n and pattern[j] == "]":
                j += 1
            while j < n and pattern[j] != "]":
                if pattern[j] == "\\":
                    j += 1
                j += 1
            i = j + 1
            continue
        if ch == "(" and (pattern[i:i + 2] != "(?" or pattern[i:i + 4] == "(?P<"):
            return pattern[:i]
        i += 1
    return None


def _codigos_fora_do_padrao(txt: str, code_pattern: str, fixos: List[Tuple[int, int, str]],
                            rx_preco: Optional["re.Pattern"]) -> List[Tuple[int, int, str]]:
    """Produtos cujo código tem o MESMO rótulo do padrão ("CD: ") mas formato
    diferente do que a IA generalizou na amostra — BM36 23/09/2026: o
    template aprendeu `CD: (BM\\d{6}|WC\\d{6,7})` e os ímãs "CD: GH-1" /
    "CD: GH-2BI" sumiram da exportação.

    Medido no próprio texto, sem lista de prefixos: mantém o rótulo fixo que
    vem antes do grupo de captura e troca o formato do código por um token
    genérico. Um candidato só vira produto se o bloco dele (até o próximo
    código) tiver um PREÇO do template — é isso que separa um produto de
    outra linha com o mesmo rótulo (ex.: "CD: <EAN>" logo acima do código
    real, sem preço entre os dois). Rótulo sem pelo menos 2 letras (ex.: só
    "^") não é usado: casaria qualquer linha.
    """
    if rx_preco is None:
        return []
    prefixo = _prefixo_do_codigo(code_pattern)
    if not prefixo or len(re.findall(r"(?<!\\)[A-Za-z]", prefixo)) < 2:
        return []
    try:
        rx = re.compile(prefixo + r"([A-Za-z0-9][A-Za-z0-9\-./]{0,23})(?![A-Za-z0-9\-./])", re.M)
    except re.error:
        return []
    candidatos = []
    for m in rx.finditer(txt):
        codigo = m.group(1).strip()
        if any(ini <= m.start(1) < fim for ini, fim, _c in fixos):
            continue
        if not re.search(r"\d", codigo) or not _code_looks_valid(codigo):
            continue
        candidatos.append((m.start(), m.end(), codigo))
    if not candidatos:
        return []
    todos = sorted([(ini, fim, c, True) for ini, fim, c in fixos]
                   + [(ini, fim, c, False) for ini, fim, c in candidatos])
    extras = []
    for k, (ini, fim, codigo, fixo) in enumerate(todos):
        if fixo:
            continue
        prox = todos[k + 1][0] if k + 1 < len(todos) else len(txt)
        if rx_preco.search(txt[fim:prox]):
            extras.append((ini, fim, codigo))
    return extras


def _apply_template(page_texts: List[str], tpl: Dict[str, str]) -> List[Dict[str, Any]]:
    """Aplica o template em TODAS as páginas (determinístico, instantâneo)."""
    code_re = re.compile(tpl["CODE"], re.M)
    fmt = tpl.get("PRECO_FMT", "BR").upper()

    def mk(key, widen=False):
        v = tpl.get(key, "NONE")
        if not v or v == "NONE":
            return None
        if widen:
            try:
                v = _widen_nome_capture(v)
            except Exception:
                pass
        return re.compile(v, re.M | re.S)

    # NOME é tratado à parte (ver abaixo): classe de caractere ampliada +
    # busca bidirecional, porque a IA pode sintetizar um NOME que aparece
    # ANTES do código no bloco (ex.: BM36 "NOME ... CÓDIGO \nCD: <EAN>"), e
    # nesse caso o nome do produto atual fica no texto ANTES do match de
    # CODE, não depois. Ver `_widen_nome_capture` e o histórico do achado.
    rx_nome, rx_preco, rx_qtd = mk("NOME", widen=True), mk("PRECO"), mk("QTD")

    # 1) códigos por página: os do padrão + os fora do padrão com o mesmo
    #    rótulo e preço no bloco (ver `_codigos_fora_do_padrao`). Se os "fora
    #    do padrão" passarem de 10% do total, o rótulo é genérico demais pra
    #    confiar — descarta todos (falha segura = comportamento anterior).
    por_pagina: List[List[Tuple[int, int, str]]] = []
    fixos_por_pagina: List[List[Tuple[int, int, str]]] = []
    total_fixos, total_extras = 0, 0
    for txt in page_texts:
        fixos = []
        for mm in code_re.finditer(txt):
            codigo = (mm.group(1) if mm.groups() else mm.group(0)) or ""
            fixos.append((mm.start(), mm.end(), codigo.strip()))
        extras = _codigos_fora_do_padrao(txt, tpl["CODE"], fixos, rx_preco)
        total_fixos += len(fixos)
        total_extras += len(extras)
        fixos_por_pagina.append(fixos)
        por_pagina.append(sorted(fixos + extras))
    if total_extras:
        if total_extras > 0.10 * max(total_fixos, 1):
            print(f"[Template] {total_extras} códigos fora do padrão (> 10% de {total_fixos}) — rótulo genérico demais, ignorados")
            por_pagina = fixos_por_pagina
        else:
            print(f"[Template] {total_extras} código(s) fora do padrão do template incluído(s) (mesmo rótulo, com preço no bloco)")

    # 2) lado do NOME em relação ao código, MEDIDO no catálogo: para cada
    #    código, o NOME mais próximo está antes ou depois? Se um lado domina
    #    (>=80%), só aceita nome desse lado. Sem isso, um produto sem a linha
    #    que ancora o NOME (BM36 23/09/2026: BM361548 sem EAN) pegava o nome
    #    do PRÓXIMO produto, que ficava "mais perto" pelo outro lado.
    lado_nome = None
    if rx_nome:
        votos = {"antes": 0, "depois": 0}
        for pi, txt in enumerate(page_texts):
            ms = por_pagina[pi]
            for j, (ini, _fim, _c) in enumerate(ms):
                lo = ms[j - 1][1] if j > 0 else 0
                hi = ms[j + 1][0] if j + 1 < len(ms) else len(txt)
                pos = ini - lo
                melhor = None
                for fm in rx_nome.finditer(txt[lo:hi]):
                    if not fm.groups():
                        continue
                    dist = min(abs(fm.start() - pos), abs(fm.end() - pos))
                    if melhor is None or dist < melhor[0]:
                        melhor = (dist, "antes" if fm.end() <= pos else "depois")
                if melhor:
                    votos[melhor[1]] += 1
        total_votos = votos["antes"] + votos["depois"]
        for lado in ("antes", "depois"):
            if total_votos and votos[lado] >= 0.8 * total_votos:
                lado_nome = lado

    produtos: List[Dict[str, Any]] = []
    for pi, txt in enumerate(page_texts):
        matches = por_pagina[pi]
        for j, (m_ini, m_fim, codigo) in enumerate(matches):
            blk = txt[m_ini: matches[j + 1][0] if j + 1 < len(matches) else len(txt)]
            if not codigo:
                continue
            prod: Dict[str, Any] = {"codigo": codigo, "paginaOrigem": pi + 1}
            if rx_nome:
                # Janela BIDIRECIONAL: do fim do código ANTERIOR até o início
                # do PRÓXIMO — cobre tanto "nome depois do código" (padrão)
                # quanto "nome antes do código" (BM36). Entre os matches de
                # NOME dentro dessa janela, fica o mais PRÓXIMO da posição do
                # código atual, só do lado medido em `lado_nome`.
                lo = matches[j - 1][1] if j > 0 else 0
                hi = matches[j + 1][0] if j + 1 < len(matches) else len(txt)
                wide_blk = txt[lo:hi]
                code_pos = m_ini - lo
                best = None
                for fm in rx_nome.finditer(wide_blk):
                    if not fm.groups():
                        continue
                    if lado_nome == "antes" and fm.end() > code_pos:
                        continue
                    if lado_nome == "depois" and fm.start() < code_pos:
                        continue
                    dist = min(abs(fm.start() - code_pos), abs(fm.end() - code_pos))
                    if best is None or dist < best[0]:
                        best = (dist, fm)
                if best:
                    nome = re.sub(r"\s+", " ", best[1].group(1)).strip()
                    # Alguns catálogos repetem o próprio código no fim da
                    # linha do nome (achado no BM36) — tira se sobrou.
                    nome = re.sub(rf"\s*{re.escape(codigo)}\s*$", "", nome, flags=re.I).strip()
                    if nome:
                        prod["nome"] = nome
                if not prod.get("nome"):
                    nome = _nome_linha_anterior(
                        txt[lo:m_ini], codigo,
                        [r for r in (code_re, rx_preco, rx_qtd) if r],
                    )
                    if nome:
                        prod["nome"] = nome
            if rx_preco:
                fm = rx_preco.search(blk)
                if fm and fm.groups():
                    prod["preco"] = _norm_price(fm.group(1), fmt)
            if rx_qtd:
                fm = rx_qtd.search(blk)
                if fm and fm.groups():
                    try:
                        prod["quantidadeCaixa"] = int(re.sub(r"\D", "", fm.group(1)) or 0) or None
                    except ValueError:
                        pass
            produtos.append(prod)
    return produtos


_NOME_COM_PRECO_RE = re.compile(r"R\$|\d+,\d{2}\b")


def _template_desalinhado(page_texts: List[str], tpl: Dict[str, str],
                          produtos: List[Dict[str, Any]]) -> Optional[str]:
    """O modelo de bloco do template fatia o texto A PARTIR do código e lê o
    preço DEPOIS dele. Em catálogo onde nome e preço vêm ANTES do código, o
    preço lido é o do produto seguinte e o "nome" vira a linha de preço de
    display (Neo Festas 24/09/2026: 479 nomes "R$ 37,68 Disp. c/24 un." e
    preço do vizinho). Dois sinais, medidos no próprio catálogo:

    1. lado do preço: numa página, o 1º código tem preço ANTES dele e o
       último não tem nenhum DEPOIS → preço vem antes do código. Medido:
       Neo 54/54 páginas "antes"; BM36 122/122 "depois".
    2. nome que é preço: >5% dos nomes com "R$" ou valor "12,34".

    Devolve o motivo (texto) ou None.
    """
    try:
        code_re = re.compile(tpl["CODE"], re.M)
        preco_re = re.compile(tpl["PRECO"], re.M | re.S) if tpl.get("PRECO") not in (None, "", "NONE") else None
    except re.error:
        return None
    if preco_re is not None:
        antes = depois = 0
        for txt in page_texts:
            ms = list(code_re.finditer(txt))
            if len(ms) < 2:
                continue
            preco_antes = bool(preco_re.search(txt[:ms[0].start()]))
            preco_depois = bool(preco_re.search(txt[ms[-1].end():]))
            if preco_antes and not preco_depois:
                antes += 1
            elif preco_depois and not preco_antes:
                depois += 1
        if antes >= 3 and antes >= 0.6 * (antes + depois):
            return f"preço vem ANTES do código em {antes}/{antes + depois} páginas (template lê depois)"
    com_nome = [p for p in produtos if p.get("nome")]
    if com_nome:
        nomes_preco = sum(1 for p in com_nome if _NOME_COM_PRECO_RE.search(str(p["nome"])))
        if nomes_preco > 0.05 * len(com_nome):
            return f"{nomes_preco}/{len(com_nome)} nomes são texto de preço"
    return None


def extract_via_template(pdf_path: str, supplier: str = "", client_rules: str = "") -> Optional[Dict[str, Any]]:
    """
    Caminho RÁPIDO: IA infere template de amostra, código aplica em todas as
    páginas. Retorna o resultado se a cobertura for boa; senão None (o caller
    cai no AI-first text-chunked). NUNCA regride abaixo do AI-first.
    """
    if not _ensure_initialized():
        return None
    start = time.time()
    try:
        doc = fitz.open(pdf_path)
        # Asterisco de rodapé (marca preço promocional/riscado, ex: "B8460*B10152**")
        # não carrega valor pro modelo CODE/NOME/PRECO/QTD e só quebra o PRECO
        # regex sintetizado, que nunca viu essa variante na amostra → produto
        # some da exportação por "preço não encontrado" (BM36 22/09, BM362346).
        page_texts = [doc[i].get_text().replace("*", "") for i in range(len(doc))]
        doc.close()
    except Exception as e:
        print(f"[Template] falha ao ler PDF: {e}")
        return None

    # Amostra: primeiras páginas com vários códigos + indício de preço
    samples = [t for t in page_texts if len(t.strip()) > 80 and re.search(r"\d+[.,]\d{2}|R\$|\d{3,}", t)][:TEMPLATE_SAMPLE_PAGES]
    if len(samples) < 1:
        return None

    supplier_hints = get_supplier_hints(supplier, client_rules)
    # Síntese ROBUSTA avaliada na amostra (com auto-correção). Barato/rápido.
    tpl, sample_cov = _synthesize_template_robust(samples, supplier_hints, MODEL_FLASH)
    if not tpl:
        print("[Template] sem template válido → fallback AI-first")
        return None
    if sample_cov < TEMPLATE_MIN_COVERAGE:
        print(f"[Template] cobertura na amostra {sample_cov:.0%} < {TEMPLATE_MIN_COVERAGE:.0%} → fallback AI-first")
        return None

    # Template confiável na amostra → aplica em TODAS as páginas (instantâneo)
    produtos = _apply_template(page_texts, tpl)
    seen, deduped = set(), []
    for p in produtos:
        c = str(p.get("codigo", "")).strip().upper()
        if c and c not in seen:
            seen.add(c)
            deduped.append(p)

    if not deduped:
        return None
    cobertura = sum(1 for p in deduped if p.get("codigo") and p.get("preco")) / len(deduped)
    cov_qtd = sum(1 for p in deduped if p.get("quantidadeCaixa")) / len(deduped)
    cov_nome = sum(1 for p in deduped if p.get("nome") and str(p.get("nome")).strip()) / len(deduped)
    print(f"[Template] {len(deduped)} produtos | preço {cobertura:.0%} | qtd {cov_qtd:.0%} | nome {cov_nome:.0%} (amostra {sample_cov:.0%}) | tpl={tpl}")
    # GATE de QUALIDADE: o template só vale o caminho rápido se pegar bem preço
    # E quantidade. Senão, AI-first (qualidade cheia) — nunca regride dados.
    # Ex.: GIRA pegou 100% preço mas 0% qtd → cai no AI-first (que pega qtd).
    if cov_qtd < 0.5:
        print(f"[Template] qtd {cov_qtd:.0%} < 50% → fallback AI-first (preserva qualidade)")
        return None
    # GATE de NOME (16/06/2026): o modelo de bloco (split por CÓDIGO) só captura
    # o nome quando ele vem DEPOIS do código no bloco. Em catálogos onde o nome
    # vem ANTES do código (ex: BM36 "NOME ... CÓDIGO \nCD: <EAN>"), o nome é
    # deslocado/perdido → preço/qtd ok mas nome ~38%. Não dá p/ corrigir por
    # página (os nomes presentes podem estar DESLOCADOS = errados, não vazios),
    # então caímos no AI-first text-chunked (100% nome, validado localmente).
    if cov_nome < TEMPLATE_MIN_COVERAGE:
        print(f"[Template] nome {cov_nome:.0%} < {TEMPLATE_MIN_COVERAGE:.0%} → fallback AI-first (template não modela o nome corretamente)")
        return None
    # GATE de CÓDIGO (fornecedor NOVO sem hints): se a IA inferiu um CODE regex
    # errado (captura preço/palavra como 'código'), os códigos saem inválidos.
    # Essencial p/ o fluxo autônomo "cadastra só pelo nome + sobe catálogo".
    cov_code = sum(1 for p in deduped if _code_looks_valid(p.get("codigo", ""))) / len(deduped)
    if cov_code < TEMPLATE_MIN_COVERAGE:
        print(f"[Template] código válido {cov_code:.0%} < {TEMPLATE_MIN_COVERAGE:.0%} → fallback AI-first (CODE regex inferido errado)")
        return None
    motivo = _template_desalinhado(page_texts, tpl, deduped)
    if motivo:
        print(f"[Template] {motivo} → fallback AI-first")
        return None

    # ─── GATE PREÇO-VINDO-DO-CÓDIGO (23/06/2026) ───────────────────────────
    # Se a MAIORIA dos preços é igual ao número do próprio código, o PRECO
    # regex sintetizado é frouxo (capturou os dígitos do código). Sinal de
    # catálogo com preços AGRUPADOS no fim da página (ex: DAGIA), que o modelo
    # de bloco-por-código NÃO consegue mapear. Cai no AI text-chunked, que faz
    # o mapeamento posicional corretamente. Threshold 50% (a fração no DAGIA
    # real é ~89%) evita falso-positivo de coincidência isolada (1-2 produtos).
    tpl_fmt = (tpl.get("PRECO_FMT") or "BR")
    com_preco = [p for p in deduped if p.get("preco")]
    if com_preco:
        code_as_price = sum(1 for p in com_preco if _price_looks_like_code(p.get("codigo"), p.get("preco"), tpl_fmt))
        frac_cap = code_as_price / len(com_preco)
        if frac_cap >= 0.5:
            print(f"[Template] {frac_cap:.0%} dos preços == número do código → PRECO regex inválido, fallback AI text-chunked (DAGIA-like)")
            return None

    # ─── FALLBACK POR PÁGINA (v33): IA só nas páginas que o template ERROU ───
    # "Só gastar com o que dá problema." Identifica páginas onde o template
    # extraiu produtos mas a maioria ficou SEM preço (padrão diferente da
    # amostra — ex: páginas tabela/lista no BM36, multi-variante no NeoFestas),
    # e re-extrai SÓ essas páginas via IA, em paralelo. Mescla (IA vence).
    from concurrent.futures import ThreadPoolExecutor, as_completed
    page_stats: Dict[int, List[int]] = {}  # pagina → [total, com_preco]
    for p in deduped:
        pg = int(p.get("paginaOrigem", 0))
        st = page_stats.setdefault(pg, [0, 0])
        st[0] += 1
        # preço-vindo-do-código NÃO conta como preço válido (força re-extração IA da página)
        if p.get("preco") and not _price_looks_like_code(p.get("codigo"), p.get("preco"), tpl_fmt):
            st[1] += 1
    bad_pages = sorted([pg for pg, (tot, ok) in page_stats.items()
                        if pg >= 1 and tot >= 2 and (ok / tot) < 0.6])
    fallback_used = 0
    if bad_pages and len(bad_pages) <= len(page_stats):  # nunca o catálogo inteiro
        print(f"[Template] {len(bad_pages)} páginas abaixo de 60% preço → fallback IA por página")
        # agrupa páginas ruins em chunks de TEXT_CHUNK_PAGES p/ paralelizar
        groups = [bad_pages[i:i + TEXT_CHUNK_PAGES] for i in range(0, len(bad_pages), TEXT_CHUNK_PAGES)]
        ai_prods: List[Dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=TEXT_CHUNK_WORKERS) as pool:
            futs = {pool.submit(_extract_text_chunk, [page_texts[pg - 1] for pg in grp], grp[0], supplier_hints, MODEL_FLASH): grp for grp in groups}
            for fut in as_completed(futs):
                prods, _ok = fut.result()
                if prods:
                    ai_prods.extend(prods)
        # Mescla: IA vence para os códigos que ela trouxe
        ai_by_code = {str(p.get("codigo", "")).strip().upper(): p for p in ai_prods if p.get("codigo")}
        merged = []
        for p in deduped:
            c = str(p.get("codigo", "")).strip().upper()
            if c in ai_by_code and ai_by_code[c].get("preco"):
                merged.append(ai_by_code.pop(c))  # versão IA (com preço)
                fallback_used += 1
            else:
                merged.append(p)
        # adiciona produtos novos que só a IA achou nas páginas ruins
        for c, p in ai_by_code.items():
            if c:
                merged.append(p)
        deduped = merged
        cobertura = sum(1 for p in deduped if p.get("preco")) / len(deduped)
        print(f"[Template] após fallback por página: {len(deduped)} produtos | cobertura {cobertura:.0%} | {fallback_used} corrigidos")

    elapsed = time.time() - start
    if cobertura < (TEMPLATE_MIN_COVERAGE - 0.15):
        print(f"[Template] cobertura total {cobertura:.0%} ainda baixa → fallback AI-first completo")
        return None
    return {
        "success": True,
        "model": f"{MODEL_FLASH} (template-synth+pagefix)" if fallback_used else f"{MODEL_FLASH} (template-synth)",
        "produtos": deduped,
        "fornecedor_detectado": supplier,
        "total_paginas": len(page_texts),
        "elapsed": elapsed,
        "confianca": cobertura,
        "metodo": "template-synth",
        "template": tpl,
        "error": None,
    }


_PREFIXED_CODE_RE = re.compile(r"^([A-Z]{1,4})(-?)(\d{3,})$")
_NUMERIC_CODE_RE = re.compile(r"^\d{3,}$")


def _fix_missing_code_prefix(produtos: list) -> list:
    """Completa o prefixo de letras que a IA às vezes tira do código
    (Goal Kids: "GK1234" saía "1234" — reunião 22/07/2026).

    O prefixo é MEDIDO no próprio lote, não vem de uma tabela por fornecedor:
    só age quando >=80% dos códigos (e pelo menos 10) usam o MESMO prefixo e
    o código só-número tem a mesma quantidade de dígitos que eles. Catálogo
    que mistura códigos numéricos e com prefixo de verdade não passa no corte.
    """
    prefixed: Dict[str, List[Tuple[str, int]]] = {}
    numeric = []
    for p in produtos:
        codigo = str(p.get("codigo") or "").strip().upper()
        m = _PREFIXED_CODE_RE.match(codigo)
        if m:
            prefixed.setdefault(m.group(1), []).append((m.group(2), len(m.group(3))))
        elif _NUMERIC_CODE_RE.match(codigo):
            numeric.append(p)
    if not numeric or not prefixed:
        return produtos
    total = sum(1 for p in produtos if str(p.get("codigo") or "").strip())
    prefix, amostras = max(prefixed.items(), key=lambda item: len(item[1]))
    if len(amostras) < 10 or len(amostras) < 0.8 * total:
        return produtos
    separador = Counter(sep for sep, _ in amostras).most_common(1)[0][0]
    digitos = Counter(n for _, n in amostras).most_common(1)[0][0]
    fixed = 0
    for p in numeric:
        codigo = str(p.get("codigo")).strip()
        if len(codigo) == digitos:
            p["codigo"] = f"{prefix}{separador}{codigo}"
            fixed += 1
    if fixed:
        print(f"[Gemini] Prefixo '{prefix}' da maioria do lote completado em {fixed} código(s)")
    return produtos


# Letra que a IA de VISÃO (sem camada de texto pra conferir, ex: FOLIA) às
# vezes lê no lugar de um dígito visualmente parecido, em catálogos escaneados
# ou 100% imagem: cada leitura do pixel é independente, então o mesmo dígito
# pode sair certo em 99% dos códigos e virar letra em alguns cartões isolados
# (medido: JRF-50.xxxx → JRF-S0.xxxx em 3 de 297 códigos do mesmo segmento).
_OCR_DIGIT_LOOKALIKES = {"O": "0", "S": "5", "I": "1", "B": "8", "Z": "2", "G": "6"}
_CODE_SEGMENT_RE = re.compile(r"[-_]([A-Z0-9]{1,3})\.")


def _fix_ocr_digit_letter_confusion(produtos: list) -> list:
    """Corrige código com segmento curto (padrão "PREFIXO-NN.sufixo") que saiu
    com uma letra visualmente parecida com dígito, comparando contra a MAIORIA
    dos próprios códigos do mesmo lote — não é lista fixa por fornecedor, é
    medido no lote real a cada extração.

    Só corrige quando existe EXATAMENTE UM jeito de trocar uma letra por seu
    dígito parecido que produz um segmento que já aparece, 100% numérico, em
    outros códigos do mesmo lote — evidência do próprio catálogo, não achismo;
    ambíguo (duplo candidato) ou sem batida não mexe."""
    known_numeric_segments = set()
    for p in produtos:
        codigo = str(p.get("codigo") or "").strip().upper()
        m = _CODE_SEGMENT_RE.search(codigo)
        if m and m.group(1).isdigit():
            known_numeric_segments.add(m.group(1))
    if not known_numeric_segments:
        return produtos

    fixed = 0
    for p in produtos:
        codigo_original = str(p.get("codigo") or "").strip()
        codigo = codigo_original.upper()
        m = _CODE_SEGMENT_RE.search(codigo)
        if not m or m.group(1).isdigit():
            continue
        seg = m.group(1)
        candidatos = set()
        for i, ch in enumerate(seg):
            troca = _OCR_DIGIT_LOOKALIKES.get(ch)
            if troca is None:
                continue
            novo_seg = seg[:i] + troca + seg[i + 1:]
            if novo_seg in known_numeric_segments:
                candidatos.add(novo_seg)
        if len(candidatos) == 1:
            novo_seg = next(iter(candidatos))
            p["codigo"] = codigo_original[:m.start(1)] + novo_seg + codigo_original[m.end(1):]
            fixed += 1
    if fixed:
        print(f"[Gemini] Corrigido {fixed} código(s) com letra parecida com dígito (confusão da visão)")
    return produtos


UNIT_PRICE_LABEL_LINE = re.compile(
    r"^\[(?P<x>\d+),(?P<y>\d+)\]\s+UND\s*:\s*R\$\s*(?P<price>[\d.,]+)",
    re.IGNORECASE,
)


def _fix_labeled_unit_prices(pdf_path: str, produtos: list) -> list:
    """Troca deterministicamente o total da embalagem pelo preço `UND:`.

    Achado na Fortal: dois valores no mesmo card, `UND: R$ 7,20` e logo
    abaixo `R$ 72,00`; o modelo acertava o card, mas devolvia o segundo.
    Vale pra qualquer catálogo: o rótulo impresso "UND:" é o preço unitário
    (o que o Mercos usa), e a correção só age onde esse rótulo existe perto do
    código — catálogo sem o rótulo não é tocado.
    """
    if not produtos:
        return produtos

    by_page: Dict[int, List[Dict[str, Any]]] = {}
    for produto in produtos:
        try:
            page_number = int(produto.get("paginaOrigem") or 0)
        except (TypeError, ValueError):
            continue
        if page_number > 0:
            by_page.setdefault(page_number, []).append(produto)

    fixed = 0
    confirmed = 0
    try:
        doc = fitz.open(pdf_path)
        for page_number, page_products in by_page.items():
            if not 1 <= page_number <= len(doc):
                continue
            page = doc.load_page(page_number - 1)
            candidates = []
            for line in page_text_for_ai(page).splitlines():
                match = UNIT_PRICE_LABEL_LINE.match(line)
                if not match:
                    continue
                price = _norm_price(match.group("price"), "BR")
                if price:
                    candidates.append((
                        float(match.group("x")),
                        float(match.group("y")),
                        price,
                    ))

            for produto in page_products:
                code = str(produto.get("codigo") or "").strip()
                if not code or not candidates:
                    continue
                rects = page.search_for(code)
                if not rects:
                    continue
                code_rect = rects[0]
                nearby = [
                    candidate for candidate in candidates
                    if 0 <= candidate[1] - code_rect.y0 <= 120
                    and abs(candidate[0] - code_rect.x0) <= page.rect.width * 0.20
                ]
                if not nearby:
                    continue
                _, _, unit_price = min(
                    nearby,
                    key=lambda candidate: (
                        abs(candidate[0] - code_rect.x0)
                        + abs(candidate[1] - code_rect.y0),
                    ),
                )
                current = produto.get("preco")
                if current != unit_price:
                    produto["preco"] = unit_price
                    fixed += 1
                confirmed += 1
        doc.close()
    except Exception as error:
        print(f"[PrecoUND] falha segura, mantendo preços da IA: {error}")
        return produtos

    print(
        f"[PrecoUND] {confirmed} preços unitários confirmados; "
        f"{fixed} corrigidos"
    )
    return produtos


_PRICE_TOKEN_RE = re.compile(r"R\$\s*([\d.\s]+?)\s*,\s*(\d{2})")
# Catálogo sem "R$": o preço é o último número com 2 casas no fim da linha
# ("10cm  CX50  6,95"). Só é usado quando a página não tem NENHUM "R$".
_PRICE_BARE_RE = re.compile(r"(?<![\w.,*])(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*$")


def _fix_labeled_promo_price(pdf_path: str, produtos: list) -> list:
    """Card com rótulos impressos "DE R$X POR R$Y" (+ opcional "PREÇO FINAL"):
    atribui X=preco cheio, Y=precoPromocional ao código MAIS PRÓXIMO (por Y)
    desse cluster de rótulos — não pelo código que vem primeiro na leitura.

    Achado (Petrin, retestagem 22/09): RD1602 tem exatamente esse rótulo na
    página, mas a IA devolveu R$35,00 (preço de um produto vizinho, RD1604) e
    deu o par DE/POR certo pro RD1098-1, que fica bem mais longe na página —
    ela seguiu a ORDEM do texto, não a posição. É um sinal FORTE e inequívoco
    (o rótulo "POR" só existe pra marcar o preço final de uma promoção
    riscada), diferente do caso Fortal (2 preços sem rótulo, ambíguo demais
    pra arriscar — ver `_verify_prices_by_geometry`).

    Só corrige quando os 2 números (DE e POR) e o rótulo "POR" estão a
    poucos pontos um do outro (mesmo bloco visual) e existe um código na
    página claramente mais perto desse cluster que dos demais — falha
    segura: sem isso, não mexe."""
    if not produtos:
        return produtos
    by_page: Dict[int, List[Dict[str, Any]]] = {}
    for p in produtos:
        try:
            pg = int(p.get("paginaOrigem") or 0)
        except (TypeError, ValueError):
            continue
        if pg > 0:
            by_page.setdefault(pg, []).append(p)
    if not by_page:
        return produtos

    fixed = 0
    try:
        doc = fitz.open(pdf_path)
        for pg, page_products in by_page.items():
            if not 1 <= pg <= len(doc):
                continue
            page = doc.load_page(pg - 1)
            d = page.get_text("dict")
            lines = []
            for b in d.get("blocks", []):
                for line in b.get("lines", []):
                    texto = "".join(s.get("text", "") for s in line.get("spans", [])).strip()
                    if texto:
                        lines.append({"text": texto, "x": line["bbox"][0], "y": line["bbox"][1]})

            por_labels = [ln for ln in lines if ln["text"].upper() == "POR"]
            de_labels = [ln for ln in lines if ln["text"].upper() == "DE"]
            precos = []
            for ln in lines:
                m = _PRICE_TOKEN_RE.search(ln["text"]) or _PRICE_BARE_RE.search(ln["text"])
                if m:
                    inteiro = re.sub(r"[.\s]", "", m.group(1))
                    if inteiro.isdigit():
                        precos.append({"val": float(f"{inteiro}.{m.group(2)}"), "x": ln["x"], "y": ln["y"]})

            for por in por_labels:
                de = min(
                    (d_ for d_ in de_labels if abs(d_["y"] - por["y"]) <= 5.0),
                    key=lambda d_: abs(d_["x"] - por["x"]), default=None,
                )
                if de is None:
                    continue
                preco_de = min(
                    (pr for pr in precos if abs(pr["x"] - de["x"]) <= 20.0 and 0 <= pr["y"] - de["y"] <= 20.0),
                    key=lambda pr: pr["y"], default=None,
                )
                preco_por = min(
                    (pr for pr in precos if abs(pr["x"] - por["x"]) <= 20.0 and 0 <= pr["y"] - por["y"] <= 20.0),
                    key=lambda pr: pr["y"], default=None,
                )
                if preco_de is None or preco_por is None or preco_por["val"] >= preco_de["val"]:
                    continue

                candidatos = []
                for p in page_products:
                    code = str(p.get("codigo") or "").strip()
                    if not code:
                        continue
                    rects = page.search_for(code)
                    if len(rects) != 1:
                        continue
                    candidatos.append((abs(rects[0].y0 - por["y"]), p))
                if not candidatos:
                    continue
                candidatos.sort(key=lambda t: t[0])
                if len(candidatos) >= 2 and candidatos[1][0] - candidatos[0][0] < 15.0:
                    continue  # 2 códigos igualmente perto do rótulo — ambíguo, não arrisca
                alvo = candidatos[0][1]
                if alvo.get("preco") != preco_de["val"] or alvo.get("precoPromocional") != preco_por["val"]:
                    alvo["preco"] = preco_de["val"]
                    alvo["precoPromocional"] = preco_por["val"]
                    alvo["promocional"] = True
                    fixed += 1
        doc.close()
    except Exception as error:
        print(f"[PromoDePor] falha segura, mantendo preços da IA: {error}")
        return produtos

    if fixed:
        print(f"[PromoDePor] {fixed} produto(s) com rótulo DE/POR corrigido(s) pela posição na página")
    return produtos


def _page_price_tokens(page) -> List[Dict[str, float]]:
    """Todos os 'R$ 12 ,80' da página com posição. O preço vem partido em
    trechos de fonte diferentes (reais grandes + centavos pequenos), então
    junta os trechos da LINHA antes de casar o padrão."""
    out: List[Dict[str, float]] = []
    try:
        d = page.get_text("dict")
    except Exception:
        return out
    for b in d.get("blocks", []):
        for line in b.get("lines", []):
            texto = "".join(s.get("text", "") for s in line.get("spans", []))
            m = _PRICE_TOKEN_RE.search(texto)
            if not m:
                continue
            inteiro = re.sub(r"[.\s]", "", m.group(1))
            if not inteiro.isdigit():
                continue
            x0, y0 = line["bbox"][0], line["bbox"][1]
            out.append({"val": float(f"{inteiro}.{m.group(2)}"), "x": x0, "y": y0})
    if out:
        return out
    for b in d.get("blocks", []):
        for line in b.get("lines", []):
            texto = "".join(s.get("text", "") for s in line.get("spans", []))
            m = _PRICE_BARE_RE.search(texto)
            if not m:
                continue
            inteiro = m.group(1).replace(".", "")
            out.append({"val": float(f"{inteiro}.{m.group(2)}"), "x": line["bbox"][0], "y": line["bbox"][1]})
    return out


def _preco_mais_perto_de(token: Dict[str, float], rect: Any, located: list,
                         med_dx: float, med_dy: float, dx_tol: float, dy_tol: float) -> bool:
    """True se, pela assinatura de posição (dx, dy) do catálogo, o código em
    `rect` é o dono mais provável do `token` de preço — estritamente mais
    perto que qualquer outro código localizado na página."""
    def dist(r: Any) -> float:
        return (abs((token["x"] - r.x0) - med_dx) / dx_tol
                + abs((token["y"] - r.y0) - med_dy) / dy_tol)

    minha = dist(rect)
    return all(dist(r) > minha for _p, r in located if r is not rect)


def _verify_prices_by_geometry(pdf_path: str, produtos: list) -> Tuple[list, list]:
    """Confere o preço que a IA devolveu contra a GEOMETRIA da página.

    A IA recebe o texto com coordenadas e mesmo assim erra a atribuição em
    ~1,5% dos produtos quando há vários preços por página (Petrin 17/09/2026:
    12 casos reais, inclusive 2 códigos com os preços trocados entre si e um
    código "em breve" ficando com o preço do vizinho). A informação para
    acertar está no PDF: o preço de cada produto fica sempre na MESMA posição
    relativa ao seu código.

    Nada é declarado por fornecedor — a posição é MEDIDA no próprio catálogo:
    entre os produtos cujo preço da IA coincide com um preço impresso na
    página, tira-se a mediana do deslocamento (dx, dy) código→preço. Só se
    esse padrão for consistente (≥85% dos casos dentro da tolerância, ≥30
    produtos) o catálogo tem "assinatura de posição" e a conferência roda;
    layout sem padrão (preços agrupados no fim da página, tabela etc.) não
    é tocado — zero risco de regressão nesses.

    Corrige só quando é inequívoco: exatamente UM preço na janela esperada,
    nenhum outro produto disputando o mesmo preço. Um código sem preço na
    sua janela cujo preço da IA é, na verdade, o preço da janela de OUTRO
    código (preço "roubado") fica sem preço. Falha segura: qualquer erro
    devolve os preços da IA intactos. Devolve (produtos, avisos).
    """
    MIN_MATCHED, MIN_CONSISTENCY = 30, 0.85
    DY_TOL, DX_TOL = 12.0, 60.0
    avisos: List[Dict[str, Any]] = []
    if not produtos:
        return produtos, avisos

    by_page: Dict[int, List[Dict[str, Any]]] = {}
    for p in produtos:
        try:
            pg = int(p.get("paginaOrigem") or 0)
        except (TypeError, ValueError):
            continue
        if pg > 0:
            by_page.setdefault(pg, []).append(p)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"[PrecoGeometria] não abriu o PDF, mantendo preços da IA: {e}")
        return produtos, avisos

    try:
        page_data: Dict[int, Tuple[List[Dict[str, float]], List[Tuple[Dict[str, Any], Any]]]] = {}
        for pg, plist in by_page.items():
            if not 1 <= pg <= len(doc):
                continue
            page = doc.load_page(pg - 1)
            tokens = _page_price_tokens(page)
            if not tokens:
                continue
            located = []
            for p in plist:
                code = str(p.get("codigo") or "").strip()
                if not code:
                    continue
                rects = page.search_for(code)
                if len(rects) == 1:  # código repetido na página = ambíguo, não arrisca
                    located.append((p, rects[0]))
            page_data[pg] = (tokens, located)

        # 1) assinatura de posição do catálogo, medida onde a IA já bate com a página
        offsets: List[Tuple[float, float]] = []
        for tokens, located in page_data.values():
            for p, rect in located:
                preco = p.get("preco")
                if not isinstance(preco, (int, float)):
                    continue
                cand = [t for t in tokens if abs(t["val"] - preco) < 0.005]
                if not cand:
                    continue
                t = min(cand, key=lambda t: 2 * abs(t["y"] - rect.y0) + abs(t["x"] - rect.x0))
                offsets.append((t["x"] - rect.x0, t["y"] - rect.y0))
        if len(offsets) < MIN_MATCHED:
            print(f"[PrecoGeometria] {len(offsets)} preços casados (<{MIN_MATCHED}) — sem assinatura, não confere")
            return produtos, avisos
        med_dx = sorted(o[0] for o in offsets)[len(offsets) // 2]
        med_dy = sorted(o[1] for o in offsets)[len(offsets) // 2]
        inliers = sum(1 for dx, dy in offsets if abs(dx - med_dx) <= DX_TOL and abs(dy - med_dy) <= DY_TOL)
        consistencia = inliers / len(offsets)
        if consistencia < MIN_CONSISTENCY:
            print(f"[PrecoGeometria] posição do preço inconsistente ({consistencia:.0%} < {MIN_CONSISTENCY:.0%}) — não confere")
            return produtos, avisos
        print(f"[PrecoGeometria] assinatura medida: preço a dx={med_dx:+.0f} dy={med_dy:+.0f} do código "
              f"({consistencia:.0%} de {len(offsets)} casos) — conferindo")

        # 2) confere cada produto contra a janela esperada
        selos_trocados = 0
        for pg, (tokens, located) in page_data.items():
            janela: Dict[int, Optional[int]] = {}  # id(produto) → índice do token único, ou None
            regiao: Dict[int, set] = {}  # id(produto) → todos os preços da região do card
            for p, rect in located:
                # Conta TODOS os preços da região do card (janela expandida). Um card
                # com 2+ preços (ex.: "UND R$ 2,28" + total da caixa "R$ 13,68" na
                # Fortal, "DE/POR" na Petrin) é ambíguo: a posição sozinha não diz qual
                # é o unitário, e "corrigir" poderia trocar um erro por outro (o total da
                # caixa). Regressão pega em 18/09: sem esta trava a conferência desfazia
                # o fix do preço unitário da Fortal em 105 produtos.
                cand = []
                for ti, t in enumerate(tokens):
                    dx, dy = t["x"] - rect.x0, t["y"] - rect.y0
                    if abs(dx - med_dx) <= 1.5 * DX_TOL and abs(dy - med_dy) <= 3 * DY_TOL:
                        cand.append((ti, abs(dx - med_dx) <= DX_TOL and abs(dy - med_dy) <= DY_TOL))
                regiao[id(p)] = {ti for ti, _estrito in cand}
                if not cand:
                    janela[id(p)] = None
                elif len(cand) == 1 and cand[0][1]:
                    janela[id(p)] = cand[0][0]
                elif len(cand) == 1 and _preco_mais_perto_de(tokens[cand[0][0]], rect, located, med_dx, med_dy, DX_TOL, DY_TOL):
                    # Um ÚNICO preço no card, só um pouco fora da janela estreita
                    # (Petrin pág. 91, RD1820: dy=+3 com assinatura dy=-10 → 13pt,
                    # tolerância 12), e nenhum outro código está mais perto dele.
                    # É o preço deste card; tratar como ambíguo deixava a IA
                    # manter o preço do vizinho RD1819 (Josef 23/09/2026).
                    janela[id(p)] = cand[0][0]
                else:
                    janela[id(p)] = -1
            donos: Dict[int, List[Dict[str, Any]]] = {}
            for p, _rect in located:
                ti = janela[id(p)]
                if ti is not None and ti >= 0:
                    donos.setdefault(ti, []).append(p)
            for p, rect in located:
                ti = janela[id(p)]
                atual = p.get("preco")
                if ti == -1:
                    continue
                # Se o preço da IA está impresso COLADO neste mesmo card (região
                # expandida da janela), ela escolheu entre preços do próprio produto
                # (ex.: Fortal "UND R$ 7,20" ao lado do total "R$ 72,00") e a posição
                # não prova erro. O erro real é o preço vir de OUTRO produto (longe).
                if isinstance(atual, (int, float)) and any(
                    abs(t["val"] - atual) < 0.005
                    and abs((t["x"] - rect.x0) - med_dx) <= 1.5 * DX_TOL
                    and abs((t["y"] - rect.y0) - med_dy) <= 3 * DY_TOL
                    for t in tokens
                ):
                    continue
                if ti is not None:
                    if len(donos[ti]) != 1:
                        continue  # preço disputado por 2+ códigos (ex.: matriz) — não mexe
                    novo = tokens[ti]["val"]
                    if not isinstance(atual, (int, float)) or abs(atual - novo) >= 0.005:
                        avisos.append({"codigo": p.get("codigo"), "pagina": pg, "de": atual, "para": novo})
                        p["preco"] = novo
                else:
                    # Nenhum preço impresso em toda a região do card (ex.: selo
                    # EM BREVE da Petrin). Se o preço da IA — normal ou promocional —
                    # está impresso na região do card de OUTRO código, ele veio do
                    # vizinho: fica sem preço. Vale mesmo quando o vizinho tem o
                    # mesmo valor ou um card DE/POR (Josef 24/09/2026: RD1020 com o
                    # R$ 2,20 do RD1021; RD1098-1 com o "POR R$ 8,00" do RD1602).
                    valores_ia = [v for v in (atual, p.get("precoPromocional")) if isinstance(v, (int, float))]
                    alheios = {
                        t2 for o, _r in located if o is not p for t2 in regiao[id(o)]
                    }
                    if valores_ia and any(
                        abs(tokens[t2]["val"] - v) < 0.005 for t2 in alheios for v in valores_ia
                    ):
                        avisos.append({"codigo": p.get("codigo"), "pagina": pg, "de": atual, "para": None})
                        p["preco"] = None
                        if p.get("precoPromocional") is not None or p.get("promocional"):
                            p["precoPromocional"] = None
                            p["promocional"] = False
            # Selo EM BREVE trocado entre linhas (Petrin pág. 3, Josef 24/09/2026:
            # RD1546/RD1547 com preço no card saíram EM BREVE; RD1033/RD1382, sem
            # preço nenhum no card, saíram sem o selo). Destroca só quando a conta
            # fecha na página: N marcados COM preço impresso no próprio card e N
            # não marcados SEM nenhum preço no card. EM BREVE com preço de verdade
            # (DAGIA DV003) não tem par sem preço na página e fica como está.
            com_preco_marcados = [
                p for p, _r in located
                if p.get("emBreve") and isinstance(p.get("preco"), (int, float))
                and any(abs(tokens[t]["val"] - p["preco"]) < 0.005 for t in regiao[id(p)])
            ]
            sem_preco_livres = [
                p for p, _r in located
                if not p.get("emBreve") and p.get("preco") is None and not regiao[id(p)]
            ]
            if com_preco_marcados and len(com_preco_marcados) == len(sem_preco_livres):
                for p in com_preco_marcados:
                    p["emBreve"] = False
                for p in sem_preco_livres:
                    p["emBreve"] = True
                selos_trocados += len(com_preco_marcados)
    except Exception as e:
        print(f"[PrecoGeometria] falha segura, mantendo preços da IA: {e}")
        return produtos, []
    finally:
        doc.close()

    print(f"[PrecoGeometria] {len(avisos)} preço(s) corrigido(s) pela posição na página")
    if selos_trocados:
        print(f"[PrecoGeometria] selo EM BREVE destrocado em {selos_trocados} produto(s)")
    return produtos, avisos


def _marcar_nomes_duplicados(produtos: list) -> list:
    """Sinaliza (diagnóstico, não bloqueia) grupos de produtos com o MESMO
    nome no mesmo lote — é exatamente o padrão que fez a IA trocar preço
    entre 3 SKUs "KIT 6 PORTA-COPOS BAMBU" na GIRA (reunião 16/09/2026,
    confirmado direto no status.json do job de produção: GU0132/TP1679/
    TP2003 saíram com os preços rotacionados entre si). O prompt já pede
    atenção redobrada nesse caso (regra 12), mas isso não garante acerto —
    então fica registrado no PRÓPRIO resultado do job (não no `observacoes`
    exportado pro Mercos, que é dado do cliente) pra dar pra auditar sem
    precisar pedir o catálogo de novo pro cliente."""
    from collections import defaultdict

    por_nome = defaultdict(list)
    for p in produtos:
        nome = str(p.get("nome") or "").strip().upper()
        if nome:
            por_nome[nome].append(p.get("codigo"))

    avisos = [
        {"nome": nome, "codigos": codigos,
         "aviso": "nomes identicos no mesmo lote -- risco conhecido de troca de preco entre eles, confira manualmente"}
        for nome, codigos in por_nome.items()
        if len(codigos) >= 2
    ]
    if avisos:
        print(f"[Gemini] {len(avisos)} grupo(s) de nome duplicado no lote (risco de preço trocado): "
              + "; ".join(f"{a['nome']}={a['codigos']}" for a in avisos))
    return avisos


_CORES_REFERENCIA = [
    ("BRANCO", (1.0, 1.0, 1.0)), ("PRETO", (0.0, 0.0, 0.0)), ("PRATA", (0.66, 0.66, 0.66)),
    ("DOURADO", (0.76, 0.63, 0.13)), ("AMARELO", (0.96, 0.85, 0.05)), ("LARANJA", (0.95, 0.50, 0.10)),
    ("VERMELHO", (0.85, 0.10, 0.12)), ("ROSA", (0.97, 0.55, 0.65)), ("PINK", (0.90, 0.10, 0.55)),
    ("ROXO", (0.50, 0.27, 0.60)), ("LILÁS", (0.75, 0.60, 0.88)), ("AZUL", (0.15, 0.40, 0.85)),
    ("AZUL CLARO", (0.46, 0.72, 0.90)), ("AZUL MARINHO", (0.10, 0.15, 0.40)),
    ("VERDE", (0.20, 0.65, 0.30)), ("VERDE CLARO", (0.60, 0.85, 0.45)), ("TIFFANY", (0.30, 0.75, 0.75)),
    ("MARROM", (0.50, 0.30, 0.15)), ("BEGE", (0.88, 0.79, 0.58)), ("ROSE GOLD", (0.80, 0.58, 0.50)),
    ("SALMÃO", (0.92, 0.68, 0.66)), ("ROSA ESCURO", (0.72, 0.40, 0.52)), ("CHAMPANHE", (0.90, 0.84, 0.80)),
]


_SUFIXO_CORES_RE = re.compile(r"\s+\**CORES\**(\s+SORTIDAS)?$", re.I)


def _nome_da_cor(rgb: Tuple[float, float, float]) -> str:
    return min(_CORES_REFERENCIA, key=lambda c: sum((a - b) ** 2 for a, b in zip(rgb, c[1])))[0]


def _bolinha_acima(desenhos: list, rect: fitz.Rect) -> Optional[str]:
    """Cor da bolinha (círculo vetorial pequeno) logo acima do código, ou None.
    Círculo só com contorno = BRANCO (é assim que o catálogo desenha o branco)."""
    cx = (rect.x0 + rect.x1) / 2
    melhor = None
    for d in desenhos:
        r = d["rect"]
        if not (8 <= r.width <= 25 and abs(r.width - r.height) <= 2):
            continue
        if abs((r.x0 + r.x1) / 2 - cx) > 10 or not (-3 <= rect.y0 - r.y1 <= 25):
            continue
        fill = d.get("fill")
        cor = _nome_da_cor(tuple(fill)) if fill else ("BRANCO" if d.get("color") is not None else None)
        # bolinha listrada (vários preenchimentos pequenos dentro) = multicolor
        dentro = {
            tuple(round(v, 1) for v in o["fill"]) for o in desenhos
            if o is not d and o.get("fill") and r.contains(o["rect"]) and o["rect"].width < r.width * 0.6
        }
        if len(dentro) >= 2:
            cor = "COLORIDO"
        dist = rect.y0 - r.y1
        if cor and (melhor is None or dist < melhor[0]):
            melhor = (dist, cor)
    return melhor[1] if melhor else None


def _nomear_cores_por_bolinha(pdf_path: str, produtos: list) -> list:
    """Variação de cor indicada por BOLINHA colorida acima de cada código
    (Neo Festas pág. 87, Josef 24/09/2026: TOPO BOLO ARCO POMPOM com 4
    códigos e 4 bolinhas; o nome saía igual pros 4). A cor é lida do próprio
    desenho vetorial do PDF — a IA lê só o texto e não vê a bolinha.

    Só mexe em grupos de 2+ códigos com o MESMO nome na mesma página, em que
    TODOS têm bolinha e as cores são diferentes entre si — assim a cor vira o
    que distingue um código do outro. Nome que já termina com a cor fica igual.
    """
    if not produtos:
        return produtos
    try:
        doc = fitz.open(pdf_path)
    except Exception:
        return produtos
    alterados = 0
    try:
        grupos: Dict[Tuple[int, str], list] = {}
        for p in produtos:
            try:
                pg = int(p.get("paginaOrigem") or 0)
            except (TypeError, ValueError):
                continue
            if p.get("codigo") and p.get("nome") and 1 <= pg <= len(doc):
                # "X" e "X CORES" são o mesmo produto: a IA às vezes põe o
                # CORES só em parte dos códigos do grupo (Neo pág. 67)
                grupos.setdefault((pg, _nome_chave(_SUFIXO_CORES_RE.sub("", str(p["nome"]).strip()))), []).append(p)
        desenhos_cache: Dict[int, list] = {}
        for (pg, _chave), grupo in grupos.items():
            if len(grupo) < 2:
                continue
            page = doc.load_page(pg - 1)
            if pg not in desenhos_cache:
                desenhos_cache[pg] = page.get_drawings()
            cores = []
            for p in grupo:
                rects = page.search_for(str(p["codigo"]).strip("*").strip())
                cores.append(_bolinha_acima(desenhos_cache[pg], rects[0]) if len(rects) == 1 else None)
            if None in cores or len(set(cores)) != len(cores):
                continue
            for p, cor in zip(grupo, cores):
                nome = str(p["nome"]).strip()
                if nome.upper().endswith(cor):
                    continue
                # "... CORES" no fim do nome = "várias cores" → vira a cor deste código
                base = _SUFIXO_CORES_RE.sub("", nome)
                p["nome"] = f"{base} {cor}"
                alterados += 1
    except Exception as e:
        print(f"[CorBolinha] falha segura: {e}")
    finally:
        doc.close()
    if alterados:
        print(f"[CorBolinha] cor da bolinha adicionada ao nome de {alterados} produto(s)")
    return produtos


def _limpar_marcador_do_codigo(produtos: list) -> list:
    """Tira o asterisco grudado no código ("104736*"). Neo Festas, Josef
    25/09/2026: a legenda do catálogo diz que o * marca produto com poucas
    unidades — não é parte do código. Com ele o produto sumia da exportação
    e não casava com a foto (9 códigos com preço válido)."""
    limpos = 0
    for p in produtos:
        codigo = p.get("codigo")
        if not isinstance(codigo, str):
            continue
        limpo = codigo.strip().strip("*").strip()
        if limpo and limpo != codigo.strip():
            p["codigo"] = limpo
            limpos += 1
    if limpos:
        print(f"[Codigo] asterisco removido de {limpos} código(s)")
    return produtos


def _regex_do_formato(formato: str) -> re.Pattern:
    partes = []
    for ch in formato:
        partes.append(r"\d" if ch == "9" else "[A-Z]" if ch == "A" else re.escape(ch))
    return re.compile(r"(?<![A-Z0-9])" + "".join(partes) + r"(?![A-Z0-9])")


def _conferir_codigos_pelo_texto(pdf_path: str, produtos: list) -> list:
    """Confere cada código contra o TEXTO da própria página do PDF.

    Neo Festas pág. 67 (Josef 25/09/2026): o código impresso é pequeno e a
    IA leu "128465/128473" como "132331/170331" — códigos que não existem
    no PDF; os verdadeiros sumiam da exportação. E 2 produtos vieram sem
    página (sem foto). Aqui, só em PDF com texto:
      - produto sem página cujo código aparece em UMA página só → ganha a página;
      - na página, códigos da IA que não estão no texto × códigos do texto
        que não estão em produto nenhum: se a quantidade bate e o nome do
        produto aparece logo antes do código do texto, troca (na ordem).
    O formato do código (dígitos/letras) é medido no próprio lote."""
    if not produtos:
        return produtos
    formatos = Counter(_formato_codigo(p.get("codigo")) for p in produtos if p.get("codigo"))
    if not formatos:
        return produtos
    formato, n = formatos.most_common(1)[0]
    if n < 0.6 * sum(formatos.values()) or len(formato) < 4:
        return produtos
    rx = _regex_do_formato(formato)
    try:
        doc = fitz.open(pdf_path)
    except Exception:
        return produtos
    try:
        textos = [doc.load_page(i).get_text().upper() for i in range(len(doc))]
    except Exception:
        return produtos
    finally:
        doc.close()
    tokens = [{m.group(0): m.start() for m in reversed(list(rx.finditer(t)))} for t in textos]
    todos_codigos = {str(p.get("codigo") or "").strip().upper() for p in produtos}

    paginas_postas = 0
    for p in produtos:
        codigo = str(p.get("codigo") or "").strip().upper()
        if p.get("paginaOrigem") or not codigo:
            continue
        onde = [i + 1 for i, tk in enumerate(tokens) if codigo in tk]
        if len(onde) == 1:
            p["paginaOrigem"] = onde[0]
            paginas_postas += 1

    trocados = 0
    por_pagina: Dict[int, list] = {}
    for p in produtos:
        try:
            pg = int(p.get("paginaOrigem") or 0)
        except (TypeError, ValueError):
            continue
        if 1 <= pg <= len(tokens):
            por_pagina.setdefault(pg, []).append(p)
    for pg, lista in por_pagina.items():
        tk = tokens[pg - 1]
        if not tk:
            continue
        fantasmas = [
            p for p in lista
            if _formato_codigo(p.get("codigo")) == formato
            and str(p["codigo"]).strip().upper() not in tk
        ]
        if not fantasmas or len(fantasmas) > 5:
            continue
        orfaos = sorted((pos, c) for c, pos in tk.items() if c not in todos_codigos)
        if len(orfaos) != len(fantasmas):
            continue
        texto = textos[pg - 1]
        pares = []
        for p, (pos, novo) in zip(fantasmas, orfaos):
            palavras = [w for w in re.findall(r"[A-ZÀ-Ú]{4,}", str(p.get("nome") or "").upper())][:2]
            janela = texto[max(0, pos - 300):pos]
            if not palavras or not all(w in janela for w in palavras):
                pares = []
                break
            pares.append((p, novo))
        for p, novo in pares:
            print(f"[CodigoTexto] pág {pg}: {p['codigo']} não existe no PDF → {novo}")
            p["codigo"] = novo
            trocados += 1
    if trocados or paginas_postas:
        print(f"[CodigoTexto] {trocados} código(s) corrigido(s) pelo texto do PDF; "
              f"{paginas_postas} produto(s) ganharam a página")
    return produtos


def extract_with_fallback(pdf_path: str, supplier: str = "", client_rules: str = "") -> Dict[str, Any]:
    """Wrapper único: chama a extração real e aplica correções pós-processamento
    (ex: prefixo de código) independente de qual caminho interno foi usado
    (template/text-chunked/vision/escalada Pro). Nenhuma delas depende do
    nome do fornecedor: cada uma mede o sinal no próprio lote/PDF."""
    result = _extract_with_fallback_impl(pdf_path, supplier, client_rules)
    if result and result.get("produtos"):
        result["produtos"] = _limpar_marcador_do_codigo(result["produtos"])
        result["produtos"] = _fix_missing_code_prefix(result["produtos"])
        result["produtos"] = _fix_ocr_digit_letter_confusion(result["produtos"])
        result["produtos"] = _conferir_codigos_pelo_texto(pdf_path, result["produtos"])
        result["produtos"] = _fix_labeled_unit_prices(pdf_path, result["produtos"])
        result["produtos"] = _fix_labeled_promo_price(pdf_path, result["produtos"])
        result["produtos"], result["avisosPrecoCorrigido"] = _verify_prices_by_geometry(
            pdf_path, result["produtos"],
        )
        result["produtos"] = _nomear_cores_por_bolinha(pdf_path, result["produtos"])
        result["avisosNomeDuplicado"] = _marcar_nomes_duplicados(result["produtos"])
    return result


def _extract_with_fallback_impl(pdf_path: str, supplier: str = "", client_rules: str = "") -> Dict[str, Any]:
    """
    Extrai com cadeia de fallbacks (todos modelos atualmente ativos):
      1. gemini-2.5-flash    (padrão: rápido e barato)
      2. gemini-2.0-flash    (estável, se 2.5 falhar/quota)
      3. gemini-flash-latest (alias mantido pelo Google)
      4. gemini-2.5-pro      (último recurso: caro mas robusto)

    Se confiança < 80%, escala para Pro para validar/melhorar.

    v23: supplier define hints anexados ao prompt (ver SUPPLIER_HINTS).
    v27: catálogos GRANDES/PESADOS (>15MB ou >30 págs) usam extração por
    TEXTO em chunks (vision do PDF inteiro dá 400 nesses casos).
    """
    # Phase 0 (IV-23): gera hints automáticos para fornecedor sem hints hardcoded.
    # Corre antes do roteamento p/ que template-synth e text-chunked já os usem.
    if supplier and not get_supplier_hints(supplier):
        _ensure_supplier_profile(pdf_path, supplier)

    # Roteamento v27/v33: catálogo grande → tenta TEMPLATE (rápido/barato),
    # com fallback automático pro AI-first text-chunked se cobertura baixa.
    try:
        size_mb = os.path.getsize(pdf_path) / 1024 / 1024
        doc = fitz.open(pdf_path)
        n_pages = len(doc)
        # ANTES de qualquer caminho de TEXTO: o PDF tem os produtos em texto?
        # A FOLIA tem camada de texto, mas só com a marca d'água — o
        # text-chunked devolvia 18 "produtos" que eram números de página.
        # Ver camada_de_texto_inutil().
        sem_texto = camada_de_texto_inutil(doc)
        doc.close()
        if sem_texto:
            print(f"[Gemini] Catálogo sem produtos na camada de texto ({n_pages} págs) "
                  f"→ lendo as PÁGINAS (vision-chunked)")
            vis = extract_with_vision_chunked(pdf_path, supplier, client_rules)
            if vis.get("success"):
                return vis
            print("[Gemini] vision-chunked não achou produtos → segue cadeia normal")
        if size_mb > LARGE_CATALOG_MB or n_pages > LARGE_CATALOG_PAGES:
            print(f"[Gemini] Catálogo grande ({size_mb:.0f}MB, {n_pages} págs) → v33 TEMPLATE-synth (fallback text-chunked)")
            tpl_result = extract_via_template(pdf_path, supplier, client_rules)
            if tpl_result and tpl_result.get("success"):
                return tpl_result
            print("[Gemini] template não atingiu cobertura → AI-first text-chunked")
            return extract_with_fallback_text_chunked(pdf_path, supplier, client_rules)
    except Exception as e:
        print(f"[Gemini] Falha ao medir catálogo (segue vision): {e}")

    # Cadeia de fallback de modelos (todos ATIVOS em 2026)
    fallback_chain = [MODEL_FLASH, MODEL_FLASH_STABLE, MODEL_FLASH_LATEST, MODEL_PRO]

    supplier_hints = get_supplier_hints(supplier, client_rules)
    if supplier_hints:
        print(f"[Gemini] Hints ativos para fornecedor: {supplier}")

    result = None
    last_error = None
    for model in fallback_chain:
        print(f"[Gemini] Tentando modelo: {model}")
        result = extract_products_with_gemini(pdf_path, model_name=model, supplier_hints=supplier_hints)
        if result.get("success"):
            print(f"[Gemini] ✓ Sucesso com {model}")
            break
        last_error = result.get("error", "?")
        # Se for erro 404 (modelo inexistente), tenta o próximo da cadeia
        if "404" in str(last_error) or "not found" in str(last_error).lower():
            print(f"[Gemini] {model} indisponível (404), próximo da cadeia...")
            continue
        # Outros erros (quota, timeout, etc): também tenta o próximo
        print(f"[Gemini] {model} falhou: {last_error[:150]}, próximo da cadeia...")

    if not result or not result.get("success"):
        return result or {
            "success": False,
            "produtos": [],
            "error": f"Todos os modelos falharam. Ultimo erro: {last_error}",
            "model": fallback_chain[-1],
        }

    # Calcula confiança do resultado
    produtos = result["produtos"]
    if not produtos:
        return result

    completos = sum(
        1 for p in produtos
        if p.get("codigo") and p.get("nome") and (p.get("preco") or 0) > 0
    )
    confianca = completos / len(produtos)
    result["confianca"] = confianca
    print(f"[Gemini] Confiança Flash: {confianca:.0%} ({completos}/{len(produtos)})")

    # Se confiança < 80%, escala para Pro
    if confianca < 0.80:
        print(f"[Gemini] Confiança baixa, escalando para 2.5 Pro...")
        pro_result = extract_products_with_gemini(pdf_path, model_name=MODEL_PRO, supplier_hints=supplier_hints)
        if pro_result.get("success") and pro_result["produtos"]:
            pro_produtos = pro_result["produtos"]
            pro_completos = sum(
                1 for p in pro_produtos
                if p.get("codigo") and p.get("nome") and (p.get("preco") or 0) > 0
            )
            pro_confianca = pro_completos / len(pro_produtos)
            print(f"[Gemini] Confiança Pro: {pro_confianca:.0%}")
            if pro_confianca > confianca:
                pro_result["confianca"] = pro_confianca
                return pro_result

    return result
