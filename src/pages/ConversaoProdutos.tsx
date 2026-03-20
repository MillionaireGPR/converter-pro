import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileSpreadsheet, FileText, CheckCircle, AlertCircle, ArrowRight, Loader2, File } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { useApp, Produto } from "@/context/AppContext";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Progress } from "@/components/ui/progress";

export default function ConversaoProdutos() {
  const { fornecedores, processarArquivo, addProdutos, registrarHistorico } = useApp();
  const [fornecedor, setFornecedor] = useState("");
  const [tipoArquivo, setTipoArquivo] = useState("");
  const [state, setState] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{ produtos: Produto[]; fornecedorNome: string; fileName: string } | null>(null);
  const navigate = useNavigate();

  const handleProcessar = () => {
    if (!fornecedor) { toast.error("Selecione um fornecedor"); return; }
    if (!tipoArquivo) { toast.error("Selecione o tipo de arquivo"); return; }

    setState('processing');
    setProgress(0);

    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          try {
            const res = processarArquivo(fornecedor, tipoArquivo);
            setResult(res);
            addProdutos(res.produtos);
            registrarHistorico({
              arquivo: res.fileName,
              fornecedor: res.fornecedorNome,
              usuario: 'Admin',
              data: new Date().toISOString().replace('T', ' ').substring(0, 16),
              tipoConversao: 'Importação de Produtos',
              qtdItens: res.produtos.length,
              status: 'concluído',
            });
            setState('done');
            toast.success(`Arquivo processado! ${res.produtos.length} produtos detectados.`);
          } catch {
            setState('error');
            toast.error("Erro ao processar arquivo");
          }
          return 100;
        }
        return prev + Math.random() * 15 + 5;
      });
    }, 300);
  };

  const resultStats = result ? {
    total: result.produtos.length,
    ok: result.produtos.filter(p => p.status === 'validado').length,
    incompletos: result.produtos.filter(p => p.status === 'pendente' || p.status === 'incompleto').length,
    erros: result.produtos.filter(p => p.status === 'erro').length,
  } : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Conversão de Produtos</h1>
        <p className="text-sm text-muted-foreground mt-1">Envie arquivos de fornecedores para processamento automático</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base font-semibold">Upload de Arquivo</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div
              className={`border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer ${
                dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-accent/30'
              }`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={() => { setDragOver(false); toast.info("Arquivo recebido!"); }}
            >
              <div className="w-14 h-14 rounded-2xl gradient-primary mx-auto mb-4 flex items-center justify-center shadow-sm">
                <Upload className="h-6 w-6 text-primary-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground">Arraste o arquivo ou clique para selecionar</p>
              <p className="text-xs text-muted-foreground mt-1.5">.xlsx, .xls, .pdf — máx 50MB</p>
            </div>

            <div className="space-y-4">
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
                    <SelectItem value="excel"><div className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-success" /> Excel</div></SelectItem>
                    <SelectItem value="pdf-tabela"><div className="flex items-center gap-2"><FileText className="h-4 w-4 text-destructive" /> PDF Tabela</div></SelectItem>
                    <SelectItem value="pdf-catalogo"><div className="flex items-center gap-2"><FileText className="h-4 w-4 text-warning" /> PDF Catálogo</div></SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              className="w-full gradient-primary text-primary-foreground font-semibold h-11 shadow-sm"
              onClick={handleProcessar}
              disabled={state === 'processing'}
            >
              {state === 'processing' ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processando...</>
              ) : (
                <>Processar Arquivo</>
              )}
            </Button>
          </CardContent>
        </Card>

        {state !== 'idle' && (
          <Card className="shadow-card overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                {state === 'processing' ? (
                  <><Loader2 className="h-4 w-4 animate-spin text-primary" /> Processando...</>
                ) : state === 'error' ? (
                  <><AlertCircle className="h-4 w-4 text-destructive" /> Erro no Processamento</>
                ) : (
                  <><CheckCircle className="h-4 w-4 text-success" /> Processamento Concluído</>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {state === 'processing' && (
                <div className="space-y-3">
                  <Progress value={Math.min(progress, 100)} className="h-2" />
                  <div className="rounded-lg p-4 space-y-2 bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <File className="h-4 w-4" /> Lendo arquivo...
                    </div>
                    <div className="h-2 w-3/4 rounded bg-muted animate-pulse" />
                    <div className="h-2 w-1/2 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              )}

              {state === 'done' && result && resultStats && (
                <>
                  <div className="space-y-2.5 text-sm">
                    <div className="flex justify-between py-1.5 border-b border-dashed"><span className="text-muted-foreground">Arquivo:</span><span className="font-medium">{result.fileName}</span></div>
                    <div className="flex justify-between py-1.5 border-b border-dashed"><span className="text-muted-foreground">Fornecedor:</span><span className="font-medium">{result.fornecedorNome}</span></div>
                    <div className="flex justify-between py-1.5 border-b border-dashed"><span className="text-muted-foreground">Status:</span><StatusBadge status="processado" /></div>
                    <div className="flex justify-between py-1.5"><span className="text-muted-foreground">Produtos detectados:</span><span className="font-extrabold text-lg text-primary">{resultStats.total}</span></div>
                  </div>
                  <div className="rounded-xl border overflow-hidden">
                    <div className="flex items-center gap-2 text-sm p-3 bg-success/5 border-b border-success/10">
                      <CheckCircle className="h-4 w-4 text-success" />
                      <span className="font-medium text-success">{resultStats.ok} produtos importados com sucesso</span>
                    </div>
                    {resultStats.incompletos > 0 && (
                      <div className="flex items-center gap-2 text-sm p-3 bg-warning/5 border-b border-warning/10">
                        <AlertCircle className="h-4 w-4 text-warning" />
                        <span className="font-medium text-warning">{resultStats.incompletos} produtos pendentes/incompletos</span>
                      </div>
                    )}
                    {resultStats.erros > 0 && (
                      <div className="flex items-center gap-2 text-sm p-3 bg-destructive/5">
                        <AlertCircle className="h-4 w-4 text-destructive" />
                        <span className="font-medium text-destructive">{resultStats.erros} produtos com erro</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate('/base')}>
                      Ver Base <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                    <Button size="sm" className="flex-1 gradient-success text-primary-foreground font-semibold shadow-sm" onClick={() => navigate('/exportacoes')}>
                      Exportar Mercos <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
