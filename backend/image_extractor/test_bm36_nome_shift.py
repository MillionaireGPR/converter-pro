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

# ── Nome vazio (18/09/2026): 137 produtos da BM36 saíam sem nome e eram
# descartados da exportação. Layouts reais do mesmo catálogo em que o NOME
# sintetizado não casa: (a) código sozinho numa linha (pág. 71) e (b) bloco
# sem a linha de EAN de 13 dígitos (pág. 92). O fallback pega a última linha
# de texto antes do código, sem regra por fornecedor.
PAGE71_TEXT = (
    "GARRAFA INOX C/CAPA 1.1L \n"
    "WC409499 \n"
    "CD: 7898681262120\n"
    "CD: WC409499\n"
    "CX: 30 \n"
    "B6000B7200\n"
    "GARRAFA INOX INFANTIL 560ML \n"
    "WC410044 \n"
    "CD: 7908604400444\n"
    "CD: WC410044\n"
    "CX: 50\n"
    "B4500B5400\n"
)
p71 = {p["codigo"]: p for p in ge._apply_template([PAGE71_TEXT], TPL)}
assert p71["WC409499"]["nome"] == "GARRAFA INOX C/CAPA 1.1L", p71["WC409499"]
assert p71["WC410044"]["nome"] == "GARRAFA INOX INFANTIL 560ML", p71["WC410044"]
assert p71["WC409499"]["preco"] == 60.0 and p71["WC409499"]["quantidadeCaixa"] == 30

PAGE92_TEXT = (
    "GUARDA CHUVA LONGO MASCULINO 70CM 8K \n"
    "CD: WC4010166\n"
    "CX: 48 \n"
    "B3000B3600\n"
    "GUARDA CHUVA DOBRAVEL 3DOBRA AUTOMAT \n"
    "CD: WC4010177\n"
    "CX: 60 \n"
    "B3450B4140\n"
)
p92 = {p["codigo"]: p for p in ge._apply_template([PAGE92_TEXT], TPL)}
assert p92["WC4010166"]["nome"] == "GUARDA CHUVA LONGO MASCULINO 70CM 8K", p92["WC4010166"]
assert p92["WC4010177"]["nome"] == "GUARDA CHUVA DOBRAVEL 3DOBRA AUTOMAT", p92["WC4010177"]

print("OK: BM36 não troca mais o nome com o produto vizinho (nome antes do código)")
