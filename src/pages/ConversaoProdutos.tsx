import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileSpreadsheet, FileText, CheckCircle, AlertCircle } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { fornecedores } from "@/data/mockData";
import { toast } from "sonner";

export default function ConversaoProdutos() {
  const [fornecedor, setFornecedor] = useState("");
  const [tipoArquivo, setTipoArquivo] = useState("");
  const [uploaded, setUploaded] = useState(false);

  const handleProcessar = () => {
    toast.success("Arquivo processado com sucesso! 342 produtos detectados.");
    setUploaded(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Conversão de Produtos</h1>
        <p className="text-sm text-muted-foreground">Envie arquivos de fornecedores para processamento automático</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Upload de Arquivo</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 transition-colors cursor-pointer">
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">Arraste o arquivo ou clique para selecionar</p>
              <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls, .pdf — máx 50MB</p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Fornecedor</label>
                <Select value={fornecedor} onValueChange={setFornecedor}>
                  <SelectTrigger><SelectValue placeholder="Selecionar fornecedor" /></SelectTrigger>
                  <SelectContent>
                    {fornecedores.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tipo de Arquivo</label>
                <Select value={tipoArquivo} onValueChange={setTipoArquivo}>
                  <SelectTrigger><SelectValue placeholder="Selecionar tipo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="excel"><div className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> Excel</div></SelectItem>
                    <SelectItem value="pdf-tabela"><div className="flex items-center gap-2"><FileText className="h-4 w-4" /> PDF Tabela</div></SelectItem>
                    <SelectItem value="pdf-catalogo"><div className="flex items-center gap-2"><FileText className="h-4 w-4" /> PDF Catálogo</div></SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button className="w-full gradient-primary text-primary-foreground font-semibold" onClick={handleProcessar}>
              Processar Arquivo
            </Button>
          </CardContent>
        </Card>

        {uploaded && (
          <Card className="shadow-card">
            <CardHeader><CardTitle className="text-base">Resultado do Processamento</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Arquivo:</span><span className="font-medium">tabela_tramontina_marco2026.xlsx</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Fornecedor:</span><span className="font-medium">Tramontina</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Data:</span><span className="font-medium">15/03/2026</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Status:</span><StatusBadge status="processado" /></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Produtos detectados:</span><span className="font-bold text-primary">342</span></div>
              </div>
              <div className="bg-accent/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-success"><CheckCircle className="h-4 w-4" /> 320 produtos importados com sucesso</div>
                <div className="flex items-center gap-2 text-sm text-warning"><AlertCircle className="h-4 w-4" /> 15 produtos com campos incompletos</div>
                <div className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" /> 7 produtos com erro de formatação</div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1">Ver Base</Button>
                <Button size="sm" className="flex-1 gradient-primary text-primary-foreground">Exportar Mercos</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
