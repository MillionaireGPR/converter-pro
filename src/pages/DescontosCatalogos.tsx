import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApp } from "@/context/AppContext";
import { Eye, FileDown, FileSpreadsheet, Save, Tag, Sparkles, Package, Percent } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import logo from "@/assets/logo-nunes.png";

export default function DescontosCatalogos() {
  const { produtosPadronizados, fornecedores, aplicarDesconto, aplicarIpi, gerarCatalogo, registrarHistorico } = useApp();
  const navigate = useNavigate();
  const [fornecedor, setFornecedor] = useState("");
  const [descontoPrincipal, setDescontoPrincipal] = useState("15");
  const [descontoAdicional, setDescontoAdicional] = useState("");
  const [campanha, setCampanha] = useState("Campanha Verão 2026");
  const [showPreview, setShowPreview] = useState(false);
  const [usarPrecoFinal, setUsarPrecoFinal] = useState(false);
  const [mostrarDesconto, setMostrarDesconto] = useState(true);
  
  // Estado para IPI em massa
  const [novoIpi, setNovoIpi] = useState("");
  
  // Estado para DESCONTO no IPI (percentual de redução)
  const [descontoIpi, setDescontoIpi] = useState("");
  
  // Estado para modo de IPI: 'incluso' = já está no preço, 'somar' = adicionar ao preço
  const [ipiModo, setIpiModo] = useState<'incluso' | 'somar'>('incluso');

  const forn = fornecedores.find(f => f.id === fornecedor);
  const fornNome = forn?.nome;
  
  // Filtra por ID ou por NOME (caso o banco não tenha retornado o ID corretamente)
  const produtosFiltrados = forn 
    ? produtosPadronizados.filter(p => p.fornecedorId === forn.id || p.fornecedor.toLowerCase() === forn.nome.toLowerCase()) 
    : produtosPadronizados;

  const fornecedoresComProdutos = fornecedores.filter(f => 
    produtosPadronizados.some(p => p.fornecedorId === f.id || p.fornecedor.toLowerCase() === f.nome.toLowerCase())
  );

  // Calculadora de desconto composto do formato "30+15+10"
  const d1 = parseFloat(descontoPrincipal) || 0;
  const d2 = parseFloat(descontoAdicional) || 0;
  
  const calcularEquivalente = (p1: number, p2: number) => {
    const mult = (1 - p1 / 100) * (1 - p2 / 100);
    return +((1 - mult) * 100).toFixed(2);
  };

  const descNum = calcularEquivalente(d1, d2);
  const descontoString = d2 > 0 ? `${d1}+${d2}` : `${d1}`;
  const valido = d1 >= 0 && d1 <= 100 && d2 >= 0 && d2 <= 100;

  // IPI
  const ipiNumero = parseFloat(novoIpi);
  const ipiValido = novoIpi !== "" && !isNaN(ipiNumero) && ipiNumero >= 0 && ipiNumero <= 100;
  
  // Desconto no IPI
  const descontoIpiNum = parseFloat(descontoIpi) || 0;
  const descontoIpiValido = descontoIpi !== "" && !isNaN(descontoIpiNum) && descontoIpiNum > 0 && descontoIpiNum <= 100;

  const handleSalvar = async () => {
    if (!valido) { toast.error("Por favor, informe descontos válidos entre 0 e 100."); return; }
    if (!produtosFiltrados.length) { toast.error("Sem produtos para aplicar desconto"); return; }
    try {
      const ids = produtosFiltrados.map(p => p.id);
      console.log(`[Flow MVP] Enviando desconto composto:`, { d1, d2, equivalente: descNum });
      await aplicarDesconto(ids, descNum, campanha, fornNome, descontoString);
      toast.success(`Desconto de ${descontoString}% salvo para ${ids.length} produto(s)!`);
    } catch (err) {
      toast.error("Erro ao salvar descontos no banco.");
    }
  };

  const handleSalvarIpi = async () => {
    if (!ipiValido) { toast.error("Informe um IPI válido entre 0 e 100."); return; }
    if (!produtosFiltrados.length) { toast.error("Selecione um fornecedor com produtos."); return; }
    try {
      const ids = produtosFiltrados.map(p => p.id);
      await aplicarIpi(ids, ipiNumero, fornNome);
      toast.success(`IPI de ${ipiNumero}% aplicado em ${ids.length} produto(s)!`);
    } catch (err) {
      toast.error("Erro ao salvar IPI no banco.");
    }
  };

  const handleAplicarDescontoIpi = async () => {
    if (!descontoIpiValido) { toast.error("Informe um desconto de IPI válido entre 0 e 100."); return; }
    if (!produtosFiltrados.length) { toast.error("Selecione um fornecedor com produtos."); return; }
    try {
      const ids = produtosFiltrados.map(p => p.id);
      // Calcula novo IPI para cada produto: IPI atual * (1 - desconto/100)
      const updates = produtosFiltrados.map(p => {
        const ipiAtual = p.ipi || 0;
        const novoIpi = ipiAtual * (1 - descontoIpiNum / 100);
        return { id: p.id, ipi: Math.max(0, +novoIpi.toFixed(2)) };
      });
      
      // Aplica atualização em lote
      await aplicarIpi(ids, 0, fornNome, updates); // Passa 0 como valor único e usa updates
      toast.success(`Desconto de ${descontoIpiNum}% aplicado no IPI de ${ids.length} produto(s)!`);
      console.log('[Flow MVP] Desconto no IPI aplicado:', { descontoIpiNum, updates });
    } catch (err) {
      toast.error("Erro ao aplicar desconto no IPI.");
    }
  };

  const handleGerarPDF = async () => {
    if (!valido) { toast.error("Formato de desconto inválido."); return; }
    if (!produtosFiltrados.length) { toast.error("Sem produtos."); return; }
    try {
      console.log(`[Flow MVP] Gerando PDF com opções:`, { usarPrecoFinal, mostrarDesconto, ipiModo });
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text(`Catálogo Comercial - ${campanha}`, 14, 20);
      doc.setFontSize(10);
      doc.text(`Fornecedor: ${fornNome || 'Todos'} | Itens: ${produtosFiltrados.length}`, 14, 28);
      
      // Construir head dinamicamente baseado nas opções
      let head: string[] = ['Código', 'Produto'];
      
      if (usarPrecoFinal) {
        // Modo preço final apenas: mostra só preço final e IPI se somar
        if (ipiModo === 'somar') {
          head = head.concat(['Preço Final', 'IPI', 'Total c/ IPI', 'Fornecedor']);
        } else {
          head = head.concat(['Preço Final', 'Fornecedor']);
        }
      } else {
        // Modo normal: pode mostrar ou não desconto
        if (mostrarDesconto) {
          head = head.concat(['Preço Original', 'Desconto', 'Preço Final']);
        } else {
          head = head.concat(['Preço']);
        }
        
        // Adicionar IPI se necessário
        if (ipiModo === 'somar') {
          head.push('IPI');
          head.push('Total');
        }
        
        head.push('Fornecedor');
      }
      
      const body = produtosFiltrados.map(p => {
        // Calcular preço base com desconto
        let precoComDesconto = +(p.precoBase * (1 - descNum / 100)).toFixed(2);
        
        // Se usar preço final do produto (já salvo), usa ele
        if (usarPrecoFinal && p.precoFinal) {
          precoComDesconto = p.precoFinal;
        }
        
        // Calcular IPI se modo 'somar'
        const ipiPercentual = p.ipi || 0;
        const valorIPI = ipiModo === 'somar' ? +(precoComDesconto * (ipiPercentual / 100)).toFixed(2) : 0;
        const precoTotal = +(precoComDesconto + valorIPI).toFixed(2);
        
        // Montar linha dinamicamente
        let row: string[] = [
          p.codigoFinal || p.codigoOriginal,
          p.nome.substring(0, 45)
        ];
        
        if (usarPrecoFinal) {
          // Preço final apenas
          if (ipiModo === 'somar') {
            row = row.concat([
              `R$ ${precoComDesconto.toFixed(2)}`,
              `${ipiPercentual}%`,
              `R$ ${precoTotal.toFixed(2)}`,
              p.fornecedor
            ]);
          } else {
            row = row.concat([
              `R$ ${precoComDesconto.toFixed(2)}`,
              p.fornecedor
            ]);
          }
        } else {
          // Modo completo
          if (mostrarDesconto) {
            row = row.concat([
              `R$ ${p.precoBase.toFixed(2)}`,
              `${descontoString}%`,
              `R$ ${precoComDesconto.toFixed(2)}`
            ]);
          } else {
            row = row.concat([
              `R$ ${precoComDesconto.toFixed(2)}`
            ]);
          }
          
          if (ipiModo === 'somar') {
            row.push(`${ipiPercentual}%`);
            row.push(`R$ ${precoTotal.toFixed(2)}`);
          }
          
          row.push(p.fornecedor);
        }
        
        return row;
      });

      autoTable(doc, {
        startY: 35,
        head: [head],
        body: body,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [41, 128, 185] }
      });

      const fileName = `catalogo_${campanha.replace(/\s/g, '_').toLowerCase()}.pdf`;
      doc.save(fileName);

      await registrarHistorico({ arquivo: fileName, fornecedor: fornNome || 'Diversos', usuario: 'Admin', data: new Date().toISOString().replace('T', ' ').substring(0, 16), tipoConversao: 'Catálogo Gerado PDF', qtdItens: produtosFiltrados.length, status: 'concluído' });
      console.log(`[Flow MVP] Arquivo PDF gerado e baixado: ${fileName}`);
      toast.success("Catálogo PDF baixado com sucesso!");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao gerar catálogo em PDF.");
    }
  };

  const handleGerarExcel = async () => {
    if (!valido) { toast.error("Formato de desconto inválido."); return; }
    if (!produtosFiltrados.length) { toast.error("Sem produtos."); return; }
    try {
      console.log(`[Flow MVP] Gerando Excel com XLSX...`);
      const dataToExport = produtosFiltrados.map(p => {
        const pf = usarPrecoFinal ? p.precoFinal : +(p.precoBase * (1 - descNum / 100)).toFixed(2);
        return {
          "Código": p.codigoFinal || p.codigoOriginal,
          "Produto": p.nome,
          "Preço Original": Number(p.precoBase).toFixed(2),
          "Desconto Aplicado": `${descontoString}%`,
          "Preço Final": Number(pf).toFixed(2),
          "IPI": p.ipi || 0,
          "Fornecedor": p.fornecedor
        };
      });

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Catálogo");
      const fileName = `catalogo_descontos_${Date.now()}.xlsx`;
      XLSX.writeFile(wb, fileName);

      await registrarHistorico({ arquivo: fileName, fornecedor: fornNome || 'Diversos', usuario: 'Admin', data: new Date().toISOString().replace('T', ' ').substring(0, 16), tipoConversao: 'Exportação Excel (Descontos)', qtdItens: produtosFiltrados.length, status: 'concluído' });
      console.log(`[Flow MVP] Arquivo Excel gerado e baixado: ${fileName}`);
      toast.success("Catálogo Excel baixado com sucesso!");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao gerar arquivo Excel.");
    }
  };

  if (produtosPadronizados.length === 0) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Descontos e Catálogos</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure descontos, IPI e gere catálogos comerciais</p>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-1">Nenhum produto na base</h3>
            <p className="text-sm text-muted-foreground mb-4">Processe produtos primeiro na Conversão de Produtos.</p>
            <Button variant="outline" onClick={() => navigate('/conversao')}>Ir para Conversão</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Descontos e Catálogos</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure descontos, IPI em massa e gere catálogos comerciais</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ══════════════ PAINEL LATERAL ══════════════ */}
        <div className="lg:col-span-1 space-y-6">
          {/* CARD: Configurar Desconto */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2"><Tag className="h-4 w-4 text-primary" /> Configurar Desconto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Fornecedor</label>
                <Select value={fornecedor} onValueChange={setFornecedor}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{fornecedoresComProdutos.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Principal (%)</label>
                  <div className="relative">
                    <Input type="number" value={descontoPrincipal} onChange={e => setDescontoPrincipal(e.target.value)} className={!valido ? 'border-destructive' : ''} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Adicional (%)</label>
                  <div className="relative">
                    <Input type="number" value={descontoAdicional} onChange={e => setDescontoAdicional(e.target.value)} placeholder="0" />
                  </div>
                </div>
              </div>
              {d2 > 0 && (
                <p className="text-[11px] text-primary font-medium bg-primary/5 px-2 py-1 rounded">
                  Equivalente a {descNum}% de desconto direto
                </p>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nome da Campanha</label>
                <Input value={campanha} onChange={e => setCampanha(e.target.value)} />
              </div>

              <div className="rounded-xl border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <label className="text-sm font-medium">Usar apenas preço final</label>
                    <span className="text-[10px] text-muted-foreground">Oculta preço original e desconto</span>
                  </div>
                  <Switch 
                    checked={usarPrecoFinal} 
                    onCheckedChange={(checked) => {
                      setUsarPrecoFinal(checked);
                      // Se ativar "usar preço final", desativa "mostrar desconto"
                      if (checked) setMostrarDesconto(false);
                    }} 
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <label className="text-sm font-medium">Mostrar desconto</label>
                    <span className="text-[10px] text-muted-foreground">Exibe % de desconto e preço riscado</span>
                  </div>
                  <Switch 
                    checked={mostrarDesconto} 
                    onCheckedChange={(checked) => {
                      setMostrarDesconto(checked);
                      // Se ativar "mostrar desconto", desativa "usar preço final"
                      if (checked) setUsarPrecoFinal(false);
                    }} 
                  />
                </div>
              </div>

              {/* Opções de IPI */}
              <div className="rounded-xl border border-amber-200/50 bg-amber-50/30 dark:bg-amber-950/10 p-3 space-y-3">
                <label className="text-sm font-medium flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <Percent className="h-3.5 w-3.5" />
                  Tratamento do IPI
                </label>
                
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="ipiModo"
                      value="incluso"
                      checked={ipiModo === 'incluso'}
                      onChange={() => setIpiModo('incluso')}
                      className="w-4 h-4 text-amber-500 border-amber-300 focus:ring-amber-500"
                    />
                    <div className="flex flex-col">
                      <span className="text-sm">IPI já incluso no preço</span>
                      <span className="text-[10px] text-muted-foreground">O valor do IPI já está calculado no preço final</span>
                    </div>
                  </label>
                  
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="ipiModo"
                      value="somar"
                      checked={ipiModo === 'somar'}
                      onChange={() => setIpiModo('somar')}
                      className="w-4 h-4 text-amber-500 border-amber-300 focus:ring-amber-500"
                    />
                    <div className="flex flex-col">
                      <span className="text-sm">Somar IPI ao preço final</span>
                      <span className="text-[10px] text-muted-foreground">Adiciona o valor do IPI ao preço com desconto</span>
                    </div>
                  </label>
                </div>
                
                {ipiModo === 'somar' && (
                  <div className="text-[11px] bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 p-2 rounded">
                    <strong>Exemplo:</strong> Produto R$ 100 + 10% IPI = <strong>R$ 110,00 final</strong>
                  </div>
                )}
              </div>

              <div className="gradient-primary rounded-xl p-4 text-primary-foreground space-y-1.5">
                <div className="flex justify-between text-sm"><span className="opacity-80">Itens afetados:</span><span className="font-bold">{produtosFiltrados.length}</span></div>
                <div className="flex justify-between text-sm"><span className="opacity-80">Desconto final:</span><span className="font-bold">{descNum}%</span></div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowPreview(true)}>
                  <Eye className="h-3.5 w-3.5" /> Preview
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSalvar}>
                  <Save className="h-3.5 w-3.5" /> Salvar
                </Button>
                <Button size="sm" className="gradient-primary text-primary-foreground gap-1.5 shadow-sm" onClick={handleGerarPDF}>
                  <FileDown className="h-3.5 w-3.5" /> Exportar PDF
                </Button>
                <Button size="sm" className="gradient-success text-primary-foreground gap-1.5 shadow-sm" onClick={handleGerarExcel}>
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Exportar Excel
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* CARD: Edição de IPI em Massa */}
          <Card className="shadow-card border-amber-200/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Percent className="h-4 w-4 text-amber-500" /> Editar IPI em Massa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Altere o IPI de todos os produtos do fornecedor selecionado acima de uma só vez. O IPI antigo será substituído.
              </p>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Novo IPI (%)</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={novoIpi}
                  onChange={e => setNovoIpi(e.target.value)}
                  placeholder="Ex: 9.75"
                  className={novoIpi !== "" && !ipiValido ? 'border-destructive' : ''}
                />
                <p className="text-[10px] text-muted-foreground">Substitui o IPI atual por este valor</p>
              </div>

              {/* Divisor visual */}
              <div className="border-t border-amber-200/50 pt-4">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Percent className="h-3.5 w-3.5 text-amber-500" />
                  Desconto no IPI (%)
                </label>
                <p className="text-[10px] text-muted-foreground mb-2">
                  Reduz o IPI atual de cada produto pelo percentual informado
                </p>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={descontoIpi}
                  onChange={e => setDescontoIpi(e.target.value)}
                  placeholder="Ex: 50 (para reduzir IPI pela metade)"
                  className={descontoIpi !== "" && !descontoIpiValido ? 'border-destructive' : ''}
                />
                {descontoIpiValido && produtosFiltrados.length > 0 && (
                  <p className="text-[10px] text-amber-600 mt-1 font-medium">
                    Ex: IPI de 6.5% → {+(6.5 * (1 - descontoIpiNum / 100)).toFixed(2)}% com {descontoIpiNum}% de desconto
                  </p>
                )}
              </div>

              {/* Info card mostrando IPI atual dos produtos filtrados */}
              {produtosFiltrados.length > 0 && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 p-3 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-700 dark:text-amber-400 opacity-80">Fornecedor:</span>
                    <span className="font-bold text-amber-800 dark:text-amber-300">{fornNome || 'Todos'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-700 dark:text-amber-400 opacity-80">Itens afetados:</span>
                    <span className="font-bold text-amber-800 dark:text-amber-300">{produtosFiltrados.length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-700 dark:text-amber-400 opacity-80">IPI atual (amostra):</span>
                    <span className="font-bold text-amber-800 dark:text-amber-300">
                      {(() => {
                        const ipis = [...new Set(produtosFiltrados.map(p => p.ipi || 0))];
                        if (ipis.length === 1) return `${ipis[0]}%`;
                        return `Misto (${ipis.slice(0, 3).join('%, ')}%${ipis.length > 3 ? '...' : ''})`;
                      })()}
                    </span>
                  </div>
                </div>
              )}

              <Button
                className="w-full gap-1.5 bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                size="sm"
                disabled={!ipiValido || !produtosFiltrados.length}
                onClick={handleSalvarIpi}
              >
                <Save className="h-3.5 w-3.5" /> Aplicar IPI em {produtosFiltrados.length} produto(s)
              </Button>

              <Button
                className="w-full gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                size="sm"
                disabled={!descontoIpiValido || !produtosFiltrados.length}
                onClick={handleAplicarDescontoIpi}
              >
                <Percent className="h-3.5 w-3.5" /> Aplicar {descontoIpiNum}% desconto no IPI
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ══════════════ TABELA / PREVIEW ══════════════ */}
        <Card className="shadow-card lg:col-span-2 overflow-hidden">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">{showPreview ? "Preview do Catálogo" : "Produtos com Desconto"}</CardTitle>
            {!showPreview ? (
              <Button variant="ghost" size="sm" className="text-xs text-primary gap-1" onClick={() => setShowPreview(true)}>
                <Sparkles className="h-3 w-3" /> Ver catálogo
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowPreview(false)}>Ver tabela</Button>
            )}
          </CardHeader>
          <CardContent>
            {showPreview ? (
              <div className="rounded-xl border shadow-sm overflow-hidden">
                <div className="gradient-primary p-6 text-primary-foreground">
                  <div className="flex items-center gap-4">
                    <img src={logo} alt="Logo" className="w-14 h-14 rounded-full border-2 border-white/20 shadow-lg" />
                    <div>
                      <h2 className="text-xl font-extrabold tracking-tight">{campanha}</h2>
                      <p className="text-sm opacity-80">Nunes Representações • {fornNome || "Todos os Fornecedores"}</p>
                    </div>
                  </div>
                </div>
                <div className="p-5 bg-card">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {produtosFiltrados.map(p => {
                      const pf = usarPrecoFinal ? p.precoFinal : +(p.precoBase * (1 - descNum / 100)).toFixed(2);
                      return (
                        <div key={p.id} className="border rounded-xl p-4 bg-card">
                          <p className="font-mono text-[10px] text-primary/60 font-medium">{p.codigoFinal || p.codigoOriginal}</p>
                          <p className="text-sm font-bold mt-1 text-foreground leading-tight">{p.nome}</p>
                          <p className="text-[11px] text-muted-foreground mt-1">{p.descricao}</p>
                          <div className="flex items-baseline gap-2 mt-3 pt-3 border-t">
                            {mostrarDesconto && <span className="text-xs line-through text-muted-foreground">R$ {p.precoBase.toFixed(2)}</span>}
                            <span className="text-lg font-extrabold text-primary">R$ {pf.toFixed(2)}</span>
                            {mostrarDesconto && <span className="text-[10px] font-semibold bg-success/10 text-success px-1.5 py-0.5 rounded-md">-{descontoString}%</span>}
                          </div>
                          {(p.ipi > 0) && (
                            <p className="text-[10px] text-amber-600 mt-1 font-medium">IPI: {p.ipi}%</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="px-5 py-3 bg-muted/50 border-t text-center">
                  <p className="text-[10px] text-muted-foreground">Tabela válida enquanto durarem os estoques • Preços sujeitos a alteração sem aviso prévio</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="premium-table">
                  <TableHeader>
                    <TableRow className="border-b-0">
                      <TableHead>Código</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Preço Original</TableHead>
                      <TableHead className="text-right">Desconto</TableHead>
                      <TableHead className="text-right">Preço Final</TableHead>
                      <TableHead className="text-center">IPI %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {produtosFiltrados.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs text-primary/80 font-medium">{p.codigoFinal || p.codigoOriginal}</TableCell>
                        <TableCell className="text-sm font-medium">{p.nome}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">R$ {p.precoBase.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm text-primary font-semibold tabular-nums">{descontoString}%</TableCell>
                        <TableCell className="text-right text-sm font-bold tabular-nums">R$ {(usarPrecoFinal ? p.precoFinal : p.precoBase * (1 - descNum / 100)).toFixed(2)}</TableCell>
                        <TableCell className="text-center text-sm tabular-nums">
                          <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${p.ipi > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'text-muted-foreground'}`}>
                            {p.ipi > 0 ? `${p.ipi}%` : '-'}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

