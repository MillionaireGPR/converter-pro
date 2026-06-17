import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Upload, FileSpreadsheet, FileText, CheckCircle, AlertCircle, ArrowRight, Loader2, File as FileIcon, Info, History, Image, RotateCcw, Trash2, Clock, Package, Download } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { useApp, Produto } from "@/context/AppContext";
import { useFornecedores } from "@/context/FornecedoresContext";
import { useHistorico } from "@/context/HistoricoContext";
import { useProdutos } from "@/context/ProdutosContext";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Progress } from "@/components/ui/progress";
import { processarArquivoV2, ConversionResultV2 } from "@/core/engine";
import { detectFileType } from "@/core/pipeline/fileDetector";
import { ACCEPTED_FILE_TYPES } from "@/core/pipeline/fileDetector";
import { importPipeline } from "@/core/pipeline";
import { supabase } from "@/integrations/supabase/client";
import { ImportMetadata } from "@/core/types/productPipeline";
import { Image as ImageIcon } from "lucide-react";
import { buildAndDownloadZip } from "@/core/images/imageZipBuilder";
import { ResultadoExtracaoImagens } from "@/core/images/imageTypes";
import JSZip from "jszip";
import { saveAs } from "file-saver";

export default function ConversaoProdutos() {
  const { setDetectedHeaders } = useApp();
  const { fornecedores } = useFornecedores();
  const { registrarHistorico, salvarConversao, conversoesSalvas, reabrirConversao, excluirConversao } = useHistorico();
  const { addProdutosNormalizados, setProdutosPadronizados } = useProdutos();
  const [fornecedor, setFornecedor] = useState("");
  const [novoFornecedor, setNovoFornecedor] = useState("");
  const [tipoArquivo, setTipoArquivo] = useState("");
  const [state, setState] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [finalElapsedSec, setFinalElapsedSec] = useState<number | null>(null); // tempo total fixado ao concluir
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resultData, setResultData] = useState<{ total: number; ok: number; pendentes: number; erros: number; duplicados: number; fileName: string; fornNome: string } | null>(null);
  const [importMeta, setImportMeta] = useState<ImportMetadata | null>(null);
  const [imageResult, setImageResult] = useState<ResultadoExtracaoImagens | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [reabrindoId, setReabrindoId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Timer de progresso — conta segundos enquanto está processando.
  // Usa Date.now() (não soma de +1) p/ ser preciso mesmo se a aba ficar em 2º plano.
  useEffect(() => {
    if (state === 'processing') {
      setElapsedSec(0);
      setFinalElapsedSec(null);
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(
        () => setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000)),
        500
      );
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  // Formata segundos em "m:ss" (ex: 95 → "1:35")
  const fmtTempo = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // Pegar últimas 5 conversões
  const ultimasConversoes = conversoesSalvas.slice(0, 5);

  // Handler para reabrir conversão do histórico
  const handleReabrirDoHistorico = async (conversaoId: string) => {
    setReabrindoId(conversaoId);
    try {
      const conversao = await reabrirConversao(conversaoId);
      if (conversao) {
        if (conversao.produtos && conversao.produtos.length > 0) {
          setProdutosPadronizados(conversao.produtos);
        }
        if (conversao.headers && conversao.headers.length > 0) {
          setDetectedHeaders(conversao.headers);
        }
        toast.success("Conversão carregada! Redirecionando...");
        navigate('/base');
      }
    } catch (error) {
      toast.error("Erro ao reabrir conversão");
    } finally {
      setReabrindoId(null);
    }
  };

  // Handler para baixar imagens da conversão
  const handleBaixarImagensHistorico = async (conversaoId: string, nomeArquivo: string) => {
    console.log('[DownloadImagens] Iniciando download para conversão:', conversaoId);
    
    const conversao = conversoesSalvas.find(c => c.id === conversaoId);
    console.log('[DownloadImagens] Conversão encontrada:', conversao ? 'SIM' : 'NÃO');
    console.log('[DownloadImagens] Total de imagens na conversão:', conversao?.imagens?.length || 0);
    
    if (!conversao || !conversao.imagens || conversao.imagens.length === 0) {
      toast.error("Nenhuma imagem disponível para esta conversão");
      return;
    }

    // Log detalhado das imagens
    conversao.imagens.forEach((img, idx) => {
      console.log(`[DownloadImagens] Imagem ${idx}:`, {
        id: img.id,
        nome: img.nome,
        temUrl: !!img.url,
        urlInicio: img.url ? img.url.substring(0, 50) + '...' : 'SEM URL',
        ehDataUrl: img.url?.startsWith('data:') || false
      });
    });

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
      let erros = 0;
      
      for (let i = 0; i < conversao.imagens.length; i++) {
        const img = conversao.imagens[i];
        console.log(`[DownloadImagens] Processando imagem ${i + 1}/${conversao.imagens.length}: ${img.nome}`);
        
        if (!img.url) {
          console.warn(`[DownloadImagens] Imagem ${img.nome} sem URL`);
          erros++;
          continue;
        }
        
        // Verificar se é dataURL (base64)
        if (img.url.startsWith('data:')) {
          try {
            console.log(`[DownloadImagens] Convertendo dataURL para blob...`);
            
            // Extrair o tipo MIME e os dados base64
            const matches = img.url.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
            
            if (!matches || matches.length !== 3) {
              console.warn(`[DownloadImagens] Formato dataURL inválido para ${img.nome}`);
              erros++;
              continue;
            }
            
            const mimeType = matches[1];
            const base64Data = matches[2];
            
            console.log(`[DownloadImagens] MIME type: ${mimeType}, tamanho base64: ${base64Data.length}`);
            
            // Converter base64 para Uint8Array de forma mais eficiente
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            
            for (let j = 0; j < byteCharacters.length; j++) {
              byteNumbers[j] = byteCharacters.charCodeAt(j);
            }
            
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: mimeType });
            
            folder.file(img.nome, blob);
            adicionadas++;
            console.log(`[DownloadImagens] Imagem ${img.nome} adicionada com sucesso`);
          } catch (e) {
            console.error(`[DownloadImagens] Erro ao processar imagem ${img.nome}:`, e);
            erros++;
          }
        } else {
          // Se não for dataURL, tenta fetch
          console.log(`[DownloadImagens] Tentando fetch para URL: ${img.url.substring(0, 50)}...`);
          try {
            const response = await fetch(img.url);
            const blob = await response.blob();
            folder.file(img.nome, blob);
            adicionadas++;
            console.log(`[DownloadImagens] Imagem ${img.nome} baixada via fetch`);
          } catch (e) {
            console.error(`[DownloadImagens] Erro ao baixar imagem ${img.nome}:`, e);
            erros++;
          }
        }
      }

      console.log(`[DownloadImagens] Resumo: ${adicionadas} adicionadas, ${erros} erros`);

      if (adicionadas === 0) {
        toast.error(`Nenhuma imagem pôde ser baixada. ${erros} imagens com erro.`);
        return;
      }

      console.log('[DownloadImagens] Gerando ZIP...');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      console.log(`[DownloadImagens] ZIP gerado: ${zipBlob.size} bytes`);
      
      saveAs(zipBlob, `${folderName}_imagens.zip`);
      toast.success(`${adicionadas} imagens baixadas! ${erros > 0 ? `(${erros} com erro)` : ''}`);
    } catch (error) {
      console.error("[DownloadImagens] Erro ao criar ZIP:", error);
      toast.error("Erro ao gerar arquivo ZIP: " + (error instanceof Error ? error.message : 'Erro desconhecido'));
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
    setProgress(5);
    setProgressMsg('Preparando arquivo...');
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

      setProgress(15);
      setProgressMsg(`Lendo e processando planilha de ${supplier.nome}...`);
      console.log(`[Pipeline] Processando com pipeline V2 para: ${supplier.nome}`);

      // Progresso animado durante o processamento completo (pipeline + imagens)
      const imgProgressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) { clearInterval(imgProgressInterval); return prev; }
          // Atualiza mensagem conforme o progresso avança
          if (prev === 40) setProgressMsg('Produtos identificados. Normalizando dados...');
          if (prev === 55) setProgressMsg('Dados salvos. Extraindo imagens do PDF...');
          if (prev === 70) setProgressMsg('Extraindo imagens (pode levar alguns minutos)...');
          if (prev === 80) setProgressMsg('Finalizando extração de imagens...');
          return prev + 1;
        });
      }, 2000); // Avança 1% a cada 2 segundos

      // Pipeline V2: aceita File diretamente (Excel, CSV ou PDF)
      const result = await processarArquivoV2(selectedFile, supplierId, supplier.nome);
      clearInterval(imgProgressInterval);

      setProgress(92);
      setProgressMsg(`${result.produtos.length} produtos processados! Salvando...`);
      setImportMeta(result.metadata);
      setDetectedHeaders(result.metadata.camposDetectados);

      console.log(`[Pipeline] ${result.produtos.length} produtos. Parser: ${result.metadata.parserUsado}`);

      // Salva no contexto e no Supabase
      await addProdutosNormalizados(result.produtos);
      setProgress(95);
      setProgressMsg('Salvando no histórico...');

      // Preparar dados da conversão para salvar no histórico
      // Se backend retornou ZIP, salva a URL. Senão, salva imagens individuais
      const imagensParaSalvar = result.imageResults?.zipUrl 
        ? [{ id: 'zip', nome: 'imagens_extraidas.zip', url: result.imageResults.zipUrl, temporaryId: 'zip' }]
        : result.imageResults?.images?.map(img => ({
            id: img.sku,
            nome: img.imageFileNameFinal,
            url: img.imageDataUrl || '',
            temporaryId: img.sku
          })) || [];

      // ✅ NOVO: Criar mapa de SKU -> imagem extraída para vincular aos produtos
      const imagensPorSku = new Map<string, string>();
      result.imageResults?.images?.forEach(img => {
        if (img.imageDataUrl && img.sku) {
          imagensPorSku.set(img.sku, img.imageDataUrl);
          console.log(`[ConversaoProdutos] Imagem vinculada: ${img.sku} -> ${img.imageFileNameFinal}`);
        }
      });
      console.log(`[ConversaoProdutos] Total de imagens vinculadas a SKUs: ${imagensPorSku.size}`);

      // Mapear produtos normalizados para o formato de conversão
      // ✅ AGORA com imagens vinculadas do imageResults
      const produtosParaSalvar: Produto[] = result.produtos.map(p => {
        // Verificar se tem imagem vinculada a este SKU
        const imagemDoSku = imagensPorSku.get(p.codigo);
        const temImagemVinculada = !!imagemDoSku;
        
        return {
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
          imagemUrl: imagemDoSku || p.imagemUrl || '', // ✅ PRIORIDADE: imagem extraída > imagem do pipeline
          temImagem: temImagemVinculada || !!p.imagemUrl, // ✅ true se tem imagem vinculada OU do pipeline
        };
      });

      // Salvar conversão completa no histórico (localStorage)
      await salvarConversao({
        arquivo: selectedFile.name,
        fornecedor: supplier.nome,
        produtos: produtosParaSalvar,
        imagens: imagensParaSalvar,
        headers: result.metadata.camposDetectados,
        totalProdutos: result.produtos.length,
        status: 'concluído',
        zipUrl: result.imageResults?.zipUrl // Salvar URL do ZIP do backend
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
      // Fixa o tempo total da conversão (preciso, via timestamp de início)
      const totalSec = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
      setFinalElapsedSec(totalSec);
      setState('done');
      toast.success(`Sucesso! ${result.stats.total} itens em ${fmtTempo(totalSec)}.`);
    } catch (error: any) {
      console.error(error);
      setState('error');
      toast.error(error.message || "Erro ao processar arquivo");
    }
  };

  const resultStats = resultData;

  return (
    <div className="space-y-4">
      {/* Título compacto */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Conversão de Produtos</h1>
        <p className="text-xs text-muted-foreground">Envie arquivos de fornecedores para processamento automático</p>
      </div>

      {/* Grid principal: 12 colunas no desktop */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Coluna Esquerda: Upload + Formulário (7 colunas) */}
        <div className="xl:col-span-7 space-y-3">
          <Card className="shadow-card">
            <CardContent className="p-3 space-y-3">
              {/* Área de upload compacta - horizontal */}
              <div
                className={`border-2 border-dashed rounded-lg p-4 transition-all cursor-pointer ${
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
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shadow-sm ${selectedFile ? 'bg-success text-success-foreground' : 'gradient-primary text-primary-foreground'}`}>
                    {selectedFile ? <FileSpreadsheet className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {selectedFile ? selectedFile.name : 'Arraste ou clique para selecionar'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : '.xlsx, .xls, .csv, .pdf — máx 50MB'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Formulário em 2 colunas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Fornecedor</label>
                  <Select value={fornecedor} onValueChange={setFornecedor}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="novo" className="font-semibold text-primary">+ Novo</SelectItem>
                      {[...fornecedores].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {fornecedor === 'novo' && (
                    <Input 
                      placeholder="Nome do fornecedor" 
                      value={novoFornecedor}
                      onChange={e => setNovoFornecedor(e.target.value)}
                      className="h-8 text-sm mt-1 border-primary/50"
                    />
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Tipo de Arquivo</label>
                  <Select value={tipoArquivo} onValueChange={setTipoArquivo}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="excel"><div className="flex items-center gap-2"><FileSpreadsheet className="h-3.5 w-3.5 text-success" /> Excel / CSV</div></SelectItem>
                      <SelectItem value="pdf"><div className="flex items-center gap-2"><FileText className="h-3.5 w-3.5 text-destructive" /> PDF</div></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                className="w-full gradient-primary text-primary-foreground font-semibold h-9 shadow-sm"
                onClick={handleProcessar}
                disabled={state === 'processing'}
              >
                {state === 'processing' ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processando...</>
                ) : (
                  <>Processar Arquivo</>
                )}
              </Button>

              {/* Info do processamento (quando done) - compacto */}
              {state === 'done' && resultData && (
                <div className="mt-3 pt-3 border-t border-dashed space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Arquivo:</span>
                    <span className="font-medium truncate max-w-[200px]" title={resultData.fileName}>{resultData.fileName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fornecedor:</span>
                    <span className="font-medium">{resultData.fornNome}</span>
                  </div>
                  {importMeta && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Parser:</span>
                        <Badge variant="outline" className="text-[10px] h-4 px-1">{importMeta.parserUsado}</Badge>
                      </div>
                      {importMeta.fornecedorDetectado && importMeta.fornecedorDetectado !== resultData.fornNome && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Detectado:</span>
                          <span className="text-muted-foreground italic">{importMeta.fornecedorDetectado}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Confiança:</span>
                        <span className="font-medium">{importMeta.confiancaExtracao}%</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-muted-foreground">Status:</span>
                    <StatusBadge status="processado" />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Coluna da Direita: Ações e Resumo (quando processing/done/error) ou Histórico (quando idle) */}
        <div className="xl:col-span-5 space-y-3">
          {/* Processing State */}
          {state === 'processing' && (
            <Card className="shadow-card overflow-hidden border-l-2 border-l-primary">
              <CardContent className="p-4 space-y-3">
                {/* CRONÔMETRO ao vivo — sinal honesto de evolução em tempo real */}
                <div className="text-center">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Convertendo — tempo decorrido</div>
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span className="text-3xl font-extrabold text-primary tabular-nums">{fmtTempo(elapsedSec)}</span>
                  </div>
                </div>
                {/* Barra INDETERMINADA (sweep) — mostra atividade sem fingir % */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/3 rounded-full bg-primary animate-[indeterminate_1.4s_ease-in-out_infinite]" />
                </div>
                {/* Etapa atual (real) */}
                <div className="flex items-center gap-1.5 text-xs text-foreground font-medium rounded p-2 bg-muted/50">
                  <FileIcon className="h-3 w-3 text-primary shrink-0" />
                  <span>{progressMsg || 'Preparando...'}</span>
                </div>
                <p className="text-[10px] text-muted-foreground text-center">
                  Catálogos grandes podem levar alguns minutos — pode usar outras abas, o processo roda em segundo plano.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Done State - Total + Métricas + Ações */}
          {state === 'done' && resultData && resultStats && (
            <>
              {/* Card do Total Destacado */}
              <Card className="shadow-card overflow-hidden border-l-4 border-l-success bg-gradient-to-br from-success/5 to-background">
                <CardContent className="p-4 text-center">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Produtos Encontrados</div>
                  <div className="text-4xl font-extrabold text-success mb-1">{resultStats.total}</div>
                  <div className="flex items-center justify-center gap-1 text-xs">
                    <CheckCircle className="h-3.5 w-3.5 text-success" />
                    <span className="text-success font-medium">{resultStats.ok} importados com sucesso</span>
                  </div>
                  {finalElapsedSec != null && (
                    <div className="flex items-center justify-center gap-1 text-xs mt-1.5 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>Convertido em <span className="font-semibold text-foreground tabular-nums">{fmtTempo(finalElapsedSec)}</span></span>
                    </div>
                  )}
                  {(resultStats.pendentes > 0 || resultStats.erros > 0 || resultData.duplicados > 0) && (
                    <div className="flex flex-wrap justify-center gap-2 mt-2 pt-2 border-t border-dashed">
                      {resultStats.pendentes > 0 && (
                        <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/20">{resultStats.pendentes} pendentes</Badge>
                      )}
                      {resultStats.erros > 0 && (
                        <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20">{resultStats.erros} erros</Badge>
                      )}
                      {resultData.duplicados > 0 && (
                        <Badge variant="outline" className="text-[10px] bg-muted">{resultData.duplicados} duplicados</Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Métricas de Imagens (se houver) */}
              {/* ✅ CORREÇÃO: Mostrar tanto para ZIP (PDF/backend) quanto para imagens individuais (Excel) */}
              {imageResult && (imageResult.zipUrl || imageResult.totalImagesFound > 0) && (
                <Card className="shadow-card overflow-hidden border-l-4 border-l-primary">
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2">
                      <ImageIcon className="h-3.5 w-3.5 text-primary" /> 
                      {imageResult.zipUrl ? 'Imagens (Backend)' : 'Imagens Extraídas'}
                      <Badge variant="outline" className="ml-auto text-[10px] bg-primary/10">
                        {imageResult.totalImagesMatched || 0} associadas
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Total extraído:</span>
                      <span className="font-medium">{imageResult.totalImagesFound || 0}</span>
                    </div>
                    {imageResult.totalImagesUnmatched > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Não associadas:</span>
                        <span className="font-medium text-warning">{imageResult.totalImagesUnmatched}</span>
                      </div>
                    )}
                    {/* Mostrar avisos se houver */}
                    {imageResult.warnings && imageResult.warnings.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {imageResult.warnings.map((w, i) => (
                          <div key={i} className="truncate" title={w}>• {w}</div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Formato:</span>
                      <span className="font-medium text-success">
                        {imageResult.zipUrl ? 'ZIP pronto' : `${imageResult.totalImagesFound} imagens individuais`}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Botões de Ação */}
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" className="h-9 gradient-success text-primary-foreground font-semibold shadow-sm" onClick={() => navigate('/exportacoes')}>
                  <ArrowRight className="h-3.5 w-3.5 mr-1" /> Exportar
                </Button>
                {/* Botão ZIP (PDF/backend) */}
                {imageResult?.zipUrl && (
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="h-9 border-primary/30 bg-primary/5 hover:bg-primary/10"
                    onClick={() => {
                      window.open(imageResult.zipUrl, '_blank');
                      toast.success("Download do ZIP iniciado!");
                    }}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    Baixar ZIP
                  </Button>
                )}
                
                {/* NOVO: Botão Baixar Relatório (Sem Match) */}
                {imageResult?.unmatchedSkusDetails && imageResult.unmatchedSkusDetails.length > 0 && (
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="h-9 border-warning/50 bg-warning/10 text-warning hover:bg-warning/20 hover:text-warning"
                    onClick={() => {
                      const linhas = ["RELATÓRIO DE SKUS SEM IMAGEM\n============================"];
                      imageResult.unmatchedSkusDetails!.forEach(det => {
                        linhas.push(`SKU: ${det.sku} | Página: ${det.page} | Motivo: ${det.reason}`);
                      });
                      const blob = new Blob([linhas.join('\n')], { type: "text/plain;charset=utf-8" });
                      saveAs(blob, `relatorio_falhas_match.txt`);
                      toast.success("Relatório de falhas baixado!");
                    }}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    Relatório Falhas ({imageResult.unmatchedSkusDetails.length})
                  </Button>
                )}
                {/* ✅ NOVO: Botão Download Imagens (Excel - imagens individuais) */}
                {!imageResult?.zipUrl && imageResult?.images && imageResult.images.length > 0 && (
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="h-9 border-primary/30 bg-primary/5 hover:bg-primary/10"
                    onClick={async () => {
                      setIsZipping(true);
                      try {
                        const zip = new JSZip();
                        let adicionadas = 0;
                        
                        for (const img of imageResult.images) {
                          if (img.imageDataUrl && img.sku) {
                            const base64Data = img.imageDataUrl.split(',')[1];
                            if (base64Data) {
                              zip.file(`${img.sku}.jpg`, base64Data, { base64: true });
                              adicionadas++;
                            }
                          }
                        }
                        
                        if (adicionadas === 0) {
                          toast.error("Nenhuma imagem para download");
                          return;
                        }
                        
                        const zipBlob = await zip.generateAsync({ type: 'blob' });
                        const fileName = selectedFile?.name || 'planilha';
                        saveAs(zipBlob, `${fileName.replace('.xlsx', '').replace('.xls', '').replace('.csv', '')}_imagens.zip`);
                        toast.success(`${adicionadas} imagens baixadas!`);
                      } catch (error) {
                        toast.error("Erro ao gerar ZIP: " + (error instanceof Error ? error.message : 'Erro'));
                      } finally {
                        setIsZipping(false);
                      }
                    }}
                    disabled={isZipping}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    {isZipping ? 'Gerando...' : `Baixar ${imageResult.totalImagesMatched} Imagens`}
                  </Button>
                )}
              </div>
              
              <Button variant="outline" size="sm" className="w-full h-8 border-primary/20 text-primary hover:bg-primary/5" onClick={() => navigate('/base')}>
                Ver Base Completa <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </>
          )}

        {/* Histórico (apenas quando idle) */}
        {state === 'idle' && ultimasConversoes.length > 0 && (
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
                          {conversao.zipUrl && (
                            <>
                              <span>•</span>
                              <span className="text-success font-medium">ZIP</span>
                            </>
                          )}
                          {conversao.imagens && conversao.imagens.length > 0 && !conversao.zipUrl && (
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
                        
                        {/* Botão Baixar ZIP (quando processado via backend) */}
                        {conversao.zipUrl && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-success"
                            onClick={() => window.open(conversao.zipUrl, '_blank')}
                            title="Baixar ZIP de imagens"
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                        )}
                        
                        {/* Botão Baixar Imagens (quando tem imagens individuais) */}
                        {conversao.imagens && conversao.imagens.length > 0 && !conversao.zipUrl && (
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
          )}
        </div>
      </div>
    </div>
  );
}
