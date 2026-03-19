import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { produtos } from "@/data/mockData";
import { Download, Eye, CheckCircle, AlertTriangle, XCircle, Copy } from "lucide-react";
import { toast } from "sonner";

const checks = [
  { label: "Campos obrigatórios preenchidos", ok: true, count: "948/1060" },
  { label: "Produtos sem código", ok: false, count: "3 encontrados" },
  { label: "Produtos sem preço", ok: false, count: "7 encontrados" },
  { label: "Produtos com duplicidade", ok: true, count: "0 encontrados" },
  { label: "Erros de formatação", ok: false, count: "2 encontrados" },
];

export default function ExportacoesMercos() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exportações Mercos</h1>
          <p className="text-sm text-muted-foreground">Gere arquivos no formato de importação do Mercos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm"><Eye className="h-4 w-4 mr-1" /> Visualizar Estrutura</Button>
          <Button size="sm" className="gradient-primary text-primary-foreground" onClick={() => toast.success("Planilha Mercos gerada com sucesso!")}>
            <Download className="h-4 w-4 mr-1" /> Gerar Planilha Mercos
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Checklist de Validação</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {checks.map((c, i) => (
              <div key={i} className="flex items-center gap-3">
                {c.ok ? <CheckCircle className="h-4 w-4 text-success shrink-0" /> : <AlertTriangle className="h-4 w-4 text-warning shrink-0" />}
                <div className="flex-1">
                  <p className="text-sm">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.count}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Preview da Exportação</CardTitle>
              <Badge variant="outline" className="text-xs">Formato Mercos v3</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código*</TableHead>
                    <TableHead>Nome do Produto*</TableHead>
                    <TableHead className="text-right">Preço Tabela*</TableHead>
                    <TableHead className="text-right">IPI*</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Categoria</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {produtos.filter(p => p.status !== 'erro').map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.codigoFinal || <span className="text-destructive">VAZIO</span>}</TableCell>
                      <TableCell className="text-sm">{p.nome}</TableCell>
                      <TableCell className="text-right text-sm">R$ {p.precoFinal.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm">{p.ipi}%</TableCell>
                      <TableCell className="text-sm">{p.unidade}</TableCell>
                      <TableCell className="text-xs">{p.categoria}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
