"""Regressão: nome do BM36 saía com o rabo do produto SEGUINTE (achado
17/09/2026, relatório real do Josef: BM361552 devia sair "FACA PATE C/4
-15cm DOURADO" e saiu "S 13,2CM PRATEAD", pedaço do produto vizinho).

Causa raiz (dupla):
1. `_apply_template` fatiava o bloco de cada produto a partir do match do
   CODE (`CD: BM######`) até o PRÓXIMO CODE — mas nesse catálogo o NOME
   vem ANTES do CODE no texto (nome+SKU, depois "CD: <EAN>", depois
   "CD: BM######"), então esse bloco continha o preço/qtd do produto atual
   + o nome do produto SEGUINTE, nunca o nome do produto atual.
2. A classe de caractere que a IA sintetizou para o grupo de captura do
   nome ([A-Z0-9\\s.,-]) não inclui acento nem minúscula — comuns em
   português ("cm", "PÉS") — truncando o nome mesmo quando o bloco estava
   certo.

Fixture: texto real da página 4 do catálogo BM36 baixado do servidor
(job aifirst_e1e1defb, 17/09/2026), via `page.get_text()` do PyMuPDF.
"""
import gemini_extractor as ge

PAGE4_TEXT = (
    "FACA PATE C/4 -15cm DOURADO BM361552 \n"
    "CD: 7898667548989\n"
    "CD: BM361552 \n"
    "CX: 50\n"
    "B1095B1314\n"
    "GARFO PETISCO C/6 PÉS 13,2CM PRATEAD \n"
    "CD: 7898667549191\n"
    "CD: BM361573\n"
    "CX: 100 \n"
    "B1050B1260\n"
    "GARFO PETISCO C/6 PÉS 13,2CM DOURADO \n"
    "CD: 7898667549214\n"
    "CD: BM361575 \n"
    "CX: 100\n"
    "B1290B1548\n"
)

TPL = {
    "CODE": r"CD: (BM\d{6}|WC\d{6,7})",
    "NOME": r"(?P<nome>[A-Z0-9\s.,\/&-]+?)\s*\nCD: \d{13}",
    "PRECO": r"B(\d+)B\d+",
    "QTD": r"CX: (\d+)",
    "PRECO_FMT": "CENTS",
}

produtos = ge._apply_template([PAGE4_TEXT], TPL)
by_code = {p["codigo"]: p for p in produtos}

assert by_code["BM361552"]["nome"] == "FACA PATE C/4 -15cm DOURADO", by_code["BM361552"]
assert by_code["BM361573"]["nome"] == "GARFO PETISCO C/6 PÉS 13,2CM PRATEAD", by_code["BM361573"]
assert by_code["BM361575"]["nome"] == "GARFO PETISCO C/6 PÉS 13,2CM DOURADO", by_code["BM361575"]

# preço/qtd não podem regredir com a mudança (continuam no bloco pra frente)
assert by_code["BM361552"]["preco"] == 10.95
assert by_code["BM361552"]["quantidadeCaixa"] == 50

# nome que já vem certo (código DEPOIS do nome, layout padrão) não pode quebrar
STANDARD_TEXT = "ABC123\nNOME PRODUTO PADRAO\nQuant: 10\n"
TPL_STANDARD = {
    "CODE": r"^([A-Z]{3}\d{3})",
    "NOME": r"^[A-Z]{3}\d{3}\s*\n(.+?)\nQuant:",
    "PRECO": "NONE",
    "QTD": r"Quant:\s*(\d+)",
    "PRECO_FMT": "BR",
}
padrao = ge._apply_template([STANDARD_TEXT], TPL_STANDARD)
assert padrao[0]["nome"] == "NOME PRODUTO PADRAO", padrao

print("OK: BM36 não troca mais o nome com o produto vizinho (nome antes do código)")
