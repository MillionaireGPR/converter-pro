import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, ArrowRightLeft, CheckCircle, FileSpreadsheet, AlertTriangle, XCircle, List } from "lucide-react";
import { toast } from "sonner";
import { useHistorico } from "@/context/HistoricoContext";
import { processarPedido } from "@/core/orders/orderParser";
import { exportarPedido, validarPedidoParaExportacao, downloadExportedFile, EXPORT_FORMATS, type FormatoExportacao } from "@/core/orders/orderExporter";
import type { ItemPedidoNormalizado, PedidoProcessado } from "@/core/orders/orderTypes";
import { parseMercosOrderPdf } from "@/core/orders/mercosOrderPdfParser";
import { exportarPedidoJawebFromTemplate } from "@/core/orders/jawebTemplateExporter";

export default function ConversaoPedidos() {
  const { registrarHistorico } = useHistorico();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [destino, setDestino] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Estado do pedido processado
  const [pedido, setPedido] = useState<PedidoProcessado | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState("");

  // === UPLOAD ===
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validar extensão (PDF agora aceito para pedido Mercos)
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv", "pdf"].includes(ext || "")) {
      toast.error("Formato inválido. Use .xlsx, .xls, .csv ou .pdf");
      return;
    }

    setIsLoading(true);
    setNomeArquivo(file.name);

    try {
      // PDF Mercos -> usa parser dedicado (extrai cabeçalho + itens)
      const resultado = ext === "pdf"
        ? await parseMercosOrderPdf(file)
        : await processarPedido(file, destino);
      setPedido(resultado);

      toast.success(
        `Pedido lido com sucesso! ${resultado.stats.totalItens} itens detectados.`
      );

      // Registrar no histórico
      await registrarHistorico({
        arquivo: file.name,
        fornecedor: "-",
        usuario: "Admin",
        data: new Date().toISOString(),
        tipoConversao: "Leitura de Pedido",
        qtdItens: resultado.stats.totalItens,
        status: resultado.stats.itensErro > 0 ? "erro" : "concluído",
      });
    } catch (err: any) {
      console.error("[Order Parser] Erro:", err);
      toast.error(`Erro ao ler o arquivo: ${err.message}`);
      setPedido(null);
    } finally {
      setIsLoading(false);
      // Reset input para permitir reupload do mesmo arquivo
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExportar = async () => {
    if (!destino) {
      toast.error("Selecione um destino primeiro.");
      return;
    }
    if (!pedido || pedido.itens.length === 0) {
      toast.error("Nenhum pedido carregado para exportar.");
      return;
    }

    try {
      const formato = destino as FormatoExportacao;

      // Caso especial JAWEB: usa template oficial preservando 100% do formato
      if (formato === "jaweb") {
        const { blob, filename } = await exportarPedidoJawebFromTemplate(pedido);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        await registrarHistorico({
          arquivo: nomeArquivo,
          fornecedor: "JAW WEB",
          usuario: "Admin",
          data: new Date().toISOString(),
          tipoConversao: "Exportação JAW WEB (template oficial)",
          qtdItens: pedido.itens.length,
          status: "concluído",
        });

        toast.success(`JAW WEB exportado! ${pedido.itens.length} itens.`);
        return;
      }

      // Demais formatos: validação + exportador padrão
      const issues = validarPedidoParaExportacao(pedido, formato);

      const errors = issues.filter(i => i.severity === 'error');
      if (errors.length > 0) {
        toast.error(`${errors.length} erro(s) encontrados. Verifique os itens.`);
        console.error("[Export] Erros:", errors);
        return;
      }

      const warnings = issues.filter(i => i.severity === 'warning');
      if (warnings.length > 0) {
        toast.warning(`${warnings.length} aviso(s). Exportando mesmo assim.`);
      }

      const resultado = exportarPedido(pedido, formato, {
        onlyValid: true,
        includeErrors: false,
      });

      downloadExportedFile(resultado);

      registrarHistorico({
        arquivo: nomeArquivo,
        fornecedor: EXPORT_FORMATS[formato].name,
        usuario: "Admin",
        data: new Date().toISOString(),
        tipoConversao: `Exportação ${EXPORT_FORMATS[formato].name}`,
        qtdItens: resultado.stats.validItems,
        status: errors.length === 0 ? "concluído" : "erro",
      });

      toast.success(`Exportado com sucesso! ${resultado.stats.validItems} itens.`);
    } catch (err: any) {
      console.error("[Export] Erro:", err);
      toast.error(`Erro ao exportar: ${err.message}`);
    }
  };

  // === STATUS BADGES ===
  const renderStatusBadge = (status: string) => {
    if (status === "ok")
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
          <CheckCircle className="h-3 w-3" /> OK
        </span>
      );
    if (status === "incompleto")
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
          <AlertTriangle className="h-3 w-3" /> Incompleto
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
        <XCircle className="h-3 w-3" /> Erro
      </span>
    );
  };

  const formatCurrency = (val: number) => {
    if (!val || val === 0) return "-";
    return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  // Mapeamento detectado para exibição
  const colunasDetectadas = pedido?.mapeamento
    ? Object.entries(pedido.mapeamento)
        .filter(([, val]) => val !== null)
        .map(([key, val]) => `${key}: "${val}"`)
    : [];

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          Conversão de Pedidos
        </h1>
        <p className="text-sm text-muted-foreground">
          Importe pedidos do Mercos e converta para o layout do fornecedor/ERP
        </p>
        {!pedido && (
          <div className="mt-3 text-xs font-semibold bg-primary/10 text-primary px-3 py-2 rounded-lg inline-flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            Faça o upload de um arquivo de pedido para começar.
          </div>
        )}
      </div>

      {/* INPUT FILE HIDDEN */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".xlsx,.xls,.csv,.pdf"
        onChange={handleFileChange}
      />

      {/* STATUS CARDS (aparece após leitura) */}
      {pedido && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="shadow-card">
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-primary">
                {pedido.stats.totalItens}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Itens Detectados</p>
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-emerald-600">
                {pedido.stats.itensOk}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Itens Válidos</p>
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-amber-600">
                {pedido.stats.itensIncompletos}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Campos Faltando</p>
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-red-600">
                {pedido.stats.itensErro}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Itens com Erro</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* PAINEL ESQUERDO: Upload + Destino */}
        <Card className="shadow-card border-dashed">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" /> Configurar Conversão
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* UPLOAD AREA */}
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                pedido
                  ? "border-emerald-400 bg-emerald-50/50"
                  : "border-border hover:border-primary/50 bg-muted/30"
              } ${isLoading ? "opacity-50 pointer-events-none" : ""}`}
              onClick={handleUploadClick}
            >
              {isLoading ? (
                <>
                  <div className="h-8 w-8 mx-auto mb-2 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-medium">Lendo arquivo...</p>
                </>
              ) : pedido ? (
                <>
                  <FileSpreadsheet className="h-8 w-8 mx-auto text-emerald-600 mb-2" />
                  <p className="text-sm font-medium text-emerald-700">
                    {nomeArquivo}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Clique para trocar o arquivo
                  </p>
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Upload do pedido</p>
                  <p className="text-xs text-muted-foreground">.xlsx, .xls, .csv, .pdf (Mercos)</p>
                </>
              )}
            </div>

            {/* DETALHES DA LEITURA */}
            {pedido && colunasDetectadas.length > 0 && (
              <div className="bg-muted/40 rounded-lg p-3 space-y-1.5 text-xs">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <List className="h-3.5 w-3.5" /> Colunas Detectadas
                </p>
                {colunasDetectadas.map((col, i) => (
                  <p key={i} className="text-muted-foreground pl-5">
                    • {col}
                  </p>
                ))}
                <p className="text-muted-foreground pt-1 border-t border-border/50">
                  Cabeçalho na linha {(pedido.bruto.headerRowIndex || 0) + 1}
                </p>
              </div>
            )}

            {/* DESTINO */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Destino</label>
              <Select value={destino} onValueChange={setDestino}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar destino" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(EXPORT_FORMATS).map(([key, format]) => (
                    <SelectItem key={key} value={key}>
                      {format.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* BOTÃO EXPORTAR */}
            <Button
              className="w-full gradient-primary text-primary-foreground"
              onClick={handleExportar}
              disabled={!pedido || pedido.itens.length === 0}
            >
              <Download className="h-4 w-4 mr-1" /> Exportar Pedido Convertido
            </Button>
          </CardContent>
        </Card>

        {/* PAINEL DIREITO: Preview dos Itens */}
        <Card className="shadow-card lg:col-span-2 overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Itens do Pedido</CardTitle>
              {pedido && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
                  {pedido.stats.totalItens} itens
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!pedido ? (
              <div className="h-[300px] flex items-center justify-center text-center">
                <div className="space-y-2">
                  <ArrowRightLeft className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground max-w-[280px]">
                    Faça o upload de um arquivo de pedido para visualizar os
                    itens aqui.
                  </p>
                </div>
              </div>
            ) : pedido.itens.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-center">
                <div className="space-y-2">
                  <AlertTriangle className="h-10 w-10 mx-auto text-amber-400" />
                  <p className="text-sm text-muted-foreground max-w-[280px]">
                    Nenhum item encontrado no arquivo. Verifique se o formato
                    está correto.
                  </p>
                </div>
              </div>
            ) : (
              <div className="max-h-[500px] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[50px]">#</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead className="min-w-[200px]">Descrição</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Preço Unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-center w-[100px]">
                        Status
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pedido.itens.map((item, idx) => (
                      <TableRow
                        key={idx}
                        className={
                          item.status === "erro"
                            ? "bg-red-50/50"
                            : item.status === "incompleto"
                            ? "bg-amber-50/30"
                            : ""
                        }
                      >
                        <TableCell className="text-xs text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {item.codigo || "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.descricao || "-"}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {item.quantidade || "-"}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatCurrency(item.precoUnitario)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatCurrency(item.total)}
                        </TableCell>
                        <TableCell className="text-center">
                          {renderStatusBadge(item.status)}
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
