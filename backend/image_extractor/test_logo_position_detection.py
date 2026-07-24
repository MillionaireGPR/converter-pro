"""
Teste isolado do filtro de logo por CONTEUDO (digest) em _detect_logo_xrefs /
_get_page_embedded_images.

Historico (24/07/2026, mesmo dia, dois achados reais em sequencia):

1. Catalogo Lila Home ("_CATALOGO ATUALIZADO 1307"): produto LH635 puxava
   o logo da empresa em vez da foto do produto. Causa raiz: o filtro antigo
   so detectava logo por MESMO XREF reaproveitado em >=3 paginas, mas esse
   catalogo reinsere uma COPIA NOVA do logo a cada pagina (xref diferente
   sempre, mesma posicao/tamanho no topo) -- o filtro por xref nunca
   disparava. Fix v1: detectar TAMBEM por posicao (bbox arredondado)
   repetindo em >=3 paginas.

2. Catalogo Fortal (real, 875p/103p): o fix v1 (por posicao) criou um FALSO
   POSITIVO -- Fortal usa um grid template PERFEITO (mesmas N celulas, MESMO
   tamanho, em TODA pagina de produto). Toda foto real "repete posicao"
   entre paginas tanto quanto um logo de verdade repetiria, entao TODAS as
   12 fotos legitimas da pagina eram classificadas como "logo" e filtradas
   -- 0 imagens validas, exatamente o "as imagens nao vieram" relatado.

Fix definitivo (v2): usa o DIGEST (hash do conteudo da imagem, ja calculado
pelo MuPDF em get_image_info) em vez de posicao. Um logo genuino repete o
MESMO CONTEUDO em posicao fixa; fotos de produtos DIFERENTES na mesma celula
de grid tem digest diferente -- disambiguacao correta nos dois casos.

Usa fakes leves (duck-typing) em vez de PDF real, mesmo estilo dos outros
testes deste diretorio.

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
    """images: lista de (xref, x0, y0, x1, y1, digest)."""
    def __init__(self, images, page_w=600, page_h=800):
        self._images = images
        self.rect = fitz.Rect(0, 0, page_w, page_h)
        self.parent = self  # duck-type: page.parent.extract_image(xref)

    def get_image_info(self, xrefs=True):
        return [
            {"xref": xref, "bbox": (x0, y0, x1, y1), "digest": digest}
            for (xref, x0, y0, x1, y1, digest) in self._images
        ]

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


print("TESTE 1 -- logo com XREF DIFERENTE por pagina, MESMO CONTEUDO (digest) -- excluido")
print(SEP)

LOGO_POS = (250, 5, 350, 105)  # topo-centro, repete em toda pagina (achado real Lila Home)
LOGO_DIGEST = b"logo-lila-home-digest"

pages = []
for i in range(4):
    logo_xref = 100 + i  # xref MUDA a cada pagina -- é isso que o sinal por xref não pegava
    produto_xref = 200 + i
    produto_pos = (50, 400 + i * 5, 250, 600 + i * 5)  # posicao tambem varia (nao é o ponto aqui)
    produto_digest = f"produto-digest-{i}".encode()  # CONTEUDO diferente por pagina
    pages.append(FakePage([
        (logo_xref, *LOGO_POS, LOGO_DIGEST),
        (produto_xref, *produto_pos, produto_digest),
    ]))

doc = FakeDoc(pages)
logo_xrefs, logo_digests = cv._detect_logo_xrefs(doc)

check("nenhum xref repete (todos diferentes por pagina)", len(logo_xrefs) == 0, f"logo_xrefs={logo_xrefs}")
check("digest do logo foi detectado como repetido", LOGO_DIGEST in logo_digests, f"logo_digests={logo_digests}")

for i, page in enumerate(pages):
    imgs = cv._get_page_embedded_images(page, logo_xrefs, logo_digests)
    xrefs_result = {img["xref"] for img in imgs}
    check(f"pagina {i}: logo (xref {100+i}) EXCLUIDO", (100 + i) not in xrefs_result, f"xrefs={xrefs_result}")
    check(f"pagina {i}: produto (xref {200+i}) mantido", (200 + i) in xrefs_result, f"xrefs={xrefs_result}")

print(SEP)
print("TESTE 2 -- sem conteudo repetido, nada e filtrado (regressao)")
print(SEP)

pages2 = []
for i in range(4):
    produto_xref = 300 + i
    produto_pos = (50 + i * 10, 100 + i * 10, 250 + i * 10, 300 + i * 10)
    produto_digest = f"unico-{i}".encode()
    pages2.append(FakePage([(produto_xref, *produto_pos, produto_digest)]))

doc2 = FakeDoc(pages2)
logo_xrefs2, logo_digests2 = cv._detect_logo_xrefs(doc2)
check("nenhum digest repetido detectado", len(logo_digests2) == 0, f"logo_digests2={logo_digests2}")

imgs_p0 = cv._get_page_embedded_images(pages2[0], logo_xrefs2, logo_digests2)
check("imagem unica da pagina 0 mantida (nao filtrada por engano)", len(imgs_p0) == 1, f"imgs={imgs_p0}")

print(SEP)
print("TESTE 3 -- grid template perfeito (Fortal): MESMA posicao, CONTEUDO diferente -- NAO filtra")
print(SEP)

GRID_POS = (17, 96, 147, 226)  # mesma celula de grid em toda pagina (achado real Fortal)

pages3 = []
for i in range(5):
    xref = 700 + i
    digest = f"produto-fortal-pagina-{i}".encode()  # produto DIFERENTE em cada pagina, mesma celula
    pages3.append(FakePage([(xref, *GRID_POS, digest)]))

doc3 = FakeDoc(pages3)
logo_xrefs3, logo_digests3 = cv._detect_logo_xrefs(doc3)
check("nenhum digest repetido (conteudo muda a cada pagina)", len(logo_digests3) == 0, f"logo_digests3={logo_digests3}")

for i, page in enumerate(pages3):
    imgs = cv._get_page_embedded_images(page, logo_xrefs3, logo_digests3)
    check(f"pagina {i}: foto do grid NAO filtrada por posicao repetida", len(imgs) == 1, f"imgs={imgs}")

print(SEP)
if falhas:
    print(f"RESULTADO: {len(falhas)} FALHA(S) -- {falhas}")
    sys.exit(1)
print("RESULTADO: TODOS OS TESTES PASSARAM")
