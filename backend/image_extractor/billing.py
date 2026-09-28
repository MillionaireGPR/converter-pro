"""
ASSINATURA DO CONVERSOR (28/09/2026) — cobrança mensal por link InfinitePay.

Fluxo:
  1. Cliente clica "Pagar" no painel → POST /billing/checkout → gravamos um
     pagamento 'pendente' com order_nsu nosso e pedimos o link à InfinitePay.
  2. Cliente paga (PIX/cartão) → InfinitePay chama POST /billing/webhook e
     redireciona o navegador de volta com order_nsu/transaction_nsu/slug.
  3. Nos DOIS caminhos reconferimos na própria InfinitePay (/payment_check)
     antes de liberar — o webhook não é assinado, então não é confiável
     sozinho. A RPC app_assinatura_confirmar é idempotente (webhook + retorno
     do navegador estendem o período uma vez só).
  4. Conversões (/process, /extract_products_ai, /repair_prices_ai) exigem
     assinatura em dia quando a cobrança está LIGADA (402 se bloqueada).

Estado e regras vivem no Supabase (migration 20260928_assinatura.sql), então
os 3 servidores (Integrator, Wesley, Render) enxergam a mesma assinatura.
"""
from __future__ import annotations

import json
import os
import time
import uuid
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

INFINITEPAY_API = "https://api.checkout.infinitepay.io"
DESCRICAO_ITEM = "Central de Conversão - assinatura mensal"

# Endereço FIXO do backend (webhook) e do site (volta após pagar).
PUBLIC_URL = os.environ.get("BILLING_PUBLIC_URL", "https://conversor-vps.metodoiqc.com.br").rstrip("/")
APP_URL = os.environ.get("BILLING_APP_URL", "https://centraldeconversao.vercel.app").rstrip("/")

CONFIG_EDITAVEL = ("ativa", "valor_centavos", "periodo_dias", "carencia_dias", "aviso_dias", "infinitepay_handle")


class BillingError(Exception):
    def __init__(self, status: int, mensagem: str):
        super().__init__(mensagem)
        self.status = status
        self.mensagem = mensagem


def _http_post_json(url: str, body: dict, timeout: float = 15) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        corpo = e.read().decode("utf-8", "replace")[:500]
        try:
            info = json.loads(corpo)
        except ValueError:
            info = {}
        if info.get("error") == "external_checkout_not_enabled":
            raise BillingError(409, "Checkout externo desligado na InfinitePay: ative em "
                                    "app.infinitepay.io → Configurações → Checkout externo.")
        raise BillingError(502, f"InfinitePay respondeu {e.code}: {info.get('message') or corpo[:200]}")
    except (urllib.error.URLError, TimeoutError) as e:
        raise BillingError(502, f"InfinitePay indisponível: {e}")


def _db():
    from storage import supabase  # service role; import tardio (testes injetam)
    return supabase


