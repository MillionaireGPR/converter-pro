import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { regrasMapeamento, fornecedores } from "@/data/mockData";
import { ArrowRight, Plus, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

export default function RegrasMapeamento() {
  const [filtro, setFiltro] = useState("todos");
  const regras = filtro === "todos" ? regrasMapeamento : regrasMapeamento.filter(r => r.fornecedor === filtro);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Regras de Mapeamento</h1>
          <p className="text-sm text-muted-foreground">Configure como cada fornecedor mapeia suas colunas</p>
        </div>
        <div className="flex gap-2">
          <Select value={filtro} onValueChange={setFiltro}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {fornecedores.map(f => <SelectItem key={f.id} value={f.nome}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button className="gradient-primary text-primary-foreground"><Plus className="h-4 w-4 mr-1" /> Nova Regra</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {regras.map(r => (
          <Card key={r.id} className="shadow-card hover:shadow-card-hover transition-shadow">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{r.fornecedor}</span>
                <Badge variant="outline" className="text-[10px]">
                  {r.tipo === 'direto' ? 'Direto' : r.tipo === 'formula' ? 'Fórmula' : 'Fixo'}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-accent rounded-lg px-3 py-2 text-sm font-medium text-accent-foreground truncate">{r.colunaOrigem}</div>
                <ArrowRight className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 bg-primary/10 rounded-lg px-3 py-2 text-sm font-medium text-primary truncate">{r.colunaDestino}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
