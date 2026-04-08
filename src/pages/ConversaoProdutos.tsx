import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Upload, FileSpreadsheet, FileText, CheckCircle, AlertCircle, ArrowRight, Loader2, File as FileIcon, Info, History, Image, RotateCcw, Trash2, Clock, Package } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { useApp, Produto } from "@/context/AppContext";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Progress } from "@/components/ui/progress";
import { processarArquivoV2, ConversionResultV2 } from "@/core/engine";
import { detectFileType } from "@/core/pipeline/fileDetector";
import { ACCEPTED_FILE_TYPES } from "@/core/pipeline/fileDetector";
import { importPipeline } from "@/core/pipeline";
import { supabase } from "@/integrations/supabase/client";
import { ImportMetadata } from "@/core/types/productPipeline";
import { Image as ImageIcon, Download } from "lucide-react";
import { buildAndDownloadZip } from "@/core/images/imageZipBuilder";
import { ResultadoExtracaoImagens } from "@/core/images/imageTypes";

export default function ConversaoProdutos() {
  const { fornecedores, addProdutosNormalizados, registrarHistorico, setDetectedHeaders, salvarConversao, conversoesSalvas, reabrirConversao, excluirConversao } = useApp();
  const [fornecedor, setFornecedor] = useState("");
  const [novoFornecedor, setNovoFornecedor] = useState("");
  const [tipoArquivo, setTipoArquivo] = useState("");
  const [state, setState] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resultData, setResultData] = useState<{ total: number; ok: number; pendentes: number; erros: number; duplicados: number; fileName: string; fornNome: string } | null>(null);
  const [importMeta, setImportMeta] = useState<ImportMetadata | null>(null);
  const [imageResult, setImageResult] = useState<ResultadoExtracaoImagens | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [reabrindoId, setReabrindoId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Pegar últimas 5 conversões
  const ultimasConversoes = conversoesSalvas.slice(0, 5);

  // Handler para reabrir conversão do histórico
  const handleReabrirDoHistorico = async (conversaoId: string) => {
    setReabrindoId(conversaoId);
    try {
      await reabrirConversao(conversaoId);
      toast.success("Conversão carregada! Redirecionando...");
      navigate('/base');
    } catch (error) {
      toast.error("Erro ao reabrir conversão");
    } finally {
      setReabrindoId(null);
    }
  };

  // Handler para baixar imagens da conversão
  const handleBaixarImagensHistorico = async (conversaoId: string, nomeArquivo: string) => {
    const conversao = conversoesSalvas.find(c => c.id === conversaoId);
    if (!conversao || !conversao.imagens || conversao.imagens.length === 0) {
      toast.error("Nenhuma imagem disponível para esta conversão");
      return;
    }

    setIsZipping(true);
    try {
      const JSZip = (await import('jszip')).default;
      const { saveAs } = await import('file-saver');
      const zip = new JSZip();
      
      // Criar pasta com nome do arquivo
      const folderName = nomeArquivo.replace(/\.[^/.]+$/, "");
      const folder = zip.folder(folderName);
      
      if (!folder) throw new Error("Erro ao criar pasta no ZIP");

      // Adicionar cada imagem - converte base64 direto para blob
      let adicionadas = 0;
      for (const img of conversao.imagens) {
        if (img.url && img.url.startsWith('data:')) {
          try {
            // Converter dataURL (base64) direto para blob
            const base64Data = img.url.split(',')[1];
            if (base64Data) {
              const byteCharacters = atob(base64Data);
              const byteArrays = [];
              for (let i = 0; i < byteCharacters.length; i++) {
                byteArrays.push(byteCharacters.charCodeAt(i));
              }
              const byteArray = new Uint8Array(byteArrays);
              const blob = new Blob([byteArray], { type: 'image/jpeg' });
              folder.file(img.nome, blob);
              adicionadas++;
            }
          } catch (e) {
            console.warn(`Não foi possível processar imagem ${img.nome}:`, e);
          }
        } else if (img.url) {
          // Se não for dataURL, tenta fetch
          try {
            const response = await fetch(img.url);
            const blob = await response.blob();
            folder.file(img.nome, blob);
            adicionadas++;
          } catch (e) {
            console.warn(`Não foi possível baixar imagem ${img.nome}:`, e);
          }
        }
      }

      if (adicionadas === 0) {
        toast.error("Nenhuma imagem pôde ser baixada");
        return;
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, `${folderName}_imagens.zip`);
      toast.success(`${adicionadas} imagens baixadas!`);
    } catch (error) {
      console.error("Erro ao criar ZIP:", error);
      toast.error("Erro ao gerar arquivo ZIP");
    } finally {
      setIsZipping(false);
    }
  };

  // Handler para excluir conversão
  const handleExcluirConversaoHistorico = async (conversaoId: string) => {
    if (!confirm("Tem certeza que deseja excluir esta conversão do histórico?")) return;
    try {
      await excluirConversao(conversaoId);
      toast.success("Conversão removida do histórico");
    } catch (error) {
      toast.error("Erro ao excluir conversão");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const detected = detectFileType(file.name);
      setTipoArquivo(detected === 'pdf' ? 'pdf' : 'excel');
      console.log(`[Pipeline] Arquivo selecionado: ${file.name} (${detected}), ${file.size} bytes`);
      toast.success(`Arquivo ${file.name} selecionado!`);
    }
  };

  const handleProcessar = async () => {
    if (!fornecedor) { toast.error("Selecione um fornecedor"); return; }
    if (!selectedFile) { toast.error("Selecione um arquivo para processar"); return; }

    setState('processing');
    setProgress(10);
    setImportMeta(null);

    try {
      let supplier = fornecedores.find(f => f.id === fornecedor);
      let supplierId = supplier?.id;

      if (fornecedor === 'novo') {
        if (!novoFornecedor.trim()) throw new Error("Digite o nome do novo fornecedor");
        supplier = {
          id: '', // Será preenchido após o insert
          nome: novoFornecedor.trim(),
          tipoArquivo: detectFileType(selectedFile.name) === 'pdf' ? 'PDF' : 'Excel',
          frequencia: "Eventual",
          descontoPadrao: 0,
          ipiPadrao: 0,
          ultimoProcessamento: new Date().toISOString(),
          totalProdutos: 0,
          status: "ativo"
        };
        console.log(`[Pipeline] Fornecedor dinâmico: ${supplier.nome}`);

        const { data: newSupplierData, error: insertError } = await supabase.from('suppliers').insert({
          name: supplier.nome,
          file_type: supplier.tipoArquivo,
          status: supplier.status,
          frequency: supplier.frequencia
        }).select().single();

        if (insertError) {
          if (insertError.code === '23505') {
             // Já existe um com esse nome, busca o ID dele
             const { data: existing } = await supabase.from('suppliers').select('id').eq('name', supplier.nome).single();
             if (existing) {
               supplierId = existing.id;
               supplier.id = existing.id;
             } else {
               throw new Error("Fornecedor já existe mas não pôde ser recuperado.");
             }
          } else {
            console.error("[Pipeline] Erro ao salvar fornecedor:", insertError);
            throw new Error("Falha ao registrar novo fornecedor no banco.");
          }
        } else if (newSupplierData) {
          supplierId = newSupplierData.id;
          supplier.id = newSupplierData.id;
        }
      }

      if (!supplier) throw new Error("Fornecedor não encontrado");
      if (!supplierId) throw new Error("ID do fornecedor não pôde ser resolvido para o relacionamento no banco.");

      setProgress(20);
      console.log(`[Pipeline] Processando com pipeline V2 para: ${supplier.nome}`);

      // Pipeline V2: aceita File diretamente (Excel, CSV ou PDF)
      const result = await processarArquivoV2(selectedFile, supplierId, supplier.nome);

      setProgress(60);
      setImportMeta(result.metadata);
      setDetectedHeaders(result.metadata.camposDetectados);

      console.log(`[Pipeline] ${result.produtos.length} produtos. Parser: ${result.metadata.parserUsado}`);

      // Salva no contexto e no Supabase
      await addProdutosNormalizados(result.produtos);
      setProgress(85);

      // Preparar dados da conversão para salvar no histórico
      // CORREÇÃO: Usar result.imageResults.images (ImagemAssociadaProduto)
      const imagensParaSalvar = result.imageResults?.images?.map(img => ({
        id: img.sku,
        nome: img.imageFileNameFinal,
        url: img.imageDataUrl || '',
        temporaryId: img.sku
      })) || [];

      // Mapear produtos normalizados para o formato de conversão
      const produtosParaSalvar: Produto[] = result.produtos.map(p => ({
        id: p.codigo || p.codigoOriginal,
        fornecedor: supplier.nome,
        codigoOriginal: p.codigoOriginal,
        codigoFinal: p.codigo || p.codigoOriginal,
        nome: p.nome,
        descricao: p.descricaoComplementar || '',
        precoBase: p.precoBase,
        descontoPercentual: p.descontoPercentual || 0,
        precoFinal: p.precoFinal,
        ipi: p.ipi || 0,
        unidade: p.unidade,
        qtdCaixa: p.quantidadeCaixa,
        categoria: p.categoria || '',
        embalagem: p.embalagem || '',
        status: p.status as any,
        erros: p.erros || [],
        imagemUrl: p.imagemUrl || '',
        temImagem: !!p.imagemUrl,
      }));

      // Salvar conversão completa no histórico (localStorage)
      await salvarConversao({
        arquivo: selectedFile.name,
        fornecedor: supplier.nome,
        produtos: produtosParaSalvar,
        imagens: imagensParaSalvar,
        headers: result.metadata.camposDetectados,
        totalProdutos: result.produtos.length,
        status: 'concluído'
      });

      // Registra histórico no banco
      await registrarHistorico({
        arquivo: selectedFile.name,
        fornecedor: supplier.nome,
        usuario: 'Admin',
        data: new Date().toISOString().replace('T', ' ').substring(0, 16),
        tipoConversao: `Importação (${result.metadata.parserUsado})`,
        qtdItens: result.produtos.length,
        status: 'concluído',
      });

      setResultData({
        total: result.stats.total,
        ok: result.stats.validados,
        pendentes: result.stats.pendentes,
        erros: result.stats.erros,
        duplicados: result.stats.duplicados,
        fileName: selectedFile.name,
        fornNome: result.metadata.fornecedorDetectado || result.metadata.fornecedorConfirmado || supplier.nome
      });

      if (result.imageResults) {
        setImageResult(result.imageResults);
      } else {
        setImageResult(null);
      }

      setProgress(100);
      setState('done');
      toast.success(`Sucesso! ${result.stats.total} itens processados e salvos.`);
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

<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Coluna da Esquerda: Upload */}
        <Card className="shadow-card lg:col-span-2">
          <CardContent className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
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
                accept={ACCEPTED_FILE_TYPES} 
                className="hidden" 
              />
              <div className={`w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center shadow-sm ${selectedFile ? 'bg-success text-success-foreground' : 'gradient-primary text-primary-foreground'}`}>
                {selectedFile ? <FileSpreadsheet className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
              </div>
              <p className="text-sm font-semibold text-foreground">
                {selectedFile ? selectedFile.name : 'Arraste ou clique para selecionar'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : '.xlsx, .xls, .csv, .pdf — máx 50MB'}
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
                    <SelectItem value="excel"><div className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-success" /> Excel / CSV</div></SelectItem>
                    <SelectItem value="pdf"><div className="flex items-center gap-2"><FileText className="h-4 w-4 text-destructive" /> PDF</div></SelectItem>
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
                    {importMeta && (
                      <>
                        <div className="flex justify-between py-1.5 border-b border-dashed"><span className="text-muted-foreground">Parser:</span><Badge variant="outline" className="text-[10px]">{importMeta.parserUsado}</Badge></div>
                        {importMeta.fornecedorDetectado && (
                          <div className="flex justify-between py-1.5 border-b border-dashed"><span className="text-muted-foreground">Detectado:</span><Badge variant="outline" className="text-[10px] bg-primary/10">{importMeta.fornecedorDetectado}</Badge></div>
                        )}
                        <div className="flex justify-between py-1.5 border-b border-dashed"><span className="text-muted-foreground">Confiança:</span><span className="font-medium text-sm">{importMeta.confiancaExtracao}%</span></div>
                      </>
                    )}
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
                      <div className="flex items-center gap-2 text-sm p-3 bg-destructive/5 border-b border-destructive/10">
                        <AlertCircle className="h-4 w-4 text-destructive" />
                        <span className="font-medium text-destructive">{resultStats.erros} produtos com erro</span>
                      </div>
                    )}
                    {resultData.duplicados > 0 && (
                      <div className="flex items-center gap-2 text-sm p-3 bg-muted/50">
                        <Info className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-muted-foreground">{resultData.duplicados} duplicados removidos</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Seção das Imagens */}
                  {imageResult && imageResult.totalImagesFound > 0 && (
                    <div className="rounded-xl border overflow-hidden mt-4">
                      <div className="flex items-center justify-between p-3 bg-primary/5 border-b border-primary/10">
                        <div className="flex items-center gap-2 text-sm">
                           <ImageIcon className="h-4 w-4 text-primary" />
                           <span className="font-semibold text-primary">Métricas de Imagens</span>
                        </div>
                        <Badge variant="outline">{imageResult.totalImagesFound} Mídias Encontradas</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-sm p-3 bg-background border-b">
                         <CheckCircle className="h-4 w-4 text-success" />
                         <span className="font-medium">{imageResult.totalImagesMatched} Imagens Associadas (SKU)</span>
                      </div>
                      {imageResult.totalImagesUnmatched > 0 && (
                        <div className="flex items-center gap-2 text-sm p-3 bg-muted/30">
                           <AlertCircle className="h-4 w-4 text-muted-foreground" />
                           <span className="font-medium text-muted-foreground">{imageResult.totalImagesUnmatched} Imagens Não Associadas</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1 border-primary/20 text-primary hover:bg-primary/5" onClick={() => navigate('/base')}>
                      Ver Base <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                    <Button size="sm" className="flex-1 gradient-success text-primary-foreground font-semibold shadow-sm" onClick={() => navigate('/exportacoes')}>
                      Exportar Mercos <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                  
                  {imageResult && imageResult.images.length > 0 && (
                    <div className="flex pt-2">
                      <Button 
                        size="sm" 
                        className="w-full gradient-primary text-primary-foreground shadow-sm"
                        disabled={isZipping}
                        onClick={async () => {
                           setIsZipping(true);
                           try {
                             await buildAndDownloadZip(imageResult, resultData.fornNome);
                           } catch(e) {
                             toast.error("Erro ao gerar arquivo de Imagens.");
                           } finally {
                             setIsZipping(false);
                           }
                        }}
                      >
                        {isZipping ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                        Baixar Zip Imagens
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Coluna da Direita: Histórico (apenas quando idle) */}
        {state === 'idle' && ultimasConversoes.length > 0 && (
          <div className="space-y-4">
            <Card className="shadow-card border-l-2 border-l-primary">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" />
                  Últimas Conversões
                  <Badge variant="secondary" className="ml-auto text-[10px]">{ultimasConversoes.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {ultimasConversoes.map((conversao) => (
                    <div 
                      key={conversao.id} 
                      className="px-3 py-2 flex items-center gap-2 hover:bg-accent/30 transition-colors group"
                    >
                      {/* Info compacta */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" title={conversao.arquivo}>
                          {conversao.arquivo.length > 25 ? conversao.arquivo.substring(0, 22) + '...' : conversao.arquivo}
                        </p>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span>{conversao.fornecedor}</span>
                          <span>•</span>
                          <span>{conversao.totalProdutos} prod</span>
                          {conversao.imagens && conversao.imagens.length > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-primary">{conversao.imagens.length} img</span>
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* Ações compactas */}
                      <div className="flex items-center gap-0.5">
                        {/* Botão Reabrir */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleReabrirDoHistorico(conversao.id)}
                          disabled={reabrindoId === conversao.id}
                          title="Reabrir base"
                        >
                          {reabrindoId === conversao.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                        </Button>
                        
                        {/* Botão Baixar Imagens */}
                        {conversao.imagens && conversao.imagens.length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-primary"
                            onClick={() => handleBaixarImagensHistorico(conversao.id, conversao.arquivo)}
                            disabled={isZipping}
                            title={`Baixar ${conversao.imagens.length} imagens`}
                          >
                            <Image className="h-3 w-3" />
                          </Button>
                        )}
                        
                        {/* Botão Excluir */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive/70 hover:text-destructive"
                          onClick={() => handleExcluirConversaoHistorico(conversao.id)}
                          title="Excluir"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
