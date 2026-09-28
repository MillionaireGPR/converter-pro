import { useQuery } from "@tanstack/react-query";
import { buscarStatusAssinatura, STATUS_DESLIGADA } from "@/core/billing/assinatura";

export const ASSINATURA_QUERY_KEY = ["assinatura-status"];

/** Estado da assinatura, relido a cada 5 min e ao voltar pra aba. */
export function useAssinatura() {
  const q = useQuery({
    queryKey: ASSINATURA_QUERY_KEY,
    queryFn: buscarStatusAssinatura,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });
  return { status: q.data ?? STATUS_DESLIGADA, carregando: q.isLoading, recarregar: q.refetch };
}
