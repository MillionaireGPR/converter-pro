import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fornecedores, produtos } from "@/data/mockData";
import { Eye, FileDown, FileSpreadsheet, Save, Tag } from "lucide-react";
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Descontos e Catálogos</h1>
        <p className="text-sm text-muted-foreground">Configure descontos e gere catálogos comerciais</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-card lg:col-span-1">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4" /> Configurar Desconto</CardTitle></CardHeader>
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
              <Input type="number" value={desconto} onChange={e => setDesconto(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nome da Campanha</label>
              <Input value={campanha} onChange={e => setCampanha(e.target.value)} />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between"><label className="text-sm">Usar preço final</label><Switch checked={usarPrecoFinal} onCheckedChange={setUsarPrecoFinal} /></div>
              <div className="flex items-center justify-between"><label className="text-sm">Mostrar desconto</label><Switch checked={mostrarDesconto} onCheckedChange={setMostrarDesconto} /></div>
            </div>
            <div className="bg-accent/50 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Itens afetados:</span><span className="font-semibold">{produtosFiltrados.length}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Desconto aplicado:</span><span className="font-semibold text-primary">{desconto}%</span></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowPreview(true)}><Eye className="h-4 w-4 mr-1" /> Preview</Button>
              <Button variant="outline" size="sm" onClick={() => toast.success("Regra salva!")}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
              <Button variant="outline" size="sm" onClick={() => toast.success("PDF gerado!")}><FileDown className="h-4 w-4 mr-1" /> PDF</Button>
              <Button variant="outline" size="sm" onClick={() => toast.success("Excel gerado!")}><FileSpreadsheet className="h-4 w-4 mr-1" /> Excel</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-2">
          <CardHeader><CardTitle className="text-base">{showPreview ? "Preview do Catálogo" : "Produtos com Desconto"}</CardTitle></CardHeader>
          <CardContent>
            {showPreview ? (
              <div className="border rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-4 border-b pb-4">
                  <img src={logo} alt="Logo" className="w-12 h-12 rounded-full" />
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{campanha}</h2>
                    <p className="text-xs text-muted-foreground">Nunes Representações • {fornecedores.find(f => f.id === fornecedor)?.nome || "Todos"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {produtosFiltrados.map(p => {
                    const pf = usarPrecoFinal ? p.precoFinal : p.precoBase * (1 - descNum / 100);
                    return (
                      <div key={p.id} className="border rounded-lg p-3 hover:shadow-card transition-shadow">
                        <p className="font-mono text-[10px] text-muted-foreground">{p.codigoFinal || p.codigoOriginal}</p>
                        <p className="text-sm font-semibold mt-0.5">{p.nome}</p>
                        <div className="flex items-baseline gap-2 mt-2">
                          {mostrarDesconto && <span className="text-xs line-through text-muted-foreground">R$ {p.precoBase.toFixed(2)}</span>}
                          <span className="text-base font-bold text-primary">R$ {pf.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
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
                      <TableCell className="font-mono text-xs">{p.codigoFinal || p.codigoOriginal}</TableCell>
                      <TableCell className="text-sm">{p.nome}</TableCell>
                      <TableCell className="text-right text-sm">R$ {p.precoBase.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm text-primary font-medium">{descNum}%</TableCell>
                      <TableCell className="text-right text-sm font-semibold">R$ {(p.precoBase * (1 - descNum / 100)).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
