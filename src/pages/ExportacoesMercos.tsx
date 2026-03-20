import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/context/AppContext";
import { Download, CheckCircle, AlertTriangle, XCircle, Package } from "lucide-react";
import { toast } from "sonner";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

export default function ExportacoesMercos() {
  const { produtos, exportacoesMercos, exportarMercos, addHistorico } = useApp();
  const navigate = useNavigate();

  // Show only products from the latest export, or empty if none
  const latestExport = exportacoesMercos.length > 0 ? exportacoesMercos[exportacoesMercos.length - 1] : null;
  const exportProducts = latestExport?.produtos || [];
  const hasExports = exportProducts.length > 0;

  const checks = useMemo(() => {
    const semCodigo = exportProducts.filter(p => !p.codigoFinal).length;
    const semPreco = exportProducts.filter(p => !p.precoFinal || p.precoFinal <= 0).length;
    const duplicados = exportProducts.length - new Set(exportProducts.map(p => p.codigoFinal)).size;
    const erros = exportProducts.filter(p => p.status === 'erro').length;
    const preenchidos = exportProducts.filter(p => p.codigoFinal && p.nome && p.precoFinal > 0).length;
    return [
      { label: "Campos obrigatórios preenchidos", ok: preenchidos === exportProducts.length, count: `${preenchidos}/${exportProducts.length}` },
      { label: "Produtos sem código", ok: semCodigo === 0, count: `${semCodigo} encontrado(s)` },
      { label: "Produtos sem preço", ok: semPreco === 0, count: `${semPreco} encontrado(s)` },
      { label: "Produtos com duplicidade", ok: duplicados === 0, count: `${duplicados} encontrado(s)` },
      { label: "Erros de formatação", ok: erros === 0, count: `${erros} encontrado(s)` },
    ];
  }, [exportProducts]);

  const validProducts = exportProducts.filter(p => p.status !== 'erro' && p.codigoFinal && p.precoFinal > 0);

  const handleGerarPlanilha = () => {
    if (validProducts.length === 0) {
      toast.error("Nenhum produto válido para exportar");
      return;
    }
    exportarMercos(validProducts);
    toast.success(`Planilha Mercos gerada com ${validProducts.length} produtos!`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exportações Mercos</h1>
          <p className="text-sm text-muted-foreground">Gere arquivos no formato de importação do Mercos</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-xs">{exportacoesMercos.length} exportação(ões) realizadas</Badge>
          <Button size="sm" className="gradient-primary text-primary-foreground" onClick={handleGerarPlanilha}>
            <Download className="h-4 w-4 mr-1" /> Gerar Planilha Mercos
          </Button>
        </div>
      </div>

      {exportProducts.length === 0 ? (
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
              {checks.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  {c.ok ? <CheckCircle className="h-4 w-4 text-success shrink-0" /> : <AlertTriangle className="h-4 w-4 text-warning shrink-0" />}
                  <div className="flex-1">
                    <p className="text-sm">{c.label}</p>
                    <p className="text-xs text-muted-foreground">{c.count}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="shadow-card lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Preview da Exportação ({validProducts.length} válidos)</CardTitle>
                <Badge variant="outline" className="text-xs">Formato Mercos v3</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código*</TableHead>
                      <TableHead>Nome do Produto*</TableHead>
                      <TableHead className="text-right">Preço Tabela*</TableHead>
                      <TableHead className="text-right">IPI*</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exportProducts.map(p => (
                      <TableRow key={p.id} className={p.status === 'erro' || !p.codigoFinal ? 'bg-destructive/5' : ''}>
                        <TableCell className="font-mono text-xs">{p.codigoFinal || <span className="text-destructive font-semibold">VAZIO</span>}</TableCell>
                        <TableCell className="text-sm">{p.nome}</TableCell>
                        <TableCell className="text-right text-sm">R$ {p.precoFinal.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm">{p.ipi}%</TableCell>
                        <TableCell className="text-sm">{p.unidade}</TableCell>
                        <TableCell className="text-xs">{p.categoria}</TableCell>
                        <TableCell>
                          {p.status === 'erro' || !p.codigoFinal ? (
                            <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20"><XCircle className="h-3 w-3 mr-1" />Inválido</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20"><CheckCircle className="h-3 w-3 mr-1" />OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
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
