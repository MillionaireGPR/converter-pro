import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/core/backendResolver", () => ({ getBackendUrl: async () => "https://api.teste" }));

import {
  buscarStatusAssinatura, lerRetornoPagamento, precisaBloquear, STATUS_DESLIGADA,
  StatusAssinatura, criarCheckout,
} from "./assinatura";

const st = (estado: StatusAssinatura["estado"]): StatusAssinatura => ({ ...STATUS_DESLIGADA, estado });

describe("assinatura", () => {
  beforeEach(() => rpc.mockReset());

  it("bloqueia só com estado bloqueada, e nunca a própria tela de pagar", () => {
    for (const e of ["desligada", "ativa", "vencendo", "carencia"] as const) {
      expect(precisaBloquear(st(e), "/conversao")).toBe(false);
    }
    expect(precisaBloquear(st("bloqueada"), "/conversao")).toBe(true);
    expect(precisaBloquear(st("bloqueada"), "/assinatura")).toBe(false);
  });

  it("erro no Supabase (ex.: migration ausente) não bloqueia o cliente", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    expect((await buscarStatusAssinatura()).estado).toBe("desligada");
  });

  it("lê o estado da RPC", async () => {
    rpc.mockResolvedValue({ data: [{ ...STATUS_DESLIGADA, estado: "vencendo", dias_restantes: 3 }], error: null });
    const s = await buscarStatusAssinatura();
    expect(s.estado).toBe("vencendo");
    expect(s.dias_restantes).toBe(3);
  });

  it("lê os parâmetros de volta da InfinitePay", () => {
    expect(lerRetornoPagamento("")).toBeNull();
    expect(lerRetornoPagamento("?order_nsu=conv-1&transaction_nsu=t&slug=s&receipt_url=https%3A%2F%2Fr")).toEqual({
      order_nsu: "conv-1", transaction_nsu: "t", slug: "s", receipt_url: "https://r",
    });
  });

  it("checkout mostra a mensagem do backend quando falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 409, json: async () => ({ detail: "Conta InfinitePay não configurada" }),
    })));
    await expect(criarCheckout("admin")).rejects.toThrow("Conta InfinitePay não configurada");
    vi.unstubAllGlobals();
  });
});
