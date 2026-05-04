"""
Teste E2E multi-fornecedor: valida cv_extractor em todos os catálogos PDF.
"""
import sys, os, re, time
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(__file__))

import fitz
from cv_extractor import extract_cells_via_cv

CATALOG_DIR = (
    r"C:\Users\Gabriel Pantoni\OneDrive\Desktop\IQC PERSONALITE"
    r"\Clientes e Projetos\MICHELLE RIBEIRO NUNES DUARTE"
    r"\Conversor de Documentos\Catalogos modelos de Fornecedor"
)
OUTPUT_BASE = "temp/test_all_suppliers"

# Configuração por fornecedor: (arquivo, padrão SKU regex, páginas de teste)
SUPPLIERS = [
    {
        "name": "GIRA",
        "file": "CATALOGO GIRA IMPORTS.pdf",
        "sku_pattern": r"^[A-Z]{2,3}\d{3,4}$",
        "test_pages": [2, 5, 10],
    },
    {
        "name": "BM36/WORDCLASSIC",
        "file": "CATALAGO GERAL BM36 (CÓDIGOS INICIADOS POR BM) e WORD CLASSIC (INICIADO POR WC) (2).pdf",
        "sku_pattern": r"^(BM|WC)\d{4,8}$",
        "test_pages": [2, 4, 6],
    },
    {
        "name": "GOAL",
        "file": "Catalogo Brinquedos GOAL - (desconto 40% no mercos).pdf",
        "sku_pattern": r"^GK\d{3,6}$",
        "test_pages": [2, 4, 6],
    },
    {
        "name": "CLINK_ESPECIAL",
        "file": "CATALOGO CLINK ESPECIAL A 23.03.26 (2) (Este enviamos para os clientes desconto 30+13).pdf",
        "sku_pattern": r"^CK\d{3,5}$",
        "test_pages": [2, 4, 6],
    },
    {
        "name": "LILA_HOME",
        "file": "CATALOGO LILA HOME 26.03.pdf",
        "sku_pattern": r"^LH\d{2,4}$",
        "test_pages": [2, 4, 6],
    },
    {
        "name": "DAGIA",
        "file": "CATÁLOGO DAGIA 25-03-2026 (1).pdf",
        "sku_pattern": r"^D[A-Z]{1,3}\d{1,4}[A-Z]?\d*$",
        "test_pages": [2, 4, 6],
    },
    {
        "name": "NIXHOUSE",
        "file": "Catálogo NixHouse_ED.26_03_2026.pdf",
        "sku_pattern": r"^NX\d{3,5}$",
        "test_pages": [2, 4, 6],
    },
    {
        "name": "FASTNEO",
        "file": "Tabela Fast Neo Festas-09-03 (1).pdf",
        "sku_pattern": r"^\d{6,8}$",
        "test_pages": [2, 4, 6],
    },
]


def extract_skus_from_pages(pdf_path, pattern, test_pages):
    """Extrai SKUs reais do PDF usando fitz + regex, limitado às páginas de teste.
    Deduplica por (sku, page) mantendo a primeira ocorrência."""
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    page_heights = {i + 1: doc.load_page(i).rect.height for i in range(total_pages)}
    skus_list = []
    seen_keys = set()
    pat = re.compile(pattern)

    for pg_num in test_pages:
        if pg_num > total_pages:
            continue
        page = doc.load_page(pg_num - 1)
        words = page.get_text("words")
        for w in words:
            x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
            text = text.strip()
            if not pat.match(text):
                continue
            key = (text, pg_num)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            pymupdf_y = (y0 + y1) / 2
            skus_list.append({
                "sku": text,
                "name": f"Produto {text}",
                "spatialContext": {
                    "x": (x0 + x1) / 2,
                    "y": pymupdf_y,
                    "page": pg_num,
                    "width": x1 - x0,
                    "height": y1 - y0,
                }
            })

    doc.close()
    return skus_list, page_heights


def run_supplier_test(supplier):
    pdf_path = os.path.join(CATALOG_DIR, supplier["file"])
    name = supplier["name"]

    if not os.path.exists(pdf_path):
        return {"name": name, "status": "ARQUIVO_NAO_ENCONTRADO", "total": 0, "matched": 0, "pct": 0}

    output_dir = os.path.join(OUTPUT_BASE, name)
    os.makedirs(output_dir, exist_ok=True)

    skus_list, page_heights = extract_skus_from_pages(
        pdf_path, supplier["sku_pattern"], supplier["test_pages"]
    )

    if not skus_list:
        return {"name": name, "status": "NENHUM_SKU_ENCONTRADO", "total": 0, "matched": 0, "pct": 0,
                "note": f"Padrão {supplier['sku_pattern']} não encontrou SKUs nas páginas {supplier['test_pages']}"}

    t0 = time.time()
    matches, unmatched = extract_cells_via_cv(pdf_path, skus_list, output_dir)
    elapsed = time.time() - t0

    total = len(skus_list)
    matched = len(matches)
    pct = 100 * matched / max(1, total)

    return {
        "name": name,
        "status": "OK",
        "total": total,
        "matched": matched,
        "unmatched_count": len(unmatched),
        "pct": pct,
        "elapsed": elapsed,
        "unmatched_reasons": [u.get("reason") for u in unmatched],
        "pages_tested": [p for p in supplier["test_pages"]],
        "output_dir": output_dir,
        "files": [m["final_image_name"] for m in matches[:5]],  # primeiros 5
    }


def main():
    os.makedirs(OUTPUT_BASE, exist_ok=True)
    print("=" * 70)
    print("TESTE E2E MULTI-FORNECEDOR — cv_extractor adaptativo")
    print("=" * 70)

    results = []
    for supplier in SUPPLIERS:
        print(f"\n[{supplier['name']}] Processando...")
        try:
            r = run_supplier_test(supplier)
            results.append(r)
            status = r.get("status", "?")
            if status == "OK":
                print(f"  -> {r['matched']}/{r['total']} SKUs ({r['pct']:.1f}%) | {r['elapsed']:.1f}s")
            else:
                print(f"  -> {status}: {r.get('note', '')}")
        except Exception as e:
            results.append({"name": supplier["name"], "status": "ERRO", "error": str(e), "pct": 0, "total": 0, "matched": 0})
            print(f"  -> ERRO: {e}")

    # Relatório final
    print("\n" + "=" * 70)
    print("RELATORIO FINAL")
    print("=" * 70)
    print(f"{'Fornecedor':<20} {'SKUs':<8} {'Match':<8} {'%':<8} {'Status'}")
    print("-" * 70)
    for r in results:
        name = r["name"][:19]
        total = r.get("total", 0)
        matched = r.get("matched", 0)
        pct = r.get("pct", 0)
        status = r.get("status", "?")
        print(f"{name:<20} {total:<8} {matched:<8} {pct:<8.1f} {status}")

    total_skus = sum(r.get("total", 0) for r in results)
    total_matched = sum(r.get("matched", 0) for r in results)
    overall_pct = 100 * total_matched / max(1, total_skus)
    print("-" * 70)
    print(f"{'TOTAL':<20} {total_skus:<8} {total_matched:<8} {overall_pct:<8.1f}")

    print(f"\nImagens salvas em: {os.path.abspath(OUTPUT_BASE)}")

    # Detalhe de unmatched
    for r in results:
        if r.get("unmatched_reasons"):
            from collections import Counter
            reasons = Counter(r["unmatched_reasons"])
            print(f"\n[{r['name']}] Motivos de unmatched: {dict(reasons)}")


if __name__ == "__main__":
    main()
