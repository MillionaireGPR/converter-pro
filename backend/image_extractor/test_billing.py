"""Assinatura (billing.py) sem rede: Supabase e InfinitePay simulados.

A regra de estados e a idempotência da confirmação são do SQL
(20260928_assinatura.sql) e foram testadas no banco real em transação
revertida; aqui o foco é o fluxo do backend: link, reconferência, portão.
"""
import pytest

from billing import Billing, BillingError


class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, tabela):
        self.db, self.tabela, self.filtros, self.op, self.payload, self._limit = db, tabela, [], "select", None, None

    def select(self, *_a):
        return self

    def eq(self, k, v):
        self.filtros.append(lambda r: r.get(k) == v)
        return self

    def gte(self, k, v):
        self.filtros.append(lambda r: str(r.get(k, "")) >= v)
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def update(self, row):
        self.op, self.payload = "update", row
        return self

    def execute(self):
        rows = self.db.tabelas[self.tabela]
        if self.op == "insert":
            from datetime import datetime, timezone
            rows.append({"status": "pendente", "criado_em": datetime.now(timezone.utc).isoformat(), **self.payload})
            return _Res([self.payload])
        sel = [r for r in rows if all(f(r) for f in self.filtros)]
        if self.op == "update":
            for r in sel:
                r.update(self.payload)
        return _Res(sel[: self._limit] if self._limit else sel)


class _RPC:
    def __init__(self, db, nome, args):
        self.db, self.nome, self.args = db, nome, args

    def execute(self):
        self.db.rpcs.append((self.nome, self.args))
        if self.nome == "app_assinatura_status":
            return _Res([{"estado": self.db.estado, "ativa": self.db.estado != "desligada"}])
        if self.nome == "app_assinatura_confirmar":
            for r in self.db.tabelas["app_assinatura_pagamentos"]:
                if r["order_nsu"] == self.args["p_order_nsu"]:
                    r["status"] = "pago"
            return _Res("OK")
        return _Res("2026-10-28T00:00:00+00:00")


class _FakeDB:
    def __init__(self, handle="nunesrep", estado="ativa"):
        self.tabelas = {
            "app_assinatura": [{"id": 1, "valor_centavos": 24900, "infinitepay_handle": handle, "ativa": True}],
            "app_assinatura_pagamentos": [],
        }
        self.rpcs, self.estado = [], estado

    def table(self, t):
        return _Query(self, t)

    def rpc(self, nome, args):
        return _RPC(self, nome, args)


def _billing(db, respostas):
    chamadas = []

    def http(url, body):
        chamadas.append((url, body))
        r = respostas[url.rsplit("/", 1)[-1]]
        if isinstance(r, Exception):
            raise r
        return r

    b = Billing(db_factory=lambda: db, http_post=http, cache_ttl=0)
    return b, chamadas


def test_checkout_cria_link_com_webhook_e_valor():
    db = _FakeDB()
    b, chamadas = _billing(db, {"links": {"url": "https://checkout.infinitepay.io/x"}})
    r = b.criar_checkout("admin")
    assert r["url"].startswith("https://checkout.infinitepay.io")
    url, body = chamadas[0]
    assert url.endswith("/links")
    assert body["handle"] == "nunesrep"
    assert body["items"][0]["price"] == 24900
    assert body["webhook_url"].endswith("/billing/webhook")
    assert body["order_nsu"].startswith("conv-")
    assert db.tabelas["app_assinatura_pagamentos"][0]["checkout_url"] == r["url"]


def test_checkout_reaproveita_link_pendente():
    db = _FakeDB()
    b, chamadas = _billing(db, {"links": {"url": "https://checkout.infinitepay.io/x"}})
    r1 = b.criar_checkout()
    r2 = b.criar_checkout()
    assert r2["reaproveitado"] and r2["order_nsu"] == r1["order_nsu"]
    assert len(chamadas) == 1


def test_checkout_sem_handle_explica():
    b, _ = _billing(_FakeDB(handle=None), {})
    with pytest.raises(BillingError) as e:
        b.criar_checkout()
    assert e.value.status == 409


