import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { Download, CheckCircle, AlertTriangle, XCircle, Package, FileWarning } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { ProdutoNormalizadoV2, MERCOS_EXPORT_COLUMNS } from "@/core/types/productPipeline";
import { batchNormalizeToMercos } from "@/core/mercos/normalizeToMercos";
import { generateMercosXLSX, generateErrorReport } from "@/core/mercos/exportMercos";

export default function ExportacoesMercos() {
  const { produtosPadronizados, exportacoesMercos, exportarMercos } = useApp();
  const navigate = useNavigate();
  const [precoMode, setPrecoMode] = useState<'tabela' | 'desconto'>('desconto');

  const displayProducts = produtosPadronizados;

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
                <CardTitle className="text-base">Preview da Exportação ({mercosResult.validos.length} válidos / {mercosResult.invalidos.length} inválidos)</CardTitle>
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-xs">Schema Mercos Fixo</Badge>
                  <Badge variant="outline" className="text-xs">{MERCOS_EXPORT_COLUMNS.length} colunas</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {mercosResult.invalidos.length > 0 && (
                <div className="flex items-center justify-between p-3 bg-destructive/5 rounded-lg border border-destructive/10">
                  <div className="flex items-center gap-2">
                    <FileWarning className="h-4 w-4 text-destructive" />
                    <span className="text-sm font-medium text-destructive">{mercosResult.invalidos.length} produtos excluídos da exportação (campos obrigatórios ausentes)</span>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={handleExportarErros}>
                    Exportar Erros
                  </Button>
                </div>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código do produto*</TableHead>
                      <TableHead>Nome do produto*</TableHead>
                      <TableHead className="text-right">Preço de Tabela*</TableHead>
                      <TableHead className="text-right">IPI</TableHead>
                      <TableHead>Informações adicionais</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mercosResult.validos.slice(0, 50).map((p, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{p['Código do produto (recomendado)']}</TableCell>
                        <TableCell className="text-sm max-w-[240px] truncate">{p['Nome do produto (obrigatório)']}</TableCell>
                        <TableCell className="text-right text-sm">R$ {Number(p['Preço de Tabela (obrigatório)'] || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm">{p['IPI (opcional - não informar o símbolo %)'] || '-'}</TableCell>
                        <TableCell className="text-xs max-w-[220px] truncate">{p['Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)'] || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20"><CheckCircle className="h-3 w-3 mr-1" />OK</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {mercosResult.validos.length > 50 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-3">
                          ...e mais {mercosResult.validos.length - 50} produtos (exibindo primeiros 50)
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
