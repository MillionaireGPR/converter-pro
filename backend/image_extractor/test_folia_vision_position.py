"""Regressão: posição visual da Folia vira coordenada usada pelo extrator."""
import json

import gemini_extractor as ge


class FakeResponse:
    text = json.dumps({
        "produtos": [{
            "codigo": "JRF-10.0581",
            "nome": "KIT COZINHA",
            "preco": 26.90,
            "posicaoVisual": {"x": 500, "y": 250},
        }]
    })


class FakeModel:
    def generate_content(self, *_args, **_kwargs):
        return FakeResponse()


class FakeGenAi:
    class GenerationConfig:
        def __init__(self, **_kwargs):
            pass

    @staticmethod
    def GenerativeModel(_name):
        return FakeModel()


original_ensure = ge._ensure_initialized
original_genai = ge.genai
ge._ensure_initialized = lambda: True
ge.genai = FakeGenAi()
try:
    produtos, ok = ge._extract_vision_chunk(
        [(17, b"jpeg")], "", "fake-model", {17: (595.0, 842.0)},
    )
    assert ok is True
    assert len(produtos) == 1
    spatial = produtos[0]["spatialContext"]
    assert spatial == {
        "x": 297.5,
        "y": 631.5,
        "width": 0,
        "height": 0,
        "page": 17,
    }
    assert "posicaoVisual" not in produtos[0]

    merged = ge._merge_vision_products(
        [{"codigo": "A"}], [{"codigo": "A"}, {"codigo": "B"}], 2,
    )
    assert [product["codigo"] for product in merged] == ["A", "B"]

    overflow = ge._merge_vision_products(
        [{"codigo": "A"}], [{"codigo": "B"}, {"codigo": "C"}], 2,
    )
    assert [product["codigo"] for product in overflow] == ["A"]
finally:
    ge._ensure_initialized = original_ensure
    ge.genai = original_genai

print("OK: posição visual normalizada foi convertida para a página PDF")
