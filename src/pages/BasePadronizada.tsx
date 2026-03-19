import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { produtos, fornecedores } from "@/data/mockData";
import { Search, Download, Tag, Edit, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function BasePadronizada() {
  const [busca, setBusca] = useState("");
  const [filtroFornecedor, setFiltroFornecedor] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const produtosFiltrados = produtos.filter(p => {
    const matchBusca = !busca || p.nome.toLowerCase().includes(busca.toLowerCase()) || p.codigoOriginal.toLowerCase().includes(busca.toLowerCase());
    const matchFornecedor = filtroFornecedor === "todos" || p.fornecedor === filtroFornecedor;
    const matchStatus = filtroStatus === "todos" || p.status === filtroStatus;
    return matchBusca && matchFornecedor && matchStatus;
  });

  const toggleAll = () => {
    if (selecionados.length === produtosFiltrados.length) setSelecionados([]);
    else setSelecionados(produtosFiltrados.map(p => p.id));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Base Padronizada</h1>
          <p className="text-sm text-muted-foreground">{produtos.length} produtos cadastrados</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => toast.success("Desconto aplicado!")} disabled={!selecionados.length}>
            <Tag className="h-4 w-4 mr-1" /> Desconto
          </Button>
          <Button variant="outline" size="sm" onClick={() => toast.success("Marcados como validados!")} disabled={!selecionados.length}>
            <CheckCircle className="h-4 w-4 mr-1" /> Validar
          </Button>
          <Button size="sm" className="gradient-primary text-primary-foreground" onClick={() => toast.success("Exportação iniciada!")}>
            <Download className="h-4 w-4 mr-1" /> Exportar
          </Button>
        </div>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por código ou nome..." className="pl-9" value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            <Select value={filtroFornecedor} onValueChange={setFiltroFornecedor}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {fornecedores.map(f => <SelectItem key={f.id} value={f.nome}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="validado">Validado</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="erro">Erro</SelectItem>
                <SelectItem value="incompleto">Incompleto</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox checked={selecionados.length === produtosFiltrados.length && produtosFiltrados.length > 0} onCheckedChange={toggleAll} /></TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead className="text-right">Preço Base</TableHead>
                  <TableHead className="text-right">Desc %</TableHead>
                  <TableHead className="text-right">Preço Final</TableHead>
                  <TableHead className="text-right">IPI %</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtosFiltrados.map(p => (
                  <TableRow key={p.id}>
                    <TableCell><Checkbox checked={selecionados.includes(p.id)} onCheckedChange={() => setSelecionados(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])} /></TableCell>
                    <TableCell className="font-mono text-xs">{p.codigoFinal || p.codigoOriginal}</TableCell>
                    <TableCell className="text-sm font-medium max-w-[200px] truncate">{p.nome}</TableCell>
                    <TableCell className="text-sm">{p.fornecedor}</TableCell>
                    <TableCell className="text-right text-sm">R$ {p.precoBase.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm text-primary font-medium">{p.desconto}%</TableCell>
                    <TableCell className="text-right text-sm font-semibold">R$ {p.precoFinal.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm">{p.ipi}%</TableCell>
                    <TableCell className="text-xs">{p.categoria}</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell><Button variant="ghost" size="icon" className="h-7 w-7"><Edit className="h-3.5 w-3.5" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between pt-4 text-sm text-muted-foreground">
            <span>{selecionados.length} selecionado(s) de {produtosFiltrados.length}</span>
            <span>Página 1 de 1</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
