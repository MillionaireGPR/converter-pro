import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  validado: { label: "Validado", className: "bg-success/10 text-success border-success/20" },
  pendente: { label: "Pendente", className: "bg-warning/10 text-warning border-warning/20" },
  erro: { label: "Erro", className: "bg-destructive/10 text-destructive border-destructive/20" },
  incompleto: { label: "Incompleto", className: "bg-muted text-muted-foreground border-muted" },
  processado: { label: "Processado", className: "bg-success/10 text-success border-success/20" },
  processando: { label: "Processando", className: "bg-primary/10 text-primary border-primary/20" },
  ativo: { label: "Ativo", className: "bg-success/10 text-success border-success/20" },
  inativo: { label: "Inativo", className: "bg-muted text-muted-foreground border-muted" },
  concluído: { label: "Concluído", className: "bg-success/10 text-success border-success/20" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <Badge variant="outline" className={cn("text-[11px] font-medium", config.className)}>
      {config.label}
    </Badge>
  );
}
