import { Link } from "react-router-dom";
import { AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusAssinatura, formatarData } from "@/core/billing/assinatura";

/**
 * Faixa no topo quando a assinatura vence em breve ou já venceu (carência).
 * Não aparece com a cobrança desligada nem em dia.
 */
export function AssinaturaFaixa({ status }: { status: StatusAssinatura }) {
  if (status.estado !== "vencendo" && status.estado !== "carencia") return null;
  const vencida = status.estado === "carencia";
  const dias = status.dias_restantes ?? 0;
  const texto = vencida
    ? `Assinatura vencida em ${formatarData(status.pago_ate)}. As conversões param em ${formatarData(status.bloqueia_em)}.`
    : `Sua assinatura vence em ${dias} dia${dias === 1 ? "" : "s"} (${formatarData(status.pago_ate)}).`;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-2 text-sm border-b ${
        vencida ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900"
      }`}
    >
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{texto}</span>
      <Button asChild size="sm" variant={vencida ? "destructive" : "outline"}>
        <Link to="/assinatura">Renovar agora</Link>
      </Button>
    </div>
  );
}

/** Tela no lugar do conteúdo quando a assinatura está bloqueada. */
export function AssinaturaBloqueio({ status }: { status: StatusAssinatura }) {
  return (
    <div className="max-w-lg mx-auto mt-16 text-center space-y-4">
      <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
        <Lock className="h-7 w-7 text-destructive" />
      </div>
      <h1 className="text-2xl font-bold">Assinatura vencida</h1>
      <p className="text-muted-foreground">
        {status.pago_ate
          ? `O acesso venceu em ${formatarData(status.pago_ate)}.`
          : "A assinatura ainda não foi ativada."}{" "}
        Seus fornecedores, histórico e base continuam salvos — é só renovar para voltar a converter.
      </p>
      <Button asChild size="lg"><Link to="/assinatura">Renovar assinatura</Link></Button>
    </div>
  );
}
