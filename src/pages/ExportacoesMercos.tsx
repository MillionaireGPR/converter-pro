import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { useFornecedores } from "@/context/FornecedoresContext";
import { useProdutos } from "@/context/ProdutosContext";
import { Download, CheckCircle, AlertTriangle, XCircle, Package, FileWarning, Search, Filter, ArrowUpDown, ArrowUp, ArrowDown, Lock } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ProdutoNormalizadoV2, MERCOS_EXPORT_COLUMNS } from "@/core/types/productPipeline";
import { batchNormalizeToMercos } from "@/core/mercos/normalizeToMercos";
import { generateMercosXLSX, generateErrorReport } from "@/core/mercos/exportMercos";

export default function ExportacoesMercos() {
  const { exportacoesMercos, exportarMercos } = useApp();
  const { fornecedores } = useFornecedores();
  const { produtosPadronizados } = useProdutos();
  const navigate = useNavigate();
  const [precoMode, setPrecoMode] = useState<'tabela' | 'desconto'>('desconto');
  
  // Filtros de coluna para identificar dados faltantes
  const [busca, setBusca] = useState("");
  const [filtroFornecedor, setFiltroFornecedor] = useState("todos");
  const [filtroCampoFaltando, setFiltroCampoFaltando] = useState<"todos" | "codigo" | "nome" | "preco" | "ipi" | "descricao">("todos");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "validado" | "erro" | "pendente">("todos");
  
  // Estados para ordenação
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Filtra produtos baseado nos filtros selecionados
  const produtosFiltrados = useMemo(() => {
    return produtosPadronizados.filter(p => {
      const q = busca.toLowerCase().trim();
      const matchBusca = !q || 
                         (p.codigoFinal || p.codigoOriginal || '').toLowerCase().includes(q) || 
                         (p.nome || '').toLowerCase().includes(q) ||
                         (p.fornecedor || '').toLowerCase().includes(q);
      
      let matchFornecedor = true;
      if (filtroFornecedor !== 'todos') {
        matchFornecedor = (p.fornecedor || '').toLowerCase() === filtroFornecedor.toLowerCase() || 
                          p.fornecedorId === filtroFornecedor;
      }
      
      // Filtro por campo faltando
      let matchCampoFaltando = true;
      if (filtroCampoFaltando !== 'todos') {
        switch (filtroCampoFaltando) {
          case 'codigo':
            matchCampoFaltando = !p.codigoFinal && !p.codigoOriginal;
            break;
          case 'nome':
            matchCampoFaltando = !p.nome || p.nome.trim() === '';
            break;
          case 'preco':
            matchCampoFaltando = !p.precoFinal || p.precoFinal <= 0;
            break;
          case 'ipi':
            matchCampoFaltando = p.ipi === undefined || p.ipi === null;
            break;
          case 'descricao':
            matchCampoFaltando = !p.descricao || p.descricao.trim() === '';
            break;
        }
      }
      
      // Filtro por status
      const matchStatus = filtroStatus === 'todos' || 
                          (filtroStatus === 'validado' && p.status === 'validado') ||
                          (filtroStatus === 'erro' && (p.status === 'erro' || p.status === 'incompleto')) ||
                          (filtroStatus === 'pendente' && p.status === 'pendente');
      
      return matchBusca && matchFornecedor && matchCampoFaltando && matchStatus;
    }).sort((a, b) => {
      if (!sortField) return 0;
      
      let valA: any, valB: any;
      
      switch (sortField) {
        case 'codigo':
          valA = a.codigoFinal || a.codigoOriginal || '';
          valB = b.codigoFinal || b.codigoOriginal || '';
          break;
        case 'nome':
          valA = a.nome || '';
          valB = b.nome || '';
          break;
        case 'fornecedor':
          valA = a.fornecedor || '';
          valB = b.fornecedor || '';
          break;
        case 'preco':
          valA = precoMode === 'tabela' ? (a.precoBase || 0) : (a.precoFinal || 0);
          valB = precoMode === 'tabela' ? (b.precoBase || 0) : (b.precoFinal || 0);
          break;
        case 'ipi':
          valA = a.ipi || 0;
          valB = b.ipi || 0;
          break;
        case 'status':
          valA = a.status || '';
          valB = b.status || '';
          break;
        default:
          return 0;
      }
      
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }
      
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [produtosPadronizados, busca, filtroFornecedor, filtroCampoFaltando, filtroStatus, sortField, sortDirection, precoMode]);

  const displayProducts = produtosFiltrados;

  // Converte Produto (contexto) → ProdutoNormalizadoV2 para o pipeline Mercos
  const produtosV2: ProdutoNormalizadoV2[] = useMemo(() => {
    return displayProducts.map(p => ({
      fornecedor: p.fornecedor,
      fornecedorId: p.fornecedorId,
      codigo: p.codigoFinal || p.codigoOriginal,
      codigoOriginal: p.codigoOriginal,
      nome: p.nome,
      descricaoComplementar: p.descricao,
      categoria: p.categoria,
      precoBase: p.precoBase,
      precoFinal: precoMode === 'tabela' ? p.precoBase : p.precoFinal,
      ipi: p.ipi,
      unidade: p.unidade || 'UN',
      quantidadeCaixa: p.qtdCaixa || 1,
      embalagem: p.embalagem,
      status: (p.status === 'incompleto' ? 'pendente' : p.status) as 'validado' | 'pendente' | 'erro',
      erros: p.erros || [],
      warnings: [],
    }));
  }, [displayProducts, precoMode]);

  // Gera os produtos Mercos usando o pipeline de normalização
  const mercosResult = useMemo(() => {
    return batchNormalizeToMercos(produtosV2, { incluirInvalidos: false });
  }, [produtosV2]);

  const validProducts = displayProducts.filter(p => p.status !== 'erro' && (p.codigoFinal || p.codigoOriginal) && (precoMode === 'tabela' ? p.precoBase > 0 : p.precoFinal > 0));

  const handleGerarPlanilha = async () => {
    if (mercosResult.validos.length === 0) {
      toast.error("Nenhum produto válido para exportar. Corrija os erros na Base Padronizada.");
      return;
    }

    try {
      console.log(`[Mercos Export] Gerando planilha: ${mercosResult.validos.length} produtos válidos`);
      
      // Gera XLSX usando o schema fixo Mercos (download automático)
      const { fileName, validationErrors } = generateMercosXLSX(mercosResult.validos, { download: true });

      if (validationErrors.length > 0) {
        console.warn('[Mercos Export] Erros de validação:', validationErrors);
        toast.warning(`Planilha gerada com ${validationErrors.length} aviso(s) de validação.`);
      }

      // Registra no contexto e no Supabase
      await exportarMercos(validProducts);
      
      toast.success(`Planilha "${fileName}" gerada com sucesso! (${mercosResult.validos.length} produtos)`);
    } catch (error) {
      console.error(error);
      toast.error("Erro ao gerar planilha XLSX.");
    }
  };

  const handleExportarErros = () => {
    if (mercosResult.invalidos.length === 0) {
      toast.info("Nenhum produto inválido para reportar.");
      return;
    }
    const issues = mercosResult.invalidos.map(p => ({
      tipo: p.erros.length > 0 ? p.erros[0] : 'campo-vazio',
      mensagem: p.erros.join('; ') || 'Produto sem campos obrigatórios',
      sugestao: 'Verifique se os campos "Código", "Descrição" e "Preço" estão presentes e são consistentes no arquivo original.',
      linha: p.linhaOrigem,
      produto: p.codigo || p.codigoOriginal || '-',
    }));
    generateErrorReport(issues);
    toast.success(`Relatório de erros exportado (${issues.length} itens)`);
  };

  // Função para alternar ordenação
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Componente para header ordenável
  const SortableHeader = ({ field, children, className }: { field: string; children: React.ReactNode; className?: string }) => {
    const isActive = sortField === field;
    return (
      <TableHead 
        className={cn("cursor-pointer hover:bg-muted/50 transition-colors select-none", className)} 
        onClick={() => handleSort(field)}
      >
        <div className="flex items-center gap-1">
          {children}
          {isActive ? (
            sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/40" />
          )}
        </div>
      </TableHead>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exportações Mercos</h1>
          <p className="text-sm text-muted-foreground">Gere arquivos no formato de importação do Mercos</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={precoMode} onValueChange={(v: any) => setPrecoMode(v)}>
            <SelectTrigger className="w-[180px] h-9 bg-card">
              <SelectValue placeholder="Modo de Preço" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desconto">Preço com Desconto</SelectItem>
              <SelectItem value="tabela">Preço Base (Tabela)</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="text-xs h-9">{exportacoesMercos.length} exportação(ões) realizadas</Badge>
          <Button size="sm" className="gradient-primary text-primary-foreground h-9" onClick={handleGerarPlanilha}>
            <Download className="h-4 w-4 mr-1" /> Gerar Planilha Mercos
          </Button>
        </div>
      </div>

      {/* Filtros - SEMPRE visíveis */}
      <Card className="shadow-card">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Buscar por código ou nome..." 
                className="pl-9 bg-card" 
                value={busca} 
                onChange={e => setBusca(e.target.value)} 
              />
            </div>
            <Select value={filtroFornecedor} onValueChange={setFiltroFornecedor}>
              <SelectTrigger className="w-full sm:w-44 bg-card">
                <SelectValue placeholder="Fornecedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos fornecedores</SelectItem>
                {[...fornecedores].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(f => <SelectItem key={f.id} value={f.nome}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={(v: any) => setFiltroStatus(v)}>
              <SelectTrigger className="w-full sm:w-40 bg-card">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos status</SelectItem>
                <SelectItem value="validado">Validado</SelectItem>
                <SelectItem value="erro">Com Erro</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroCampoFaltando} onValueChange={(v: any) => setFiltroCampoFaltando(v)}>
              <SelectTrigger className="w-full sm:w-52 bg-card">
                <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Dados faltando" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os campos</SelectItem>
                <SelectItem value="codigo">Sem Código</SelectItem>
                <SelectItem value="nome">Sem Nome</SelectItem>
                <SelectItem value="preco">Sem Preço</SelectItem>
                <SelectItem value="ipi">Sem IPI</SelectItem>
                <SelectItem value="descricao">Sem Descrição</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            <span>Exibindo {displayProducts.length} produto(s) filtrado(s) de {produtosPadronizados.length} total</span>
          </div>
        </CardContent>
      </Card>

      {displayProducts.length === 0 ? (
        <Card className="shadow-card">
          <CardContent className="p-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-1">Nenhum produto para exportar</h3>
            <p className="text-sm text-muted-foreground mb-4">Processe produtos na Conversão ou selecione na Base Padronizada.</p>
            <Button variant="outline" onClick={() => navigate('/base')}>Ir para Base Padronizada</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="shadow-card">
            <CardHeader><CardTitle className="text-base">Checklist de Validação</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(() => {
                const semCodigo = displayProducts.filter(p => !p.codigoFinal).length;
                const semPreco = displayProducts.filter(p => !p.precoFinal || p.precoFinal <= 0).length;
                const duplicados = displayProducts.length - new Set(displayProducts.map(p => p.codigoFinal)).size;
                const erros = displayProducts.filter(p => p.status === 'erro').length;
                const preenchidos = displayProducts.filter(p => p.codigoFinal && p.nome && p.precoFinal > 0).length;
                const checkItems = [
                  { label: "Campos obrigatórios preenchidos", ok: preenchidos === displayProducts.length, count: `${preenchidos}/${displayProducts.length}` },
                  { label: "Produtos sem código", ok: semCodigo === 0, count: `${semCodigo} encontrado(s)` },
                  { label: "Produtos sem preço", ok: semPreco === 0, count: `${semPreco} encontrado(s)` },
                  { label: "Produtos com duplicidade", ok: duplicados === 0, count: `${duplicados} encontrado(s)` },
                  { label: "Erros de formatação", ok: erros === 0, count: `${erros} encontrado(s)` },
                ];
                return checkItems.map((c, i) => (
                  <div key={i} className="flex items-center gap-3">
                    {c.ok ? <CheckCircle className="h-4 w-4 text-success shrink-0" /> : <AlertTriangle className="h-4 w-4 text-warning shrink-0" />}
                    <div className="flex-1">
                      <p className="text-sm">{c.label}</p>
                      <p className="text-xs text-muted-foreground">{c.count}</p>
                    </div>
                  </div>
                ));
              })()}
            </CardContent>
          </Card>

          <Card className="shadow-card lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Preview da Exportação ({mercosResult.validos.length} válidos / {mercosResult.invalidos.length} inválidos)</CardTitle>
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-xs">Schema Mercos</Badge>
                  <Badge variant="outline" className="text-xs">{MERCOS_EXPORT_COLUMNS.length} cols</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {mercosResult.invalidos.length > 0 && (
                <div className="flex items-center justify-between p-3 bg-destructive/5 rounded-lg border border-destructive/10">
                  <div className="flex items-center gap-2">
                    <FileWarning className="h-4 w-4 text-destructive" />
                    <span className="text-sm font-medium text-destructive">{mercosResult.invalidos.length} produtos excluídos (campos obrigatórios ausentes)</span>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={handleExportarErros}>
                    Exportar Erros
                  </Button>
                </div>
              )}
              <div className="overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <SortableHeader field="codigo">Código*</SortableHeader>
                      <SortableHeader field="nome">Produto*</SortableHeader>
                      <TableHead className="text-center w-20">Cat.</TableHead>
                      <SortableHeader field="preco" className="text-right">Preço*</SortableHeader>
                      <SortableHeader field="ipi" className="text-right w-16">IPI</SortableHeader>
                      <TableHead className="w-24">Info</TableHead>
                      <TableHead className="text-center w-16">Blk</TableHead>
                      <SortableHeader field="status" className="w-16">Status</SortableHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mercosResult.validos.slice(0, 50).map((p, idx) => {
                      const produtoOriginal = produtosFiltrados.find(prod => 
                        (prod.codigoFinal || prod.codigoOriginal) === p['Código do produto (recomendado)']
                      );
                      const isBloqueado = produtoOriginal?.bloqueiaDesconto || false;
                      const visualTags = produtoOriginal?.visualTags || [];
                      return (
                        <TableRow key={idx} className={isBloqueado ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''}>
                          <TableCell className="font-mono text-[10px] whitespace-nowrap">{p['Código do produto (recomendado)']}</TableCell>
                          <TableCell className="text-xs max-w-[180px]">
                            <div className="flex items-center gap-1">
                              {visualTags.includes('promocional') && (
                                <span className="shrink-0 px-1 py-0 rounded text-[7px] font-bold bg-red-500 text-white">P</span>
                              )}
                              {visualTags.includes('preco-fixo') && (
                                <span className="shrink-0 px-1 py-0 rounded text-[7px] font-bold bg-blue-500 text-white">F</span>
                              )}
                              {visualTags.includes('novidade') && (
                                <span className="shrink-0 px-1 py-0 rounded text-[7px] font-bold bg-amber-500 text-white">N</span>
                              )}
                              {visualTags.includes('reposicao') && (
                                <span className="shrink-0 px-1 py-0 rounded text-[7px] font-bold bg-emerald-500 text-white">R</span>
                              )}
                              <span className="truncate">{p['Nome do produto (obrigatório)']}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            {visualTags.includes('promocional') && (
                              <span className="px-1 py-0 rounded text-[8px] font-bold bg-red-100 text-red-700">PROMO</span>
                            )}
                            {visualTags.includes('preco-fixo') && (
                              <span className="px-1 py-0 rounded text-[8px] font-bold bg-blue-100 text-blue-700">FIXO</span>
                            )}
                            {visualTags.includes('novidade') && (
                              <span className="px-1 py-0 rounded text-[8px] font-bold bg-amber-100 text-amber-700">NOVO</span>
                            )}
                            {visualTags.includes('reposicao') && (
                              <span className="px-1 py-0 rounded text-[8px] font-bold bg-emerald-100 text-emerald-700">REPOS</span>
                            )}
                            {visualTags.length === 0 && '-'}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">R$ {Number(p['Preço de Tabela (obrigatório)'] || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{p['IPI (opcional - não informar o símbolo %)'] || '-'}</TableCell>
                          <TableCell className="max-w-[100px] truncate" title={p['Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)'] || ''}>{p['Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)'] || '-'}</TableCell>
                          <TableCell className="text-center">
                            {isBloqueado ? (
                              <Lock className="h-3 w-3 mx-auto text-amber-600" />
                            ) : (
                              <span className="text-green-600 text-[10px]">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[9px] bg-success/10 text-success border-success/20 px-1">OK</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {mercosResult.validos.length > 50 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-3">
                          ...e mais {mercosResult.validos.length - 50} produtos
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
