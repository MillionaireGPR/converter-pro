"""
Cache de perfis de fornecedores auto-analisados (Phase 0).

Persiste em supplier_profiles/<NOME_NORMALIZADO>.json.
Prioridade de lookup: SUPPLIER_HINTS (hardcoded) > perfil em cache.
O desenvolvedor não precisa criar hints manualmente para novos fornecedores —
a Phase 0 (supplier_analyzer.py) gera e armazena automaticamente na 1ª conversão.
"""
import json
import os
import re
from typing import Optional

PROFILES_DIR = os.path.join(os.path.dirname(__file__), "supplier_profiles")


def _key(supplier: str) -> str:
    """Nome normalizado para uso como nome de arquivo."""
    s = supplier.strip().upper()
    for a, b in [("Á","A"),("Ã","A"),("Â","A"),("É","E"),("Ê","E"),
                 ("Í","I"),("Ó","O"),("Õ","O"),("Ô","O"),("Ú","U"),("Ç","C")]:
        s = s.replace(a, b)
    s = re.sub(r"[^A-Z0-9]+", "_", s)
    return s.strip("_")


def _path(supplier: str) -> str:
    os.makedirs(PROFILES_DIR, exist_ok=True)
    return os.path.join(PROFILES_DIR, _key(supplier) + ".json")


def load_profile(supplier: str) -> Optional[dict]:
    """Retorna o perfil completo ou None se não existir."""
    p = _path(supplier)
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save_profile(supplier: str, data: dict) -> None:
    """Salva (ou sobrescreve) perfil do fornecedor."""
    p = _path(supplier)
    data["_supplier"] = supplier
    try:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Phase0] Erro ao salvar perfil '{supplier}': {e}")


def get_cached_hints(supplier: str) -> Optional[str]:
    """Retorna hints em texto (para injetar no prompt) ou None."""
    profile = load_profile(supplier)
    if profile:
        return profile.get("hints") or None
    return None


def delete_profile(supplier: str) -> bool:
    """Remove perfil (ex: para forçar re-análise). Retorna True se deletou."""
    p = _path(supplier)
    if os.path.exists(p):
        os.remove(p)
        return True
    return False


def list_profiles() -> list:
    """Lista todos os fornecedores com perfil cacheado."""
    if not os.path.exists(PROFILES_DIR):
        return []
    result = []
    for fname in sorted(os.listdir(PROFILES_DIR)):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(PROFILES_DIR, fname), "r", encoding="utf-8") as f:
                d = json.load(f)
            result.append({
                "supplier": d.get("_supplier", fname[:-5]),
                "format_type": d.get("format_type", "?"),
                "saved_at": d.get("saved_at", "?"),
                "source": d.get("source", "auto"),
            })
        except Exception:
            pass
    return result
