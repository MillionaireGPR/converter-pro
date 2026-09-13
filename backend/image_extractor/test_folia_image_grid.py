"""Regressão: Folia sem camada de texto ainda precisa ligar cada SKU ao card."""
import fitz
import numpy as np

import cv_extractor as cv


def image(xref, x0, y0, x1, y1):
    rect = fitz.Rect(x0, y0, x1, y1)
    return {
        "xref": xref,
        "rect": rect,
        "cx": (x0 + x1) / 2,
        "cy": (y0 + y1) / 2,
        "area": rect.width * rect.height,
    }


class FakePage:
    rect = fitz.Rect(0, 0, 595, 842)


class FakeDoc:
    def __len__(self):
        return 55

    def load_page(self, _index):
        return FakePage()


cards = [
    # Ordem propositalmente embaralhada e Y com pequena oscilação.
    image(3, 397, 158, 588, 349),
    image(1, 7, 157, 199, 349),
    image(4, 7, 353, 199, 545),
    image(2, 202, 157.5, 394, 349.5),
    # Cabeçalho retangular: não pode virar card de produto.
    image(99, 341, 18, 565, 113),
]

ordered = cv._folia_card_candidates(FakePage(), cards)
assert [item["xref"] for item in ordered] == [1, 2, 3, 4]

original_get_images = cv._get_page_embedded_images
cv._get_page_embedded_images = lambda *_args, **_kwargs: cards
try:
    skus = [
        {"sku": "JRF-1", "page": 17},
        {"sku": "JRF-2", "page": 17},
        {"sku": "JRF-3", "page": 17},
        {"sku": "JRF-4", "page": 17},
    ]
    assigned = cv._assign_folia_card_positions(FakeDoc(), skus, set(), set())
    assert assigned == 4
    assert [round(sku["spatialContext"]["x"]) for sku in skus] == [103, 298, 492, 103]
    assert [round(sku["spatialContext"]["y"]) for sku in skus] == [253, 254, 254, 449]
finally:
    cv._get_page_embedded_images = original_get_images

original_extract = cv._extract_perfect_image
original_save = cv._save_image
cv._extract_perfect_image = lambda *_args: np.zeros((100, 100, 3), dtype=np.uint8)
cv._save_image = lambda _image, sku, _folder: f"{sku}.jpg"
try:
    page_skus = [
        {"sku": "JRF-1", "spatialContext": {"x": 492, "y": 254, "page": 17}},
        {"sku": "JRF-2", "spatialContext": {"x": 103, "y": 253, "page": 17}},
        {"sku": "JRF-3", "spatialContext": {"x": 298, "y": 254, "page": 17}},
    ]
    matches, unmatched = cv._match_folia_cards(
        object(), FakePage(), np.zeros((842, 595, 3), dtype=np.uint8),
        page_skus, cards, 1.0, "tmp", 17,
    )
    assert {match["sku"] for match in matches} == {"JRF-1", "JRF-2", "JRF-3"}
    assert all(match["match_type"] == "folia_card" for match in matches)
    assert unmatched == []
finally:
    cv._extract_perfect_image = original_extract
    cv._save_image = original_save

print("OK: grade visual da Folia associa SKUs aos cards em ordem de leitura")