def test_confirmar_so_libera_se_infinitepay_confirmar():
    db = _FakeDB()
    b, _ = _billing(db, {"links": {"url": "https://c/x"}, "payment_check": {"success": True, "paid": False}})
    nsu = b.criar_checkout()["order_nsu"]
    assert b.confirmar(nsu, "t", "s") == "NAO_PAGO"
    assert not any(n == "app_assinatura_confirmar" for n, _ in db.rpcs)


def test_confirmar_pago_chama_rpc_com_valor_da_infinitepay():
    db = _FakeDB()
    b, chamadas = _billing(db, {
        "links": {"url": "https://c/x"},
        "payment_check": {"success": True, "paid": True, "paid_amount": 24900, "capture_method": "pix"},
    })
    nsu = b.criar_checkout()["order_nsu"]
    assert b.confirmar(nsu, "t1", "s1", "javascript:alert(1)") == "OK"
    _, args = [x for x in db.rpcs if x[0] == "app_assinatura_confirmar"][0]
    assert args["p_valor_pago"] == 24900 and args["p_metodo"] == "pix"
    assert args["p_recibo_url"] is None  # só aceita https
    assert chamadas[-1][1] == {"handle": "nunesrep", "order_nsu": nsu, "transaction_nsu": "t1", "slug": "s1"}
    assert b.confirmar(nsu, "t1", "s1") == "JA_PAGO"


def test_confirmar_ignora_pedido_que_nao_e_nosso():
    b, chamadas = _billing(_FakeDB(), {})
    assert b.confirmar("pedido-loja-x", "t", "s") == "NAO_ENCONTRADO"
    assert b.confirmar("conv-inexistente", "t", "s") == "NAO_ENCONTRADO"
    assert chamadas == []


@pytest.mark.parametrize("estado,liberado", [
    ("desligada", True), ("ativa", True), ("vencendo", True), ("carencia", True), ("bloqueada", False),
])
def test_portao_das_conversoes(estado, liberado):
    b, _ = _billing(_FakeDB(estado=estado), {})
    assert b.conversao_liberada()[0] is liberado


def test_portao_libera_se_supabase_cair():
    def quebra():
        raise RuntimeError("supabase fora")
    b = Billing(db_factory=quebra, http_post=lambda *_: {}, cache_ttl=0)
    assert b.conversao_liberada()[0] is True


def test_config_so_campos_permitidos_e_limpa_handle():
    db = _FakeDB()
    b, _ = _billing(db, {})
    cfg = b.atualizar_config({"ativa": True, "infinitepay_handle": " $minhaloja ", "pago_ate": "2099-01-01"})
    assert cfg["infinitepay_handle"] == "minhaloja"
    assert "pago_ate" not in cfg  # pago_ate só muda por pagamento ou liberação manual


def test_liberar_manual_valida_dias():
    b, _ = _billing(_FakeDB(), {})
    with pytest.raises(BillingError):
        b.liberar_manual(0, "x")
    assert b.liberar_manual(30, "PIX recebido por fora")


def test_link_aceita_payment_url():
    db = _FakeDB()
    b, _ = _billing(db, {"links": {"payment_url": "https://checkout.infinitepay.io/y"}})
    assert b.criar_checkout()["url"] == "https://checkout.infinitepay.io/y"


def test_checkout_externo_desligado_vira_mensagem_clara(monkeypatch):
    import io
    import urllib.error
    import billing as mod

    def http_404(*_a, **_k):
        raise urllib.error.HTTPError("u", 404, "nf", {}, io.BytesIO(
            b'{"success":false,"error":"external_checkout_not_enabled","message":"External checkout is not enabled"}'))
    monkeypatch.setattr(mod.urllib.request, "urlopen", http_404)
    with pytest.raises(BillingError) as e:
        mod._http_post_json("https://api.checkout.infinitepay.io/links", {})
    assert e.value.status == 409 and "Checkout externo" in e.value.mensagem
