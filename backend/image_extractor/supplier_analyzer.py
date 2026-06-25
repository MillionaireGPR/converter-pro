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


_ANALYSIS_PROMPT = """Você é um engenheiro de dados que vai criar REGRAS DE EXTRAÇÃO para um catálogo.

ATENÇÃO — NÃO extraia os produtos. NÃO faça uma lista de itens.
Sua única tarefa é descrever como a IA deve ENCONTRAR as informações.

Responda com UM ÚNICO objeto JSON descrevendo as regras (não os dados):

Exemplo de SAÍDA CORRETA para um catálogo "Tabela Fast":
{{
  "codigo": "número de 6 dígitos que aparece sozinho em uma linha APÓS os preços (ex: '156043')",
  "nome": "texto em CAIXA ALTA em 1-2 linhas ANTES dos preços unitário e de pacote",
  "preco": "usar 'R$ X,XX Un.' (preço unitário com sufixo 'Un.'); ignorar 'R$ X,XX Pct. c/N' (preço de pacote)",
  "quantidade_caixa": "número N de 'Pct. c/N un.' ou 'c/N un.' junto ao preço de pacote",
  "marcadores": "código com asterisco (*) = poucas unidades; texto 'ESGOTADO' = sem estoque; preço em vermelho = promoção",
  "armadilhas": "código vem DEPOIS dos preços, não antes; não confundir preço de pacote com unitário",
  "format_type": "tabela_fast"
}}

Exemplo de SAÍDA CORRETA para catálogo com código|nome na mesma linha:
{{
  "codigo": "início da linha antes do separador '|', formato letras+dígitos (ex: 'AX21042-A')",
  "nome": "texto após o '|' na mesma linha do código (ex: 'Balança digital 10Kg')",
  "preco": "primeiro R$ da linha seguinte — preço CX ABERTA (abrir caixa); ignorar o segundo R$ (CX FECHADA)",
  "quantidade_caixa": "número N de 'Múltiplo: N Pçs'",
  "marcadores": "texto 'CORES SORTIDAS' vai em observações, não no nome",
  "armadilhas": "há dois preços por produto: CX ABERTA e CX FECHADA; usar sempre o CX ABERTA (menor)",
  "format_type": "grid_preco_final"
}}

Agora analise o catálogo do fornecedor "{supplier}" abaixo e retorne o JSON com as regras.
APENAS O OBJETO JSON. Sem markdown. Sem texto extra. Sem lista de produtos.

TEXTO DO CATÁLOGO (primeiras páginas):
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
        from google.generativeai.types import GenerationConfig
        model = genai.GenerativeModel("gemini-2.5-flash")
        # 8192: Gemini 2.5 Flash usa thinking tokens que consomem o budget;
        # 4096 resulta em resposta truncada (~500 chars úteis).
        cfg = GenerationConfig(temperature=0, max_output_tokens=8192)
        resp = model.generate_content(prompt, generation_config=cfg)
        raw = (resp.text or "").strip()

        # Remove possível bloco markdown ```json ... ```
        raw = re.sub(r"```json\s*", "", raw)
        raw = re.sub(r"```\s*", "", raw)
        raw = raw.strip()

        # Se Gemini retornou uma LISTA (erro: extraiu produtos ao invés de analisar),
        # a Phase 0 não pode usar esse resultado.
        if raw.startswith("["):
            print("[Phase0] Gemini retornou lista de produtos em vez de análise estrutural. "
                  "Ignorando resultado.")
            return None

        # Tenta extrair só o objeto JSON se houver texto extra ao redor
        if not raw.startswith("{"):
            m = re.search(r"\{[\s\S]+\}", raw)
            if m:
                raw = m.group(0)

        return json.loads(raw)
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

    # Gemini 2.5 Flash usa thinking tokens que variam por chamada; retry garante
    # que uma rodada com thinking pesado não descarte a análise inteira.
    analysis = None
    for attempt in range(3):
        analysis = _call_gemini_analysis(prompt)
        if analysis:
            break
        if attempt < 2:
            print(f"[Phase0] Tentativa {attempt + 1} falhou, repetindo...")
            time.sleep(2)

    if not analysis:
        print(f"[Phase0] '{supplier}': Gemini não retornou análise válida após 3 tentativas.")
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
