import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Upload, FileSpreadsheet, FileText, CheckCircle, AlertCircle, ArrowRight, Loader2, File as FileIcon } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { useApp, Produto } from "@/context/AppContext";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Progress } from "@/components/ui/progress";
import * as XLSX from "xlsx";
import { processarArquivo as motorProcessar } from "@/core/engine";
import { findHeaderRowIndex } from "@/core/autoMapper";
import { supabase } from "@/integrations/supabase/client";

export default function ConversaoProdutos() {
  const { fornecedores, addProdutosNormalizados, registrarHistorico, setDetectedHeaders } = useApp();
  const [fornecedor, setFornecedor] = useState("");
  const [novoFornecedor, setNovoFornecedor] = useState("");
  const [tipoArquivo, setTipoArquivo] = useState("");
  const [state, setState] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resultData, setResultData] = useState<{ total: number; ok: number; pendentes: number; erros: number; fileName: string; fornNome: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setTipoArquivo("excel"); // Assume excel por padrão ao selecionar arquivo
      console.log(`[Flow MVP] Arquivo selecionado: ${file.name}, tamanho: ${file.size} bytes`);
      toast.success(`Arquivo ${file.name} selecionado!`);
    }
  };

  const handleProcessar = async () => {
    if (!fornecedor) { toast.error("Selecione um fornecedor"); return; }
    if (!selectedFile) { toast.error("Selecione um arquivo para processar"); return; }

    setState('processing');
    setProgress(10);

    try {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // --- DETECÇÃO INTELIGENTE DE CABEÇALHO ---
          // Primeiro lê como array bruto para pontuar as linhas
          const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
          const bestHeaderIndex = findHeaderRowIndex(rawRows);
          console.log(`[Flow MVP] Linha escolhida como cabeçalho real (0-indexed): ${bestHeaderIndex}`);
          
          const headers = (rawRows[bestHeaderIndex] || []).filter(h => h && typeof h === 'string');
          setDetectedHeaders(headers);

          // Depois lê os objetos ignorando o lixo visual acima do cabeçalho
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { range: bestHeaderIndex, blankrows: false }) as Record<string, any>[];
          
          // Lemos a estrutura espacial (2D Array) rigorosa pulando as mesmas 'blankrows' para perfeito pareamento de índices
          const structuralData = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: bestHeaderIndex, blankrows: false }) as any[][];

          console.log(`[Flow MVP] Leitura XLSX concluída corrompendo lixo. Linhas úteis extraídas: ${jsonData.length}`);
          console.log(`[Flow MVP] Headers finais processados:`, Object.keys(jsonData[0] || {}));
          console.log(`[Flow MVP] Preview da primeira linha limpa:`, jsonData[0]);
          setProgress(40);

          let supplier = fornecedores.find(f => f.id === fornecedor);
          
          if (fornecedor === 'novo') {
            if (!novoFornecedor.trim()) throw new Error("Digite o nome do novo fornecedor");
            const tempId = crypto.randomUUID();
            supplier = {
              id: tempId,
              nome: novoFornecedor.trim(),
              tipoArquivo: "Excel",
              frequencia: "Eventual",
              descontoPadrao: 0,
              ipiPadrao: 0,
              ultimoProcessamento: new Date().toISOString(),
              totalProdutos: 0,
              status: "ativo"
            };
            console.log(`[Flow MVP] Fornecedor dinâmico resolvido on-the-fly: ${supplier.nome}`);

            // Tenta salvar no banco passivamente
            supabase.from('suppliers').insert({
              name: supplier.nome,
              file_type: supplier.tipoArquivo,
              status: supplier.status,
              frequency: supplier.frequencia
            }).then(({error}) => {
               if(error && error.code !== '23505') console.error("[Flow MVP] Erro ao salvar fornecedor on-the-fly:", error);
            });
          }

          if (!supplier) throw new Error("Fornecedor não encontrado");

          // Processa usando o motor
          console.log(`[Flow MVP] Iniciando processamento automático para: ${supplier.nome}`);
          const result = motorProcessar(jsonData, supplier.id, supplier.nome, structuralData);
          
          console.log(`[Flow MVP] Produtos normalizados gerados: ${result.produtos.length}`, result.produtos.slice(0, 2));
          setProgress(60);

          // Salva no contexto e no Supabase (Aguardando)
          console.log(`[Flow MVP] Enviando dados para salvamento no Contexto/Supabase...`);
          await addProdutosNormalizados(result.produtos);
          
          setProgress(85);

          // Registra histórico (Aguardando)
          await registrarHistorico({
            arquivo: selectedFile.name,
            fornecedor: supplier.nome,
            usuario: 'Admin',
            data: new Date().toISOString().replace('T', ' ').substring(0, 16),
            tipoConversao: 'Importação de Produtos (Real)',
            qtdItens: result.produtos.length,
            status: 'concluído',
          });

          setResultData({
            total: result.stats.total,
            ok: result.stats.validados,
            pendentes: result.stats.pendentes,
            erros: result.stats.erros,
            fileName: selectedFile.name,
            fornNome: supplier.nome
          });

          setProgress(100);
          setState('done');
          toast.success(`Sucesso! ${result.stats.total} itens processados e salvos.`);
        } catch (innerError: any) {
          console.error(innerError);
          setState('error');
          toast.error(innerError.message || "Erro no salvamento dos dados");
        }
      };

      reader.onerror = () => {
        throw new Error("Erro na leitura do arquivo");
      };

      reader.readAsArrayBuffer(selectedFile);
    } catch (error: any) {
      console.error(error);
      setState('error');
      toast.error(error.message || "Erro ao processar arquivo");
    }
  };

  const resultStats = resultData;

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
              } ${selectedFile ? 'border-success/50 bg-success/5' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { 
                e.preventDefault();
                setDragOver(false); 
                const file = e.dataTransfer.files[0];
                if (file) {
                  setSelectedFile(file);
                  setTipoArquivo("excel");
                  toast.success(`Arquivo ${file.name} recebido!`);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept=".xlsx, .xls" 
                className="hidden" 
              />
              <div className={`w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-sm ${selectedFile ? 'bg-success text-success-foreground' : 'gradient-primary text-primary-foreground'}`}>
                {selectedFile ? <FileSpreadsheet className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
              </div>
              <p className="text-sm font-semibold text-foreground">
                {selectedFile ? selectedFile.name : 'Arraste o arquivo ou clique para selecionar'}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">
                {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : '.xlsx, .xls — máx 50MB'}
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Fornecedor</label>
                <div className="flex flex-col gap-2">
                  <Select value={fornecedor} onValueChange={setFornecedor}>
                    <SelectTrigger><SelectValue placeholder="Selecionar fornecedor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="novo" className="font-semibold text-primary">+ Novo Fornecedor</SelectItem>
                      {fornecedores.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {fornecedor === 'novo' && (
                    <Input 
                      placeholder="Nome do novo fornecedor (ex: Mondial)" 
                      value={novoFornecedor}
                      onChange={e => setNovoFornecedor(e.target.value)}
                      className="border-primary/50 focus-visible:ring-primary"
                    />
                  )}
                </div>
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
                      <FileIcon className="h-4 w-4" /> Lendo arquivo...
                    </div>
                    <div className="h-2 w-3/4 rounded bg-muted animate-pulse" />
                    <div className="h-2 w-1/2 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              )}

              {state === 'done' && resultData && resultStats && (
                <>
                  <div className="space-y-2.5 text-sm">
                    <div className="flex justify-between py-1.5 border-b border-dashed"><span className="text-muted-foreground">Arquivo:</span><span className="font-medium">{resultData.fileName}</span></div>
                    <div className="flex justify-between py-1.5 border-b border-dashed"><span className="text-muted-foreground">Fornecedor:</span><span className="font-medium">{resultData.fornNome}</span></div>
                    <div className="flex justify-between py-1.5 border-b border-dashed"><span className="text-muted-foreground">Status:</span><StatusBadge status="processado" /></div>
                    <div className="flex justify-between py-1.5"><span className="text-muted-foreground">Produtos detectados:</span><span className="font-extrabold text-lg text-primary">{resultStats.total}</span></div>
                  </div>
                  <div className="rounded-xl border overflow-hidden">
                    <div className="flex items-center gap-2 text-sm p-3 bg-success/5 border-b border-success/10">
                      <CheckCircle className="h-4 w-4 text-success" />
                      <span className="font-medium text-success">{resultStats.ok} produtos importados com sucesso</span>
                    </div>
                    {resultStats.pendentes > 0 && (
                      <div className="flex items-center gap-2 text-sm p-3 bg-warning/5 border-b border-warning/10">
                        <AlertCircle className="h-4 w-4 text-warning" />
                        <span className="font-medium text-warning">{resultStats.pendentes} produtos pendentes/incompletos</span>
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
