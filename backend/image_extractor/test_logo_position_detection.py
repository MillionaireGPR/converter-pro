"""
Teste isolado do filtro de logo por POSICAO em _detect_logo_xrefs /
_get_page_embedded_images (achado real: catalogo Lila Home "_CATALOGO
ATUALIZADO 1307", 24/07/2026 -- produto LH635 puxava o logo da empresa
em vez da foto do produto).

Causa raiz: o filtro antigo so detectava logo por MESMO XREF reaproveitado
em >=3 paginas. Nesse catalogo real, o PDF reinsere uma COPIA NOVA do logo
a cada pagina (xref diferente por pagina, mesma posicao/tamanho no topo),
entao o filtro por xref nunca disparava e o logo entrava como candidato
valido de imagem de produto.

Fix: alem do xref, detecta tambem por ASSINATURA POSICIONAL (bbox
arredondado a 5pt) repetindo em >=3 paginas amostradas -- pega o caso do
xref-novo-por-pagina sem depender de tamanho (nao e so um "selo" pequeno,
ver PR do badge-filter que usa area; aqui pode ser tao grande quanto um
produto real, so que sempre na MESMA posicao entre paginas diferentes).

Usa fakes leves (duck-typing) em vez de PDF real, mesmo estilo dos
outros testes deste diretorio.

Uso: python test_logo_position_detection.py
"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(__file__))

import fitz
import cv_extractor as cv

SEP = "-" * 60
falhas = []


def check(nome, cond, detalhe=""):
    status = "OK" if cond else "FALHA"
    print(f"  [{status}] {nome}" + (f" -- {detalhe}" if detalhe and not cond else ""))
    if not cond:
        falhas.append(nome)


class FakePage:
    """images: lista de (xref, x0, y0, x1, y1)."""
    def __init__(self, images, page_w=600, page_h=800):
        self._images = images
        self.rect = fitz.Rect(0, 0, page_w, page_h)
        self.parent = self  # duck-type: page.parent.extract_image(xref)

    def get_images(self, full=True):
        return [(xref, 0, 0, 0, 0, 0, 0, 0, 0, 0) for (xref, *_r) in self._images]

    def get_image_rects(self, xref):
        for entry in self._images:
            if entry[0] == xref:
                _, x0, y0, x1, y1 = entry
                return [fitz.Rect(x0, y0, x1, y1)]
        return []

    def extract_image(self, xref):
        # aspect 1:1 (< 1.5) -> pula o gate de codigo de barras sem precisar de bytes reais
        return {"width": 100, "height": 100, "image": b""}


class FakeDoc:
    def __init__(self, pages):
        self._pages = pages

    def __len__(self):
        return len(self._pages)

    def load_page(self, i):
        return self._pages[i]


print("TESTE 1 -- logo com XREF DIFERENTE por pagina (mesma posicao) e detectado e excluido")
print(SEP)

LOGO_POS = (250, 5, 350, 105)  # topo-centro, repete em toda pagina (achado real Lila Home)

pages = []
for i in range(4):
    logo_xref = 100 + i  # xref MUDA a cada pagina -- é isso que o sinal antigo (por xref) não pegava
    produto_xref = 200 + i
    # produto em posicao DIFERENTE por pagina (nao deve ser filtrado)
    produto_pos = (50, 400 + i * 5, 250, 600 + i * 5)
    pages.append(FakePage([
        (logo_xref,) + LOGO_POS,
        (produto_xref,) + produto_pos,
    ]))

doc = FakeDoc(pages)
logo_xrefs, logo_positions = cv._detect_logo_xrefs(doc)

check("nenhum xref repete (todos diferentes por pagina)", len(logo_xrefs) == 0, f"logo_xrefs={logo_xrefs}")
check("posicao do logo foi detectada como repetida", len(logo_positions) == 1, f"logo_positions={logo_positions}")

for i, page in enumerate(pages):
    imgs = cv._get_page_embedded_images(page, logo_xrefs, logo_positions)
    xrefs_result = {img["xref"] for img in imgs}
    check(f"pagina {i}: logo (xref {100+i}) EXCLUIDO", (100 + i) not in xrefs_result, f"xrefs={xrefs_result}")
    check(f"pagina {i}: produto (xref {200+i}) mantido", (200 + i) in xrefs_result, f"xrefs={xrefs_result}")

print(SEP)
print("TESTE 2 -- sem logo repetido, nada e filtrado por posicao (regressao)")
print(SEP)

pages2 = []
for i in range(4):
    produto_xref = 300 + i
    produto_pos = (50 + i * 10, 100 + i * 10, 250 + i * 10, 300 + i * 10)  # posicao unica por pagina
    pages2.append(FakePage([(produto_xref,) + produto_pos]))

doc2 = FakeDoc(pages2)
logo_xrefs2, logo_positions2 = cv._detect_logo_xrefs(doc2)
check("nenhuma posicao repetida detectada", len(logo_positions2) == 0, f"logo_positions2={logo_positions2}")

imgs_p0 = cv._get_page_embedded_images(pages2[0], logo_xrefs2, logo_positions2)
check("imagem unica da pagina 0 mantida (nao filtrada por engano)", len(imgs_p0) == 1, f"imgs={imgs_p0}")

print(SEP)
if falhas:
    print(f"RESULTADO: {len(falhas)} FALHA(S) -- {falhas}")
    sys.exit(1)
print("RESULTADO: TODOS OS TESTES PASSARAM")
