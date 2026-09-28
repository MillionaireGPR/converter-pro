// ===================================================================
// ASSINATURA (28/09/2026) — lado do cliente.
// Estado vem do Supabase (RPC app_assinatura_status, mesma regra que o
// backend usa pra bloquear conversões). Pagar/confirmar passa pelo backend,
// que fala com a InfinitePay e reconfere o pagamento antes de liberar.
// Ver supabase/migrations/20260928_assinatura.sql e backend billing.py.
// ===================================================================
import { supabase } from "@/integrations/supabase/client";
import { getBackendUrl } from "@/core/backendResolver";

export type EstadoAssinatura = "desligada" | "ativa" | "vencendo" | "carencia" | "bloqueada";

export interface StatusAssinatura {
  estado: EstadoAssinatura;
  ativa: boolean;
  pago_ate: string | null;
  bloqueia_em: string | null;
  dias_restantes: number | null;
  valor_centavos: number;
  periodo_dias: number;
  carencia_dias: number;
  aviso_dias: number;
}

export interface PagamentoAssinatura {
  criado_em: string;
  status: "pago" | "manual";
  valor_centavos: number;
  pago_em: string | null;
  metodo: string | null;
  recibo_url: string | null;
  periodo_ate: string | null;
}

/** Sem a migration ou com erro de rede o sistema NÃO bloqueia: trata como
 *  cobrança desligada (o backend faz o mesmo — fail-open). */
export const STATUS_DESLIGADA: StatusAssinatura = {
  estado: "desligada", ativa: false, pago_ate: null, bloqueia_em: null,
  dias_restantes: null, valor_centavos: 0, periodo_dias: 30, carencia_dias: 0, aviso_dias: 0,
};

export async function buscarStatusAssinatura(): Promise<StatusAssinatura> {
  const { data, error } = await supabase.rpc("app_assinatura_status" as never);
  if (error) {
    console.warn("[assinatura] status indisponível, seguindo liberado:", error.message);
    return STATUS_DESLIGADA;
  }
  const lista: unknown[] = Array.isArray(data) ? data : [];
  const row = lista[0];
  return row ? (row as StatusAssinatura) : STATUS_DESLIGADA;
}

export async function buscarPagamentosAssinatura(): Promise<PagamentoAssinatura[]> {
  const { data, error } = await supabase.rpc("app_assinatura_pagamentos" as never);
  if (error) return [];
  return (Array.isArray(data) ? data : []) as PagamentoAssinatura[];
}

async function postBackend<T>(path: string, body: unknown): Promise<T> {
  const base = await getBackendUrl();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `Erro ${res.status}`);
  return data as T;
}

/** Gera (ou reaproveita) o link de pagamento InfinitePay do mês. */
export function criarCheckout(usuario: string) {
  return postBackend<{ url: string; order_nsu: string; reaproveitado: boolean }>(
    "/billing/checkout", { usuario });
}

/** Parâmetros que a InfinitePay põe na URL ao voltar do pagamento. */
export function lerRetornoPagamento(search: string) {
  const q = new URLSearchParams(search);
  const order_nsu = q.get("order_nsu") || "";
  if (!order_nsu) return null;
  return {
    order_nsu,
    transaction_nsu: q.get("transaction_nsu") || "",
    slug: q.get("slug") || "",
    receipt_url: q.get("receipt_url") || "",
  };
}

export function confirmarPagamento(ret: NonNullable<ReturnType<typeof lerRetornoPagamento>>) {
  return postBackend<{ resultado: string; status: StatusAssinatura }>("/billing/confirmar", ret);
}

/** Rotas que continuam abertas com a assinatura bloqueada (pagar, sair). */
export const ROTAS_LIVRES_NO_BLOQUEIO = ["/assinatura"];

export function precisaBloquear(status: StatusAssinatura, pathname: string): boolean {
  return status.estado === "bloqueada" && !ROTAS_LIVRES_NO_BLOQUEIO.includes(pathname);
}

export const formatarReais = (centavos: number) =>
  (Number(centavos || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const formatarData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
