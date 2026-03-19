import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

const pedidoItems = [
  { codigo: "NR-TRM-001", descricao: "Jogo de Chaves Combinadas 6-22mm", qtd: 5, preco: 161.42, total: 807.10 },
  { codigo: "NR-TRM-002", descricao: "Alicate Universal 8\"", qtd: 12, preco: 46.67, total: 560.04 },
  { codigo: "NR-VND-100", descricao: "Furadeira de Impacto 750W", qtd: 2, preco: 296.10, total: 592.20 },
  { codigo: "NR-STR-050", descricao: "Lâmina de Serra 24D", qtd: 50, preco: 16.28, total: 814.00 },
];

export default function ConversaoPedidos() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Conversão de Pedidos</h1>
        <p className="text-sm text-muted-foreground">Converta pedidos do Mercos para o layout de fornecedores/ERP</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" /> Configurar Conversão</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Upload do pedido Mercos</p>
              <p className="text-xs text-muted-foreground">.xlsx, .csv</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Destino</label>
              <Select>
                <SelectTrigger><SelectValue placeholder="Selecionar destino" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="jaweb">JaWeb</SelectItem>
                  <SelectItem value="erp">ERP Fornecedor</SelectItem>
                  <SelectItem value="outro">Outro layout</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full gradient-primary text-primary-foreground" onClick={() => toast.success("Pedido convertido!")}>
              <Download className="h-4 w-4 mr-1" /> Exportar Pedido Convertido
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Itens do Pedido #1542</CardTitle>
              <span className="text-xs text-muted-foreground">Ref: MRC-2026-1542</span>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pedidoItems.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{item.codigo}</TableCell>
                    <TableCell className="text-sm">{item.descricao}</TableCell>
                    <TableCell className="text-right text-sm">{item.qtd}</TableCell>
                    <TableCell className="text-right text-sm">R$ {item.preco.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm font-semibold">R$ {item.total.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-semibold text-sm">Total do Pedido:</TableCell>
                  <TableCell className="text-right font-bold text-primary">R$ {pedidoItems.reduce((s, i) => s + i.total, 0).toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
