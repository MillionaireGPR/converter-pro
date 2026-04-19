import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, AlertTriangle, XCircle, Loader2, Zap, MinusCircle } from "lucide-react";

const statusConfig: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  validado: { label: "Validado", className: "bg-success/10 text-success border-success/20", icon: CheckCircle2 },
  pendente: { label: "Pendente", className: "bg-warning/10 text-warning border-warning/20", icon: Clock },
  erro: { label: "Erro", className: "bg-destructive/10 text-destructive border-destructive/20", icon: XCircle },
  incompleto: { label: "Incompleto", className: "bg-muted text-muted-foreground border-border", icon: MinusCircle },
  processado: { label: "Processado", className: "bg-success/10 text-success border-success/20", icon: CheckCircle2 },
  processando: { label: "Processando", className: "bg-primary/10 text-primary border-primary/20", icon: Loader2 },
  ativo: { label: "Ativo", className: "bg-success/10 text-success border-success/20", icon: Zap },
  inativo: { label: "Inativo", className: "bg-muted text-muted-foreground border-border", icon: MinusCircle },
  concluído: { label: "Concluído", className: "bg-success/10 text-success border-success/20", icon: CheckCircle2 },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, className: "bg-muted text-muted-foreground", icon: Clock };
  const IconComp = config.icon;
  return (
    <Badge variant="outline" className={cn("text-[11px] font-medium gap-1 px-2 py-0.5", config.className)}>
      <IconComp className={cn("h-3 w-3", status === 'processando' && "animate-spin")} />
      {config.label}
    </Badge>
  );
}
