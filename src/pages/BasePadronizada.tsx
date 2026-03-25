import { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { useApp } from "@/context/AppContext";
import { Search, Download, Tag, CheckCircle, Package, AlertTriangle, FileSpreadsheet, BookOpen, AlertCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function BasePadronizada() {
  const { produtosPadronizados, fornecedores, updateProduto, validarProdutos, aplicarDesconto, exportarMercos, limparBase } = useApp();
  const navigate = useNavigate();
  const [busca, setBusca] = useState("");
  const [filtroFornecedor, setFiltroFornecedor] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroCategoria, setFiltroCategoria] = useState("todos");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editField, setEditField] = useState<string>("");
  const [editValue, setEditValue] = useState<string>("");
  const [descontoDialog, setDescontoDialog] = useState(false);
  const [descontoVal, setDescontoVal] = useState("15");
  const [limparDialog, setLimparDialog] = useState(false);
  const [fornecedorLimpar, setFornecedorLimpar] = useState("todos");

  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 50;

  const categorias = useMemo(() => [...new Set(produtosPadronizados.map(p => p.categoria || "Sem Categoria"))].sort(), [produtosPadronizados]);

  const produtosFiltrados = useMemo(() => {
    return produtosPadronizados.filter(p => {
      const searchLower = busca.toLowerCase();
      const codigoOri = (p.codigoOriginal || "").toLowerCase();
      const codigoFin = (p.codigoFinal || "").toLowerCase();
      const nomeLower = (p.nome || "").toLowerCase();
      
      const matchBusca = !busca || 
        nomeLower.includes(searchLower) || 
        codigoOri.includes(searchLower) || 
        codigoFin.includes(searchLower);

      const matchFornecedor = filtroFornecedor === "todos" || p.fornecedor === filtroFornecedor;
      const matchStatus = filtroStatus === "todos" || p.status === filtroStatus;
      const prodCat = p.categoria || "Sem Categoria";
      const matchCategoria = filtroCategoria === "todos" || prodCat === filtroCategoria;
      return matchBusca && matchFornecedor && matchStatus && matchCategoria;
    });
  }, [produtosPadronizados, busca, filtroFornecedor, filtroStatus, filtroCategoria]);

  useEffect(() => {
    setPaginaAtual(1);
  }, [busca, filtroFornecedor, filtroStatus, filtroCategoria]);

  const totalPaginas = Math.ceil(produtosFiltrados.length / itensPorPagina);
  const produtosPaginados = produtosFiltrados.slice((paginaAtual - 1) * itensPorPagina, paginaAtual * itensPorPagina);

  const toggleAll = () => {
    if (selecionados.length === produtosFiltrados.length) setSelecionados([]);
    else setSelecionados(produtosFiltrados.map(p => p.id));
  };

  const stats = {
    total: produtosPadronizados.length,
    validados: produtosPadronizados.filter(p => p.status === 'validado').length,
    pendentes: produtosPadronizados.filter(p => p.status === 'pendente').length,
    erros: produtosPadronizados.filter(p => p.status === 'erro' || p.status === 'incompleto').length,
  };

  const handleValidar = async () => {
    if (!selecionados.length) return;
    try {
      console.log(`[Flow MVP] Iniciando validação em lote para ${selecionados.length} itens.`);
      await validarProdutos(selecionados);
      console.log(`[Flow MVP] Validação concluída. Tela Base Padronizada atualizada.`);
      toast.success(`${selecionados.length} produto(s) validados com sucesso!`);
      setSelecionados([]);
    } catch (err) {
      toast.error("Erro ao validar produtos no banco.");
    }
  };

  const handleDesconto = () => {
    if (!selecionados.length) return;
    setDescontoDialog(true);
  };

  const applyDesconto = async () => {
    try {
      console.log(`[Flow MVP] Acionando aplicarDesconto na Base Padronizada: ${descontoVal}% em ${selecionados.length} itens.`);
      await aplicarDesconto(selecionados, parseFloat(descontoVal) || 0);
      toast.success(`Desconto de ${descontoVal}% aplicado a ${selecionados.length} produto(s)!`);
      setDescontoDialog(false);
      setSelecionados([]);
    } catch (err) {
      toast.error("Erro ao aplicar desconto no banco.");
    }
  };

  const handleExportar = () => {
    if (!selecionados.length) {
      toast.error("Selecione produtos para exportar");
      return;
    }
    const prodsToExport = produtosPadronizados.filter(p => selecionados.includes(p.id));
    exportarMercos(prodsToExport);
    toast.success(`${prodsToExport.length} produto(s) enviados para Exportações Mercos!`);
    setSelecionados([]);
    navigate('/exportacoes');
  };

  const handleLimparBase = async () => {
    await limparBase(fornecedorLimpar === "todos" ? undefined : fornecedorLimpar);
    setLimparDialog(false);
  };

  const startEdit = (id: string, field: string, value: string) => {
    setEditId(id);
    setEditField(field);
    setEditValue(value);
  };

  const commitEdit = async () => {
    if (!editId) return;
    try {
      const updates: Record<string, any> = {};
      if (editField === 'precoBase' || editField === 'ipi' || editField === 'desconto') {
        updates[editField] = parseFloat(editValue) || 0;
      } else {
        updates[editField] = editValue;
      }
      console.log(`[Flow MVP] Confirmando edição inline na Base: item ${editId}, campo ${editField} -> ${editValue}`);
      await updateProduto(editId, updates);
      setEditId(null);
    } catch (err) {
      toast.error("Erro ao salvar edição.");
    }
  };

  const renderEditableCell = (prodId: string, field: string, value: string, className?: string) => {
    if (editId === prodId && editField === field) {
      return (
        <Input
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => e.key === 'Enter' && commitEdit()}
          className="h-7 text-xs w-full"
          autoFocus
        />
      );
    }
    return (
      <span className={cn("cursor-pointer hover:bg-primary/5 px-1 py-0.5 rounded", className)} onDoubleClick={() => startEdit(prodId, field, value)}>
        {value}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Base Padronizada</h1>
          <p className="text-sm text-muted-foreground mt-1">Centro operacional de produtos — edite, valide e exporte (duplo-clique para editar)</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Button variant="outline" size="sm" onClick={() => setLimparDialog(true)} className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20 transition-colors">
            <Trash2 className="h-3.5 w-3.5" /> Limpar Base
          </Button>
          <div className="h-6 w-px bg-border mx-1 hidden sm:block"></div>
          <Button variant="outline" size="sm" onClick={handleDesconto} disabled={!selecionados.length} className="gap-1.5">
            <Tag className="h-3.5 w-3.5" /> Desconto
          </Button>
          <Button variant="outline" size="sm" onClick={handleValidar} disabled={!selecionados.length} className="gap-1.5">
            <CheckCircle className="h-3.5 w-3.5" /> Validar
          </Button>
          <Button size="sm" className="gradient-success text-primary-foreground font-semibold shadow-sm gap-1.5" onClick={handleExportar} disabled={!selecionados.length}>
            <Download className="h-3.5 w-3.5" /> Exportar Mercos
          </Button>
        </div>
      </div>

      {produtosPadronizados.length === 0 ? (
        <Card className="shadow-card">
          <CardContent className="p-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-1">Nenhum produto na base</h3>
            <p className="text-sm text-muted-foreground mb-4">Processe um arquivo na tela de Conversão de Produtos para começar.</p>
            <Button variant="outline" onClick={() => navigate('/conversao')}>Ir para Conversão</Button>
          </CardContent>
        </Card>
      ) : (
        <>
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
                <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
                  <SelectTrigger className="w-full sm:w-44 bg-card"><SelectValue placeholder="Categoria" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todas categorias</SelectItem>
                    {categorias.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {produtosPaginados.map(p => (
                      <TableRow key={p.id} className={cn("group", selecionados.includes(p.id) && "bg-primary/[0.03]")}>
                        <TableCell className="pl-5">
                          <Checkbox checked={selecionados.includes(p.id)} onCheckedChange={() => setSelecionados(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {renderEditableCell(p.id, 'codigoFinal', p.codigoFinal || p.codigoOriginal, "text-primary/80 font-medium")}
                        </TableCell>
                        <TableCell className="text-sm font-medium max-w-[220px]">
                          {renderEditableCell(p.id, 'nome', p.nome)}
                          <span className="text-[10px] text-muted-foreground block">{p.descricao.substring(0, 40)}...</span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.fornecedor}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {renderEditableCell(p.id, 'precoBase', p.precoBase.toFixed(2))}
                        </TableCell>
                        <TableCell className="text-right text-sm text-primary font-semibold tabular-nums">{p.descontoPercentual}%</TableCell>
                        <TableCell className="text-right text-sm font-bold tabular-nums">R$ {p.precoFinal.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                          {renderEditableCell(p.id, 'ipi', String(p.ipi))}
                        </TableCell>
                        <TableCell>
                          {renderEditableCell(p.id, 'categoria', p.categoria, "text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground")}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={p.status} />
                            {p.erros.length > 0 && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertCircle className="h-4 w-4 text-destructive cursor-help" />
                                  </TooltipTrigger>
                                  <TooltipContent className="bg-destructive text-destructive-foreground border-none">
                                    <ul className="text-xs list-disc pl-3">
                                      {p.erros.map((err, i) => <li key={i}>{err}</li>)}
                                    </ul>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
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
                {totalPaginas > 1 && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPaginaAtual(p => Math.max(1, p - 1))} disabled={paginaAtual === 1}>Anterior</Button>
                    <span className="text-xs font-medium px-2">Pág {paginaAtual} de {totalPaginas}</span>
                    <Button variant="outline" size="sm" onClick={() => setPaginaAtual(p => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}>Próxima</Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={descontoDialog} onOpenChange={setDescontoDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aplicar Desconto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <p className="text-sm text-muted-foreground">Aplicar desconto a <span className="font-semibold text-foreground">{selecionados.length}</span> produto(s) selecionado(s).</p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Percentual de Desconto</label>
              <div className="relative">
                <Input type="number" value={descontoVal} onChange={e => setDescontoVal(e.target.value)} className="pr-8" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDescontoDialog(false)}>Cancelar</Button>
            <Button className="gradient-primary text-primary-foreground" onClick={applyDesconto}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={limparDialog} onOpenChange={setLimparDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2"><Trash2 className="h-5 w-5"/> Limpar Base de Produtos</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <p className="text-sm text-foreground">Esta ação removerá os produtos da base padronizada e do banco de dados.</p>
            <p className="text-xs text-muted-foreground bg-muted p-2 rounded-md">O histórico de arquivos processados não será apagado, apenas os produtos convertidos.</p>
            
            <div className="space-y-1.5 mt-4 pt-2 border-t">
              <label className="text-sm font-medium">O que você deseja limpar?</label>
              <Select value={fornecedorLimpar} onValueChange={setFornecedorLimpar}>
                <SelectTrigger className="w-full bg-card"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="font-semibold text-destructive">Toda a Base (Todos os fornecedores)</SelectItem>
                  {fornecedores.map(f => <SelectItem key={f.id} value={f.nome}>Apenas produtos da {f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLimparDialog(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleLimparBase}>Sim, Limpar Agora</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