class Billing:
    """Dependências injetáveis (db, http, relógio) para testar sem rede."""

    def __init__(self, db_factory: Callable[[], Any] = _db,
                 http_post: Callable[[str, dict], dict] = _http_post_json,
                 cache_ttl: float = 30.0):
        self._db_factory = db_factory
        self._http_post = http_post
        self._cache_ttl = cache_ttl
        self._cache: tuple[float, dict] | None = None

    # ── leitura ───────────────────────────────────────────────
    def status(self, usar_cache: bool = False) -> dict:
        if usar_cache and self._cache and time.time() - self._cache[0] < self._cache_ttl:
            return self._cache[1]
        rows = self._db_factory().rpc("app_assinatura_status", {}).execute().data or []
        st = rows[0] if rows else {"estado": "desligada", "ativa": False}
        self._cache = (time.time(), st)
        return st

    def invalidar(self):
        self._cache = None

    def config(self) -> dict:
        rows = self._db_factory().table("app_assinatura").select("*").eq("id", 1).execute().data or []
        return rows[0] if rows else {}

    def pagamentos(self, limite: int = 50) -> list[dict]:
        return (self._db_factory().table("app_assinatura_pagamentos").select("*")
                .order("criado_em", desc=True).limit(limite).execute().data or [])

    # ── portão das conversões ─────────────────────────────────
    def conversao_liberada(self) -> tuple[bool, dict | None]:
        """Bloqueia só com certeza: se o Supabase falhar, libera (fail-open)
        — cliente pagante não pode parar por instabilidade nossa."""
        try:
            st = self.status(usar_cache=True)
        except Exception as e:  # noqa: BLE001
            print(f"[billing] status indisponível, liberando conversão: {e}")
            return True, None
        return st.get("estado") != "bloqueada", st

    # ── checkout ──────────────────────────────────────────────
    def criar_checkout(self, solicitado_por: str = "") -> dict:
        cfg = self.config()
        handle = (cfg.get("infinitepay_handle") or "").strip().lstrip("$")
        if not handle:
            raise BillingError(409, "Conta InfinitePay não configurada (painel do servidor → Assinatura).")
        valor = int(cfg.get("valor_centavos") or 0)
        db = self._db_factory()

        # Reaproveita link pendente recente do mesmo valor (evita pilha de
        # links se o cliente clicar várias vezes).
        desde = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        pend = (db.table("app_assinatura_pagamentos").select("order_nsu,checkout_url,valor_centavos")
                .eq("status", "pendente").eq("valor_centavos", valor).gte("criado_em", desde)
                .order("criado_em", desc=True).limit(1).execute().data or [])
        if pend and pend[0].get("checkout_url"):
            return {"url": pend[0]["checkout_url"], "order_nsu": pend[0]["order_nsu"], "reaproveitado": True}

        order_nsu = f"conv-{uuid.uuid4().hex[:20]}"
        db.table("app_assinatura_pagamentos").insert({
            "order_nsu": order_nsu, "valor_centavos": valor,
            "solicitado_por": (solicitado_por or "")[:80],
        }).execute()
        resp = self._http_post(f"{INFINITEPAY_API}/links", {
            "handle": handle,
            "order_nsu": order_nsu,
            "redirect_url": f"{APP_URL}/assinatura",
            "webhook_url": f"{PUBLIC_URL}/billing/webhook",
            "items": [{"quantity": 1, "price": valor, "description": DESCRICAO_ITEM}],
        })
        url = resp.get("url") or resp.get("payment_url") or resp.get("link")
        if not url:
            raise BillingError(502, f"InfinitePay não devolveu o link: {str(resp)[:200]}")
        db.table("app_assinatura_pagamentos").update({"checkout_url": url}).eq("order_nsu", order_nsu).execute()
        return {"url": url, "order_nsu": order_nsu, "reaproveitado": False}

    # ── confirmação (webhook e retorno do navegador) ──────────
    def confirmar(self, order_nsu: str, transaction_nsu: str, slug: str, recibo_url: str = "") -> str:
        order_nsu = (order_nsu or "").strip()
        if not order_nsu.startswith("conv-"):
            return "NAO_ENCONTRADO"  # não é um pedido nosso
        db = self._db_factory()
        rows = (db.table("app_assinatura_pagamentos").select("status").eq("order_nsu", order_nsu)
                .limit(1).execute().data or [])
        if not rows:
            return "NAO_ENCONTRADO"
        if rows[0]["status"] == "pago":
            return "JA_PAGO"
        handle = (self.config().get("infinitepay_handle") or "").strip().lstrip("$")
        chk = self._http_post(f"{INFINITEPAY_API}/payment_check", {
            "handle": handle, "order_nsu": order_nsu,
            "transaction_nsu": transaction_nsu or "", "slug": slug or "",
        })
        if not (chk.get("success") and chk.get("paid")):
            return "NAO_PAGO"
        recibo = recibo_url if str(recibo_url or "").startswith("https://") else None
        res = db.rpc("app_assinatura_confirmar", {
            "p_order_nsu": order_nsu,
            "p_valor_pago": int(chk.get("paid_amount") or chk.get("amount") or 0),
            "p_metodo": str(chk.get("capture_method") or "")[:20],
            "p_transaction_nsu": transaction_nsu or None,
            "p_invoice_slug": slug or None,
            "p_recibo_url": recibo,
        }).execute().data
        self.invalidar()
        return str(res if isinstance(res, str) else (res[0] if isinstance(res, list) and res else res))

    # ── administração (token do fornecedor) ───────────────────
    def atualizar_config(self, dados: dict) -> dict:
        upd = {k: v for k, v in dados.items() if k in CONFIG_EDITAVEL and v is not None}
        if "infinitepay_handle" in upd:
            upd["infinitepay_handle"] = str(upd["infinitepay_handle"]).strip().lstrip("$") or None
        if not upd:
            raise BillingError(400, "Nada para atualizar.")
        upd["atualizado_em"] = datetime.now(timezone.utc).isoformat()
        self._db_factory().table("app_assinatura").update(upd).eq("id", 1).execute()
        self.invalidar()
        return self.config()

    def liberar_manual(self, dias: int, observacao: str) -> str:
        if not (1 <= int(dias) <= 366):
            raise BillingError(400, "Dias entre 1 e 366.")
        res = self._db_factory().rpc("app_assinatura_liberar_manual", {
            "p_dias": int(dias), "p_observacao": (observacao or "")[:200],
        }).execute().data
        self.invalidar()
        return str(res)


billing = Billing()
