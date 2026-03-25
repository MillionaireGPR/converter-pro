import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { Download, CheckCircle, AlertTriangle, XCircle, Package } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";

export default function ExportacoesMercos() {
  const { produtosPadronizados, exportacoesMercos, exportarMercos } = useApp();
  const navigate = useNavigate();
  const [precoMode, setPrecoMode] = useState<'tabela' | 'desconto'>('desconto');

  const latestExport = exportacoesMercos.length > 0 ? exportacoesMercos[exportacoesMercos.length - 1] : null;
  const exportProducts = latestExport?.produtos || [];
  const hasExports = exportProducts.length > 0;
  
  // Se for uma exportação histórica, respeitamos o que foi salvo nela. 
  // Se for nova, usamos os produtos filtrados/carregados no contexto no momento.
  const displayProducts = hasExports ? exportProducts : produtosPadronizados;
  
  const validProducts = displayProducts.filter(p => p.status !== 'erro' && p.codigoFinal && (precoMode === 'tabela' ? p.precoBase > 0 : p.precoFinal > 0));

  const handleGerarPlanilha = async () => {
    if (validProducts.length === 0) {
      toast.error("Nenhum produto válido para exportar. Corrija os erros na Base Padronizada.");
      return;
    }

    try {
      console.log(`[Flow MVP] Iniciando geração de planilha de exportação Mercos: ${validProducts.length} itens a serem documentados.`);
      
      // 1. Prepara os dados pro formato Mercos
      const data = validProducts.map(p => ({
        "Código do produto": p.codigoFinal || p.codigoOriginal,
        "Nome do produto": p.nome,
        "Preço de Tabela": precoMode === 'tabela' ? p.precoBase : p.precoFinal,
        "IPI (%)": p.ipi,
        "Unidade": p.unidade || "UN",
        "Categoria": p.categoria,
        "Descrição complementar": p.descricao
      }));

      // 2. Cria a planilha
      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Produtos");

      // 3. Define larguras de colunas básicas
      worksheet["!cols"] = [
        { wch: 15 }, // Código
        { wch: 40 }, // Nome
        { wch: 15 }, // Preço
        { wch: 10 }, // IPI
        { wch: 10 }, // Unidade
        { wch: 20 }, // Categoria
        { wch: 50 }, // Descrição
      ];

      // 4. Dispara download
      const fileName = `export_mercos_${validProducts[0]?.fornecedor || 'geral'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      console.log(`[Flow MVP] Fazendo download do arquivo: ${fileName}`);
      XLSX.writeFile(workbook, fileName);

      // 5. Registra no contexto e no Supabase (Aguardando)
      console.log(`[Flow MVP] Salvando registro de exportação no Supabase/Estado com modo: ${precoMode}.`);
      await exportarMercos(validProducts);
      
      console.log(`[Flow MVP] Fluxo completo de exportação finalizado.`);
      toast.success(`Planilha "${fileName}" gerada e registrada com sucesso!`);
    } catch (error) {
      console.error(error);
      toast.error("Erro ao gerar planilha XLSX.");
    }
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
                      <TableHead className="text-right">Preço ({precoMode === 'tabela' ? 'Base' : 'Final'})*</TableHead>
                      <TableHead className="text-right">IPI*</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayProducts.map(p => (
                      <TableRow key={p.id} className={p.status === 'erro' || !p.codigoFinal ? 'bg-destructive/5' : ''}>
                        <TableCell className="font-mono text-xs">{p.codigoFinal || <span className="text-destructive font-semibold">VAZIO</span>}</TableCell>
                        <TableCell className="text-sm">{p.nome}</TableCell>
                        <TableCell className="text-right text-sm">R$ {(precoMode === 'tabela' ? p.precoBase : p.precoFinal).toFixed(2)}</TableCell>
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
