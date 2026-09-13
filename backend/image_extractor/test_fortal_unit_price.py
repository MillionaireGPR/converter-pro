"""Regressão: Fortal deve usar `UND: R$ 7,20`, não o total `R$ 72,00`."""
import fitz

import gemini_extractor as ge


class FakePage:
    rect = fitz.Rect(0, 0, 595, 842)

    def search_for(self, code):
        positions = {
            "BDZ-2523": fitz.Rect(19, 245, 70, 255),
            "BDZ-2524": fitz.Rect(162, 245, 215, 255),
        }
        return [positions[code]] if code in positions else []


class FakeDoc:
    def __len__(self):
        return 20

    def load_page(self, _index):
        return FakePage()

    def close(self):
        pass


page_text = "\n".join([
    "[19,245] BDZ-2523",
    "[162,245] BDZ-2524",
    "[53,286] UND: R$ 7,20",
    "[197,286] UND: R$ 8,30",
    "[61,301] R$ 72,00",
    "[205,301] R$ 83,00",
])

original_open = ge.fitz.open
original_page_text = ge.page_text_for_ai
ge.fitz.open = lambda _path: FakeDoc()
ge.page_text_for_ai = lambda _page: page_text
try:
    produtos = [
        {"codigo": "BDZ-2523", "preco": 72.0, "paginaOrigem": 10},
        {"codigo": "BDZ-2524", "preco": 83.0, "paginaOrigem": 10},
    ]
    fixed = ge._fix_fortal_unit_prices("fortal.pdf", produtos, "FORTAL")
    assert [produto["preco"] for produto in fixed] == [7.2, 8.3]

    untouched = [{"codigo": "X", "preco": 72.0, "paginaOrigem": 10}]
    ge._fix_fortal_unit_prices("outro.pdf", untouched, "OUTRO")
    assert untouched[0]["preco"] == 72.0
finally:
    ge.fitz.open = original_open
    ge.page_text_for_ai = original_page_text

print("OK: Fortal usa o preço unitário marcado por UND")
