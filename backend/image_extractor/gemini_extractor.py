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
import time
from typing import List, Dict, Any, Optional

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

REGRAS CRÍTICAS:
1. Extraia TODOS os produtos visíveis, mesmo que tenham informações parciais.
2. NÃO invente dados. Se um campo não está visível, retorne null/0 conforme tipo.
3. NÃO confunda NCM (formato XXXX.XX.XX) com preço.
4. NÃO confunda IPI (geralmente 1-30%) com preço.
5. Preços em catálogos brasileiros usam vírgula como decimal — converta para ponto (6,99 → 6.99).
6. Códigos podem ter sufixos de variação (NX445-A, NX445-P, NX445-V) — extraia TODOS como produtos separados.
7. Se um produto tem múltiplas variações no mesmo card (ex: 3 cores), liste cada variação separadamente se houver código distinto.

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
      "observacoes": "DIMENSÃO: 25x11,5x3cm"
    }
  ]
}

NÃO inclua texto fora do JSON. NÃO use markdown (```). Apenas o objeto JSON puro.
"""


# ─────────────────────────────────────────────────────────────
# Função principal
# ─────────────────────────────────────────────────────────────

def extract_products_with_gemini(
    pdf_path: str,
    model_name: str = MODEL_FLASH,
    max_retries: int = 2
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

            response = model.generate_content(
                [file_handle, EXTRACTION_PROMPT],
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


def extract_with_fallback(pdf_path: str) -> Dict[str, Any]:
    """
    Extrai com cadeia de fallbacks (todos modelos atualmente ativos):
      1. gemini-2.5-flash    (padrão: rápido e barato)
      2. gemini-2.0-flash    (estável, se 2.5 falhar/quota)
      3. gemini-flash-latest (alias mantido pelo Google)
      4. gemini-2.5-pro      (último recurso: caro mas robusto)

    Se confiança < 80%, escala para Pro para validar/melhorar.
    """
    # Cadeia de fallback de modelos (todos ATIVOS em 2026)
    fallback_chain = [MODEL_FLASH, MODEL_FLASH_STABLE, MODEL_FLASH_LATEST, MODEL_PRO]

    result = None
    last_error = None
    for model in fallback_chain:
        print(f"[Gemini] Tentando modelo: {model}")
        result = extract_products_with_gemini(pdf_path, model_name=model)
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
        pro_result = extract_products_with_gemini(pdf_path, model_name=MODEL_PRO)
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
