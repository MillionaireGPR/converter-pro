import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, ArrowRightLeft, CheckCircle } from "lucide-react";
import { useApp, PedidoItem } from "@/context/AppContext";
import { toast } from "sonner";

const mockPedidoItems: PedidoItem[] = [
  { codigo: "NR-TRM-001", descricao: "Jogo de Chaves Combinadas 6-22mm", qtd: 5, preco: 161.42, total: 807.10 },
  { codigo: "NR-TRM-002", descricao: "Alicate Universal 8\"", qtd: 12, preco: 46.67, total: 560.04 },
  { codigo: "NR-VND-100", descricao: "Furadeira de Impacto 750W", qtd: 2, preco: 296.10, total: 592.20 },
  { codigo: "NR-STR-050", descricao: "Lâmina de Serra 24D", qtd: 50, preco: 16.28, total: 814.00 },
];

export default function ConversaoPedidos() {
  const { converterPedido, produtosPadronizados } = useApp();
  const [destino, setDestino] = useState("");
  const [uploaded, setUploaded] = useState(false);
  const [converted, setConverted] = useState(false);

  const pedidoItems: PedidoItem[] = useMemo(() => {
    if (produtosPadronizados.length > 0) {
      return produtosPadronizados.slice(0, 5).map((p, i) => {
        const qtd = [3, 5, 2, 10, 1][i % 5];
        const preco = p.precoFinal;
        return { codigo: p.codigoFinal || p.codigoOriginal, descricao: p.nome, qtd, preco, total: +(qtd * preco).toFixed(2) };
      });
    }
    return mockPedidoItems;
  }, [produtosPadronizados]);

  const handleUpload = () => {
    setUploaded(true);
    toast.info("Pedido Mercos carregado!");
  };

  const handleExportar = () => {
    if (!destino) { toast.error("Selecione um destino"); return; }
    converterPedido(destino, pedidoItems);
    setConverted(true);
    toast.success(`Pedido convertido para ${destino}!`);
  };

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
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${uploaded ? 'border-success bg-success/5' : 'border-border hover:border-primary/50'}`}
              onClick={handleUpload}
            >
              {uploaded ? (
                <>
                  <CheckCircle className="h-8 w-8 mx-auto text-success mb-2" />
                  <p className="text-sm font-medium text-success">Pedido carregado</p>
                  <p className="text-xs text-muted-foreground">{pedidoItems.length} itens</p>
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Upload do pedido Mercos</p>
                  <p className="text-xs text-muted-foreground">.xlsx, .csv</p>
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Destino</label>
              <Select value={destino} onValueChange={setDestino}>
                <SelectTrigger><SelectValue placeholder="Selecionar destino" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="JaWeb">JaWeb</SelectItem>
                  <SelectItem value="ERP Fornecedor">ERP Fornecedor</SelectItem>
                  <SelectItem value="Outro layout">Outro layout</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full gradient-primary text-primary-foreground" onClick={handleExportar}>
              <Download className="h-4 w-4 mr-1" /> Exportar Pedido Convertido
            </Button>
            {converted && (
              <div className="rounded-lg border border-success/20 bg-success/5 p-3 text-sm text-success flex items-center gap-2">
                <CheckCircle className="h-4 w-4" /> Pedido convertido e registrado no histórico
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Itens do Pedido</CardTitle>
              <span className="text-xs text-muted-foreground">{pedidoItems.length} itens</span>
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
