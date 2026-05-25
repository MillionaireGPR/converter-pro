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

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    print("[Gemini] AVISO: google-generativeai não instalado. AI extraction desabilitada.")

import fitz  # PyMuPDF


# ─────────────────────────────────────────────────────────────
# Configuração
# ─────────────────────────────────────────────────────────────

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()

# Modelos disponíveis (de mais barato → mais preciso)
MODEL_FLASH = "gemini-2.5-flash"      # ~$0.001/página
MODEL_PRO = "gemini-2.5-pro"          # ~$0.01/página
MODEL_FLASH_LEGACY = "gemini-1.5-flash"  # fallback se 2.5 indisponível


_initialized = False

def _ensure_initialized() -> bool:
    """Configura a API key (uma vez)."""
    global _initialized
    if _initialized:
        return True
    if not GEMINI_AVAILABLE:
        return False
    if not GEMINI_API_KEY:
        print("[Gemini] ERRO: GEMINI_API_KEY não configurada nas env vars.")
        return False
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        _initialized = True
        return True
    except Exception as e:
        print(f"[Gemini] Falha na configuração: {e}")
        return False


# ─────────────────────────────────────────────────────────────
# Prompt estruturado (PT-BR) que define o schema de extração
# ─────────────────────────────────────────────────────────────

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


def extract_with_fallback(pdf_path: str) -> Dict[str, Any]:
    """
    Extrai com Gemini 2.5 Flash primeiro (barato). Se < 80% de confiança ou
    erro, escala para Gemini 2.5 Pro (mais preciso).

    Critério de confiança: % de produtos com codigo + nome + preco > 0.
    """
    # Tentativa 1: Flash (barato e rápido)
    result = extract_products_with_gemini(pdf_path, model_name=MODEL_FLASH)

    if not result.get("success"):
        # Fallback automático para 1.5 Flash (caso 2.5 não disponível ainda)
        print("[Gemini] 2.5 Flash falhou, tentando 1.5 Flash...")
        result = extract_products_with_gemini(pdf_path, model_name=MODEL_FLASH_LEGACY)

    if not result.get("success"):
        return result

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
