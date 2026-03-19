import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fornecedores, produtos } from "@/data/mockData";
import { Eye, FileDown, FileSpreadsheet, Save, Tag, Sparkles } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/logo-nunes.png";

export default function DescontosCatalogos() {
  const [fornecedor, setFornecedor] = useState("");
  const [desconto, setDesconto] = useState("15");
  const [campanha, setCampanha] = useState("Campanha Verão 2026");
  const [showPreview, setShowPreview] = useState(false);
  const [usarPrecoFinal, setUsarPrecoFinal] = useState(false);
  const [mostrarDesconto, setMostrarDesconto] = useState(true);

  const produtosFiltrados = fornecedor ? produtos.filter(p => p.fornecedor === fornecedores.find(f => f.id === fornecedor)?.nome) : produtos.slice(0, 5);
  const descNum = parseFloat(desconto) || 0;

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
                <SelectContent>{fornecedores.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Percentual de Desconto</label>
              <div className="relative">
                <Input type="number" value={desconto} onChange={e => setDesconto(e.target.value)} className="pr-8" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </div>
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
              <div className="flex justify-between text-sm"><span className="opacity-80">Desconto aplicado:</span><span className="font-bold">{desconto}%</span></div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowPreview(true)}>
                <Eye className="h-3.5 w-3.5" /> Preview
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => toast.success("Regra salva!")}>
                <Save className="h-3.5 w-3.5" /> Salvar
              </Button>
              <Button size="sm" className="gradient-primary text-primary-foreground gap-1.5 shadow-sm" onClick={() => toast.success("PDF gerado!")}>
                <FileDown className="h-3.5 w-3.5" /> Exportar PDF
              </Button>
              <Button size="sm" className="gradient-success text-primary-foreground gap-1.5 shadow-sm" onClick={() => toast.success("Excel gerado!")}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> Exportar Excel
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-2 overflow-hidden">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">{showPreview ? "Preview do Catálogo" : "Produtos com Desconto"}</CardTitle>
            {!showPreview && (
              <Button variant="ghost" size="sm" className="text-xs text-primary gap-1" onClick={() => setShowPreview(true)}>
                <Sparkles className="h-3 w-3" /> Ver catálogo
              </Button>
            )}
            {showPreview && (
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowPreview(false)}>
                Ver tabela
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {showPreview ? (
              <div className="rounded-xl border shadow-premium overflow-hidden">
                {/* Catalog header */}
                <div className="gradient-primary p-6 text-primary-foreground">
                  <div className="flex items-center gap-4">
                    <img src={logo} alt="Logo" className="w-14 h-14 rounded-full border-2 border-white/20 shadow-lg" />
                    <div>
                      <h2 className="text-xl font-extrabold tracking-tight">{campanha}</h2>
                      <p className="text-sm opacity-80">Nunes Representações • {fornecedores.find(f => f.id === fornecedor)?.nome || "Todos os Fornecedores"}</p>
                    </div>
                  </div>
                </div>

                {/* Catalog products */}
                <div className="p-5 bg-card">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {produtosFiltrados.map(p => {
                      const pf = usarPrecoFinal ? p.precoFinal : p.precoBase * (1 - descNum / 100);
                      return (
                        <div key={p.id} className="catalog-card border rounded-xl p-4 bg-card">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <p className="font-mono text-[10px] text-primary/60 font-medium">{p.codigoFinal || p.codigoOriginal}</p>
                              <p className="text-sm font-bold mt-1 text-foreground leading-tight">{p.nome}</p>
                              <p className="text-[11px] text-muted-foreground mt-1">{p.descricao}</p>
                            </div>
                          </div>
                          <div className="flex items-baseline gap-2 mt-3 pt-3 border-t">
                            {mostrarDesconto && (
                              <span className="text-xs line-through text-muted-foreground">R$ {p.precoBase.toFixed(2)}</span>
                            )}
                            <span className="text-lg font-extrabold text-primary">R$ {pf.toFixed(2)}</span>
                            {mostrarDesconto && (
                              <span className="text-[10px] font-semibold bg-success/10 text-success px-1.5 py-0.5 rounded-md">-{descNum}%</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Catalog footer */}
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
                        <TableCell className="text-right text-sm text-primary font-semibold tabular-nums">{descNum}%</TableCell>
                        <TableCell className="text-right text-sm font-bold tabular-nums">R$ {(p.precoBase * (1 - descNum / 100)).toFixed(2)}</TableCell>
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
