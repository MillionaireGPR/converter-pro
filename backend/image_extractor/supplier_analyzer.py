"""
Phase 0 — auto-análise de estrutura de catálogo para fornecedores desconhecidos.

Quando o usuário cadastra um fornecedor novo (sem SUPPLIER_HINTS hardcoded),
esta função envia amostras de texto das primeiras páginas ao Gemini e pede que
ele identifique o padrão estrutural do catálogo (onde fica o código, nome, preço,
etc.) e retorne dicas no mesmo formato do SUPPLIER_HINTS.

O resultado é cacheado em supplier_profiles/<NOME>.json via supplier_profile.py.
Nas próximas conversões do mesmo fornecedor o cache é reusado sem nova chamada.

Invariante IV-23: hardcoded SUPPLIER_HINTS sempre tem prioridade sobre o cache.
A Phase 0 só roda quando nenhum hint hardcoded existe para o fornecedor.
"""
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Optional

import fitz  # PyMuPDF

from supplier_profile import save_profile

# Mínimo de texto legível (chars) para tentar análise via texto.
# Abaixo disso considera-se catálogo "imagem pura" e skipa Phase 0 de texto.
MIN_SAMPLE_CHARS = 200

# Páginas de amostra enviadas ao Gemini (pula capa = pág 0)
SAMPLE_START = 1
SAMPLE_END   = 6   # até pág 5 (0-indexed), ou menos se catálogo for curto
MAX_CHARS_PER_PAGE = 1500


_ANALYSIS_PROMPT = """Você está analisando amostras de texto das primeiras páginas de um catálogo \
de produtos do fornecedor "{supplier}".
Sua tarefa: identificar o padrão estrutural para que uma IA extraia todos os produtos corretamente.

Retorne APENAS um objeto JSON válido (sem markdown, sem explicação):
{{
  "codigo": "Onde e como o código do produto aparece. Ex: 'número de 6 dígitos sozinho após os preços' ou 'início da linha antes do pipe | (ex: AX21042-A)'",
  "nome": "Onde e como está o nome. Ex: 'CAIXA ALTA antes dos preços, pode ter 2+ linhas' ou 'texto após o | na mesma linha do código'",
  "preco": "Qual preço usar quando há vários. Ex: 'R$ X,XX Un. (sufixo Un.)' ou 'primeiro R$ quando há dois — CX ABERTA'",
  "quantidade_caixa": "Campo de quantidade por caixa ou múltiplo. Ex: 'c/N un.' ou 'Múltiplo: N Pçs'. Use null se não houver.",
  "marcadores": "Marcadores especiais: promoção, esgotado, IPI incluso, asterisco, etc. Use null se não houver.",
  "armadilhas": "2-3 erros que a IA deve evitar. Ex: 'código vem DEPOIS do preço, não antes; não confundir EAN de 13 dígitos com código do produto'",
  "format_type": "Tipo do formato: tabela_fast | grid_preco_final | lista_codigo_nome | planilha | imagem_grade | outro"
}}

TEXTO AMOSTRAL DO CATÁLOGO:
{sample_text}"""


def _build_sample_text(doc: fitz.Document) -> str:
    """Extrai texto das páginas de amostra (pula capa)."""
    parts = []
    end = min(SAMPLE_END, len(doc))
    for pn in range(SAMPLE_START, end):
        txt = doc[pn].get_text("text") or ""
        lines = [l.strip() for l in txt.split("\n") if l.strip()]
        excerpt = "\n".join(lines[:60])[:MAX_CHARS_PER_PAGE]
        if excerpt:
            parts.append(f"=== PÁGINA {pn + 1} ===\n{excerpt}")
    return "\n\n".join(parts)


def _call_gemini_analysis(prompt: str) -> Optional[dict]:
    """Envia o prompt ao Gemini 2.5 Flash e retorna o JSON parseado."""
    try:
        import google.generativeai as genai  # lazy import
        model = genai.GenerativeModel(
            "gemini-2.5-flash",
            generation_config={"temperature": 0, "max_output_tokens": 1024},
        )
        resp = model.generate_content(prompt)
        raw = (resp.text or "").strip()
        # Remove possível bloco markdown
        raw = re.sub(r"```json\s*", "", raw)
        raw = re.sub(r"```\s*", "", raw)
        return json.loads(raw.strip())
    except Exception as e:
        print(f"[Phase0] Erro na chamada Gemini: {e}")
        return None


def _analysis_to_hints(analysis: dict, supplier: str) -> str:
    """Converte o JSON de análise para string no formato SUPPLIER_HINTS."""
    sup = supplier.strip().upper()
    lines = [f"DICAS ESPECÍFICAS DO FORNECEDOR {sup} (detectadas automaticamente — Phase 0):"]

    if analysis.get("codigo"):
        lines.append(f"- código: {analysis['codigo']}")
    if analysis.get("nome"):
        lines.append(f"- nome: {analysis['nome']}")
    if analysis.get("preco"):
        lines.append(f"- preço: {analysis['preco']}")
    if analysis.get("quantidade_caixa"):
        lines.append(f"- quantidadeCaixa: {analysis['quantidade_caixa']}")
    if analysis.get("marcadores"):
        lines.append(f"- marcadores especiais: {analysis['marcadores']}")
    if analysis.get("armadilhas"):
        lines.append(f"- ATENÇÃO (erros comuns a evitar): {analysis['armadilhas']}")

    return "\n".join(lines)


def analyze_and_cache(pdf_path: str, supplier: str) -> Optional[str]:
    """
    Executa a Phase 0 para um fornecedor desconhecido:
      1. Extrai texto de amostra das primeiras páginas do PDF.
      2. Envia ao Gemini para análise de estrutura.
      3. Converte resultado em string de hints.
      4. Persiste no cache (supplier_profile.save_profile).
      5. Retorna a string de hints (ou None se falhou/catálogo imagem pura).

    IV-23: hardcoded SUPPLIER_HINTS tem prioridade — esta função SÓ é chamada
    quando get_supplier_hints() retorna vazio.
    """
    t0 = time.time()
    print(f"[Phase0] Analisando estrutura do catálogo '{supplier}'...")

    try:
        doc = fitz.open(pdf_path)
        sample_text = _build_sample_text(doc)
        doc.close()
    except Exception as e:
        print(f"[Phase0] Não foi possível abrir PDF: {e}")
        return None

    # Catálogo imagem pura (sem texto extraível) — Phase 0 de texto não se aplica.
    if len(sample_text) < MIN_SAMPLE_CHARS:
        print(f"[Phase0] '{supplier}': texto insuficiente ({len(sample_text)} chars) "
              "— catálogo imagem pura, Phase 0 de texto ignorada.")
        save_profile(supplier, {
            "hints": "",
            "format_type": "imagem_grade",
            "raw_analysis": {"format_type": "imagem_grade"},
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "source": "phase0_no_text",
        })
        return None

    prompt = _ANALYSIS_PROMPT.format(supplier=supplier, sample_text=sample_text)
    analysis = _call_gemini_analysis(prompt)

    if not analysis:
        print(f"[Phase0] '{supplier}': Gemini não retornou análise válida.")
        return None

    hints = _analysis_to_hints(analysis, supplier)
    elapsed = round(time.time() - t0, 1)

    save_profile(supplier, {
        "hints": hints,
        "format_type": analysis.get("format_type", "outro"),
        "raw_analysis": analysis,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "source": "phase0_auto",
    })

    print(f"[Phase0] '{supplier}' — perfil salvo ({elapsed}s, "
          f"formato={analysis.get('format_type','?')}, {len(hints)} chars de hints)")
    return hints
