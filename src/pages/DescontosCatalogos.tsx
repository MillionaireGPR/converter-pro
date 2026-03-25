import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApp } from "@/context/AppContext";
import { Eye, FileDown, FileSpreadsheet, Save, Tag, Sparkles, Package } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import logo from "@/assets/logo-nunes.png";

export default function DescontosCatalogos() {
  const { produtosPadronizados, fornecedores, aplicarDesconto, gerarCatalogo, registrarHistorico } = useApp();
  const navigate = useNavigate();
  const [fornecedor, setFornecedor] = useState("");
  const [descontoPrincipal, setDescontoPrincipal] = useState("15");
  const [descontoAdicional, setDescontoAdicional] = useState("");
  const [campanha, setCampanha] = useState("Campanha Verão 2026");
  const [showPreview, setShowPreview] = useState(false);
  const [usarPrecoFinal, setUsarPrecoFinal] = useState(false);
  const [mostrarDesconto, setMostrarDesconto] = useState(true);

  const forn = fornecedores.find(f => f.id === fornecedor);
  const fornNome = forn?.nome;
  const produtosFiltrados = forn ? produtosPadronizados.filter(p => p.fornecedorId === forn.id || p.fornecedor === forn.nome) : produtosPadronizados;

  const fornecedoresComProdutos = fornecedores.filter(f => 
    produtosPadronizados.some(p => p.fornecedorId === f.id || p.fornecedor === f.nome)
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

  const handleGerarPDF = async () => {
    if (!valido) { toast.error("Formato de desconto inválido."); return; }
    if (!produtosFiltrados.length) { toast.error("Sem produtos."); return; }
    try {
      console.log(`[Flow MVP] Gerando PDF simples jspdf...`);
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text(`Catálogo Comercial - ${campanha}`, 14, 20);
      doc.setFontSize(10);
      doc.text(`Fornecedor: ${fornNome || 'Todos'} | Itens: ${produtosFiltrados.length}`, 14, 28);
      
      const head = [['Código', 'Produto', 'Preço Original', 'Desconto', 'Preço Final', 'Fornecedor']];
      const body = produtosFiltrados.map(p => {
        const pf = usarPrecoFinal ? p.precoFinal : +(p.precoBase * (1 - descNum / 100)).toFixed(2);
        return [
          p.codigoFinal || p.codigoOriginal,
          p.nome.substring(0, 45),
          `R$ ${p.precoBase.toFixed(2)}`,
          `${descontoString}%`,
          `R$ ${pf.toFixed(2)}`,
          p.fornecedor
        ]
      });

      autoTable(doc, {
        startY: 35,
        head: head,
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
          <p className="text-sm text-muted-foreground mt-1">Configure descontos e gere catálogos comerciais</p>
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
        <p className="text-sm text-muted-foreground mt-1">Configure descontos e gere catálogos comerciais apresentáveis</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-card lg:col-span-1">
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
                <label className="text-sm text-muted-foreground">Usar preço final</label>
                <Switch checked={usarPrecoFinal} onCheckedChange={setUsarPrecoFinal} />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-muted-foreground">Mostrar desconto</label>
                <Switch checked={mostrarDesconto} onCheckedChange={setMostrarDesconto} />
              </div>
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
