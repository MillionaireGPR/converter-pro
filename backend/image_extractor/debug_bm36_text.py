"""Inspecao do texto bruto extraido de paginas BM36 para entender estrutura."""
import sys
sys.stdout.reconfigure(encoding="utf-8")
import fitz

PDF = (
    r"C:\Users\Gabriel Pantoni\OneDrive\Desktop\IQC PERSONALITE"
    r"\Clientes e Projetos\MICHELLE RIBEIRO NUNES DUARTE"
    r"\Conversor de Documentos\Catalogos modelos de Fornecedor"
    r"\CATALAGO GERAL BM36 (CÓDIGOS INICIADOS POR BM) e WORD CLASSIC (INICIADO POR WC) (2).pdf"
)

doc = fitz.open(PDF)
for pg_num in [4, 6, 15, 30]:
    if pg_num > len(doc):
        continue
    page = doc.load_page(pg_num - 1)
    text = page.get_text("text")
    print(f"\n========== PAGINA {pg_num} ==========")
    print(text)
    print(f"========== FIM PAGINA {pg_num} ==========\n")
doc.close()
