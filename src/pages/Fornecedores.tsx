import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { fornecedores } from "@/data/mockData";
import { Building2, Edit, Package, Calendar } from "lucide-react";

export default function Fornecedores() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fornecedores</h1>
          <p className="text-sm text-muted-foreground">{fornecedores.length} fornecedores cadastrados</p>
        </div>
        <Button className="gradient-primary text-primary-foreground">+ Novo Fornecedor</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fornecedores.map(f => (
          <Card key={f.id} className="shadow-card hover:shadow-card-hover transition-shadow">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{f.nome}</h3>
                    <p className="text-xs text-muted-foreground">{f.tipoArquivo} • {f.frequencia}</p>
                  </div>
                </div>
                <StatusBadge status={f.status} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-1.5 text-muted-foreground"><Package className="h-3.5 w-3.5" /> {f.totalProdutos} produtos</div>
                <div className="flex items-center gap-1.5 text-muted-foreground"><Calendar className="h-3.5 w-3.5" /> {f.ultimoProcessamento}</div>
                <div className="text-muted-foreground">Desc: <span className="text-foreground font-medium">{f.descontoPadrao}%</span></div>
                <div className="text-muted-foreground">IPI: <span className="text-foreground font-medium">{f.ipiPadrao}%</span></div>
              </div>
              <Button variant="outline" size="sm" className="w-full"><Edit className="h-3.5 w-3.5 mr-1" /> Editar Regras</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
