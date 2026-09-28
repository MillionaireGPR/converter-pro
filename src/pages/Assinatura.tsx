import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, CheckCircle2, AlertTriangle, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { useAssinatura, ASSINATURA_QUERY_KEY } from "@/hooks/useAssinatura";
import {
  buscarPagamentosAssinatura, confirmarPagamento, criarCheckout, formatarData,
  formatarReais, lerRetornoPagamento, EstadoAssinatura,
} from "@/core/billing/assinatura";

const ROTULO: Record<EstadoAssinatura, { texto: string; cor: string }> = {
  desligada: { texto: "Cobrança não ativada", cor: "text-muted-foreground" },
  ativa: { texto: "Em dia", cor: "text-emerald-600" },
  vencendo: { texto: "Vence em breve", cor: "text-amber-600" },
  carencia: { texto: "Vencida (em carência)", cor: "text-destructive" },
  bloqueada: { texto: "Vencida — conversões pausadas", cor: "text-destructive" },
};

export default function Assinatura() {
  const { usuario } = useAuth();
  const { status, carregando } = useAssinatura();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [gerando, setGerando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const retornoTratado = useRef(false);

  const pagamentos = useQuery({ queryKey: ["assinatura-pagamentos"], queryFn: buscarPagamentosAssinatura });

  // Volta da InfinitePay: reconfere o pagamento (cobre webhook atrasado).
  useEffect(() => {
    const ret = lerRetornoPagamento(location.search);
    if (!ret || retornoTratado.current) return;
    retornoTratado.current = true;
    setConfirmando(true);
    confirmarPagamento(ret)
      .then(({ resultado }) => {
        if (resultado === "OK" || resultado === "JA_PAGO") toast.success("Pagamento confirmado! Assinatura renovada.");
        else if (resultado === "NAO_PAGO") toast.info("Pagamento ainda em processamento. Assim que a InfinitePay confirmar, o acesso é renovado sozinho.");
        else toast.error("Não encontramos esse pagamento. Se foi cobrado, fale com o suporte.");
      })
      .catch((e) => toast.error(`Não foi possível confirmar agora: ${e.message}`))
      .finally(() => {
        setConfirmando(false);
        queryClient.invalidateQueries({ queryKey: ASSINATURA_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ["assinatura-pagamentos"] });
        navigate("/assinatura", { replace: true });
      });
  }, [location.search, navigate, queryClient]);

  const pagar = async () => {
    setGerando(true);
    try {
      const { url } = await criarCheckout(usuario || "");
      window.location.assign(url);
    } catch (e) {
      toast.error((e as Error).message);
      setGerando(false);
    }
  };

  const rot = ROTULO[status.estado];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Assinatura</h1>
        <p className="text-muted-foreground text-sm">Central de Conversão — plano mensal</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Situação</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {carregando || confirmando ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />{confirmando ? "Confirmando pagamento..." : "Carregando..."}
            </p>
          ) : (
            <>
              <p className={`text-lg font-semibold flex items-center gap-2 ${rot.cor}`}>
                {status.estado === "ativa" ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                {rot.texto}
              </p>
              <div className="grid sm:grid-cols-3 gap-3 text-sm">
                <div><div className="text-muted-foreground">Valor</div><div className="font-medium">{formatarReais(status.valor_centavos)} / {status.periodo_dias} dias</div></div>
                <div><div className="text-muted-foreground">Pago até</div><div className="font-medium">{formatarData(status.pago_ate)}</div></div>
                <div><div className="text-muted-foreground">Pausa as conversões em</div><div className="font-medium">{formatarData(status.bloqueia_em)}</div></div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={pagar} disabled={gerando} size="lg">
                  {gerando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {status.estado === "ativa" ? "Pagar próximo mês antecipado" : "Pagar com PIX ou cartão"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Pagamento pela InfinitePay. O período soma a partir do vencimento atual — pagar antes não perde dias.
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" /> Pagamentos</CardTitle></CardHeader>
        <CardContent>
          {(pagamentos.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pagamento registrado ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Data</TableHead><TableHead>Valor</TableHead><TableHead>Forma</TableHead><TableHead>Libera até</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {(pagamentos.data ?? []).map((p, i) => (
                  <TableRow key={i}>
                    <TableCell>{formatarData(p.pago_em || p.criado_em)}</TableCell>
                    <TableCell>{p.status === "manual" ? "Liberação manual" : formatarReais(p.valor_centavos)}</TableCell>
                    <TableCell className="uppercase text-xs">{p.metodo === "credit_card" ? "cartão" : p.metodo || "—"}</TableCell>
                    <TableCell>{formatarData(p.periodo_ate)}</TableCell>
                    <TableCell>{p.recibo_url ? <a className="text-primary underline text-sm" href={p.recibo_url} target="_blank" rel="noopener noreferrer">Recibo</a> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
