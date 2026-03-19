import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { produtos, fornecedores } from "@/data/mockData";
import { Search, Download, Tag, Edit, CheckCircle, Package, AlertTriangle, FileSpreadsheet, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

  const stats = {
    total: produtos.length,
    validados: produtos.filter(p => p.status === 'validado').length,
    pendentes: produtos.filter(p => p.status === 'pendente').length,
    erros: produtos.filter(p => p.status === 'erro' || p.status === 'incompleto').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Base Padronizada</h1>
          <p className="text-sm text-muted-foreground mt-1">Centro operacional de produtos — edite, valide e exporte</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => toast.success("Desconto aplicado!")} disabled={!selecionados.length} className="gap-1.5">
            <Tag className="h-3.5 w-3.5" /> Desconto
          </Button>
          <Button variant="outline" size="sm" onClick={() => toast.success("Marcados como validados!")} disabled={!selecionados.length} className="gap-1.5">
            <CheckCircle className="h-3.5 w-3.5" /> Validar
          </Button>
          <Button variant="outline" size="sm" onClick={() => toast.success("Catálogo gerado!")} disabled={!selecionados.length} className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" /> Catálogo
          </Button>
          <Button size="sm" className="gradient-success text-primary-foreground font-semibold shadow-sm gap-1.5" onClick={() => toast.success("Exportação Mercos iniciada!")}>
            <Download className="h-3.5 w-3.5" /> Exportar Mercos
          </Button>
        </div>
      </div>

      {/* Summary mini-cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex items-center gap-3 bg-card rounded-xl p-3.5 shadow-card border">
          <div className="p-2 rounded-lg bg-primary/10"><Package className="h-4 w-4 text-primary" /></div>
          <div><p className="text-lg font-bold text-foreground">{stats.total}</p><p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total</p></div>
        </div>
        <div className="flex items-center gap-3 bg-card rounded-xl p-3.5 shadow-card border">
          <div className="p-2 rounded-lg bg-success/10"><CheckCircle className="h-4 w-4 text-success" /></div>
          <div><p className="text-lg font-bold text-foreground">{stats.validados}</p><p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Validados</p></div>
        </div>
        <div className="flex items-center gap-3 bg-card rounded-xl p-3.5 shadow-card border">
          <div className="p-2 rounded-lg bg-warning/10"><FileSpreadsheet className="h-4 w-4 text-warning" /></div>
          <div><p className="text-lg font-bold text-foreground">{stats.pendentes}</p><p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Pendentes</p></div>
        </div>
        <div className="flex items-center gap-3 bg-card rounded-xl p-3.5 shadow-card border">
          <div className="p-2 rounded-lg bg-destructive/10"><AlertTriangle className="h-4 w-4 text-destructive" /></div>
          <div><p className="text-lg font-bold text-foreground">{stats.erros}</p><p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Com Erro</p></div>
        </div>
      </div>

      {/* Filters & Table */}
      <Card className="shadow-card overflow-hidden">
        <div className="p-4 sm:p-5 border-b bg-muted/30">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por código ou nome..." className="pl-9 bg-card" value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            <Select value={filtroFornecedor} onValueChange={setFiltroFornecedor}>
              <SelectTrigger className="w-full sm:w-44 bg-card"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos fornecedores</SelectItem>
                {fornecedores.map(f => <SelectItem key={f.id} value={f.nome}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-full sm:w-40 bg-card"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos status</SelectItem>
                <SelectItem value="validado">Validado</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="erro">Erro</SelectItem>
                <SelectItem value="incompleto">Incompleto</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="premium-table">
              <TableHeader>
                <TableRow className="border-b-0">
                  <TableHead className="w-10 pl-5">
                    <Checkbox checked={selecionados.length === produtosFiltrados.length && produtosFiltrados.length > 0} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead className="text-right">Preço Base</TableHead>
                  <TableHead className="text-right">Desc %</TableHead>
                  <TableHead className="text-right">Preço Final</TableHead>
                  <TableHead className="text-right">IPI %</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtosFiltrados.map(p => (
                  <TableRow key={p.id} className={cn("group", selecionados.includes(p.id) && "bg-primary/[0.03]")}>
                    <TableCell className="pl-5">
                      <Checkbox checked={selecionados.includes(p.id)} onCheckedChange={() => setSelecionados(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-primary/80 font-medium">{p.codigoFinal || p.codigoOriginal}</TableCell>
                    <TableCell className="text-sm font-medium max-w-[220px]">
                      <span className="truncate block">{p.nome}</span>
                      <span className="text-[10px] text-muted-foreground">{p.descricao.substring(0, 40)}...</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.fornecedor}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">R$ {p.precoBase.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm text-primary font-semibold tabular-nums">{p.desconto}%</TableCell>
                    <TableCell className="text-right text-sm font-bold tabular-nums">R$ {p.precoFinal.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{p.ipi}%</TableCell>
                    <TableCell>
                      <span className="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground">{p.categoria}</span>
                    </TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell className="pr-5">
                      <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/30 text-sm">
            <span className="text-muted-foreground">
              {selecionados.length > 0 ? (
                <><span className="font-semibold text-primary">{selecionados.length}</span> selecionado(s) de {produtosFiltrados.length}</>
              ) : (
                <>{produtosFiltrados.length} produtos encontrados</>
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled className="text-xs h-7">Anterior</Button>
              <span className="text-xs text-muted-foreground px-2">Página 1 de 1</span>
              <Button variant="outline" size="sm" disabled className="text-xs h-7">Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
