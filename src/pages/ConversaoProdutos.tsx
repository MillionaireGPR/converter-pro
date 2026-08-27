import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { classifyImageError } from "@/core/images/imageErrorClassifier";
import { ConferenciaColunas } from "@/components/ConferenciaColunas";
import type { ColumnMappings } from "@/core/supplierRules/applyColumnMappings";
import { getBackendUrl, backendLabel } from "@/core/backendResolver";
import JSZip from "jszip";
import { saveAs } from "file-saver";

/**
 * Um catálogo em processamento (ou já processado) na fila de conversões
 * simultâneas (27/08/2026). Cada job roda de forma independente — o backend
 * já enfileira sozinho além do limite real (`MAX_CONCURRENT_JOBS`: 3 no
 * servidor do Wesley, 1 no fallback Render), então o frontend só precisa
 * disparar cada job e acompanhar seu próprio estado, sem gerenciar fila
 * aqui também.
 */
interface CatalogJob {
  id: string;
  file: File;
  // Snapshot do formulário no momento em que o job foi criado — o
  // formulário é limpo e reaproveitado pro próximo catálogo logo em
  // seguida, então o job não pode depender do estado do componente.
  fornecedorSelecionado: string; // id do fornecedor ou 'novo'
  novoFornecedorNome: string;
  regrasNovoFornecedor: string;
  mappingsNovoFornecedor: ColumnMappings;
  tipoArquivo: string; // só decorativo (ícone do painel)
  fornecedorNome: string;
  status: 'processing' | 'done' | 'error';
  progress: number;
  progressMsg: string;
  startedAt: number;
  elapsedSec: number;
  finalElapsedSec: number | null;
  errorMsg: string | null;
  resultData: { total: number; ok: number; pendentes: number; erros: number; duplicados: number; fileName: string; fornNome: string } | null;
  importMeta: ImportMetadata | null;
  imageResult: ResultadoExtracaoImagens | null;
  isZipping: boolean;
}

export default function ConversaoProdutos() {
  const { setDetectedHeaders } = useApp();
  const { fornecedores, salvarMapeamentoColuna, updateFornecedor } = useFornecedores();
  const { registrarHistorico, salvarConversao, conversoesSalvas, reabrirConversao, excluirConversao } = useHistorico();
  const { addProdutosNormalizados, setProdutosPadronizados } = useProdutos();
  const [fornecedor, setFornecedor] = useState("");
  const [novoFornecedor, setNovoFornecedor] = useState("");
  const [tipoArquivo, setTipoArquivo] = useState("");
  // Particularidades/mapeamento escritos NA HORA do upload (26/08/2026) —
  // antes só dava pra configurar depois, numa segunda visita a Fornecedores
  // ou Regras de Colunas. Pedido do Gabriel: se já vai subir um catálogo
  // novo, quer escrever a regra no mesmo passo, sem precisar voltar depois.
  const [regrasNovoFornecedor, setRegrasNovoFornecedor] = useState("");
  const [mappingsNovoFornecedor, setMappingsNovoFornecedor] = useState<ColumnMappings>({});
  const [regrasExistente, setRegrasExistente] = useState("");
  const [salvandoRegrasExistente, setSalvandoRegrasExistente] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [reabrindoId, setReabrindoId] = useState<string | null>(null);
  // Zipping do botão "baixar imagens" no HISTÓRICO — ação isolada (um item
  // por vez), não faz parte da fila de jobs de conversão.
  const [isZippingHistorico, setIsZippingHistorico] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Fila de conversões em paralelo (27/08/2026) — pedido do Gabriel após
  // reunião com o Josef: o servidor do Wesley processa até 3 catálogos ao
  // mesmo tempo (autoajustado por RAM, ver MAX_CONCURRENT_JOBS em main.py);
  // no fallback do Render, só 1. Cada catálogo vira um "job" independente
  // com seu próprio progresso/resultado — o formulário acima serve pra
  // CONFIGURAR o próximo job antes de adicioná-lo à fila.
  //
  // Um único array de estado (não N state hooks) porque o número de
  // catálogos é dinâmico — não dá pra ter useState fixo por catálogo.
  const [jobs, setJobs] = useState<CatalogJob[]>([]);
  // Handles de setInterval por job, fora do React state (senão cada patch
  // teria que carregar o handle junto pra não perdê-lo).
  const jobTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const atualizarJob = (id: string, patch: Partial<CatalogJob>) => {
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)));
  };

  // Ao trocar de fornecedor selecionado (existente), recarrega as
  // particularidades já salvas dele — senão a caixa mostraria o texto do
  // fornecedor anterior ou ficaria vazia mesmo já tendo regra salva.
  useEffect(() => {
    if (fornecedor && fornecedor !== 'novo') {
      setRegrasExistente(fornecedores.find(f => f.id === fornecedor)?.regrasExtracao || "");
    } else {
      setRegrasExistente("");
    }
  }, [fornecedor, fornecedores]);

  // "+ Novo" só existe durante ESTE upload — sai da tela, não faz sentido
  // manter o rascunho pro próximo fornecedor que for cadastrado.
  useEffect(() => {
    if (fornecedor !== 'novo') {
      setRegrasNovoFornecedor("");
      setMappingsNovoFornecedor({});
    }
  }, [fornecedor]);

  const salvarRegrasExistente = async () => {
    if (!fornecedor || fornecedor === 'novo') return;
    setSalvandoRegrasExistente(true);
    try {
      await updateFornecedor(fornecedor, { regrasExtracao: regrasExistente.trim() });
      toast.success("Particularidades salvas para este fornecedor.");
    } finally {
      setSalvandoRegrasExistente(false);
    }
  };

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

    setIsZippingHistorico(true);
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
      setIsZippingHistorico(false);
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

  /**
   * Processa UM catálogo isoladamente. Recebe tudo que precisa via `job` (não
   * lê `selectedFile`/`fornecedor`/etc. do componente) — o formulário pode já
   * ter sido reaproveitado pro PRÓXIMO catálogo enquanto este ainda roda.
   *
   * Não é `await`ado por quem chama: dispara e o job se atualiza sozinho via
   * `atualizarJob`. Vários jobs chamam isso ao mesmo tempo sem conflito
   * porque cada um só mexe na sua própria entrada em `jobs`.
   */
  const processarCatalogo = async (job: CatalogJob) => {
    const file = job.file;
    jobTimersRef.current[job.id] = setInterval(() => {
      atualizarJob(job.id, { elapsedSec: Math.floor((Date.now() - job.startedAt) / 1000) });
    }, 500);

    try {
      let supplier = fornecedores.find(f => f.id === job.fornecedorSelecionado);
      let supplierId = supplier?.id;

      if (job.fornecedorSelecionado === 'novo') {
        if (!job.novoFornecedorNome.trim()) throw new Error("Digite o nome do novo fornecedor");
        supplier = {
          id: '', // Será preenchido após o insert
          nome: job.novoFornecedorNome.trim(),
          tipoArquivo: detectFileType(file.name) === 'pdf' ? 'PDF' : 'Excel',
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
          frequency: supplier.frequencia,
          // Particularidades/mapeamento escritos na tela de upload (26/08/2026)
          // pro fornecedor novo já nascer configurado, sem precisar de uma
          // segunda visita a Fornecedores ou Regras de Colunas.
          ...(job.regrasNovoFornecedor.trim() ? { extraction_rules: job.regrasNovoFornecedor.trim() } : {}),
          ...(Object.keys(job.mappingsNovoFornecedor).length ? { column_mappings: job.mappingsNovoFornecedor } : {}),
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

      atualizarJob(job.id, { progress: 15, progressMsg: `Lendo e processando planilha de ${supplier.nome}...`, fornecedorNome: supplier.nome });
      console.log(`[Pipeline] Processando com pipeline V2 para: ${supplier.nome}`);

      // Progresso animado durante o processamento completo (pipeline + imagens).
      // OBS: é uma estimativa de tempo, não o status real do backend — se o
      // catálogo cair na fila do servidor (além do limite de jobs simultâneos),
      // essa barra sobe até ~90% e para ali até o resultado chegar de verdade.
      const imgProgressInterval = setInterval(() => {
        setJobs(prev => prev.map(j => {
          if (j.id !== job.id) return j;
          if (j.progress >= 90) return j;
          let msg = j.progressMsg;
          if (j.progress === 40) msg = 'Produtos identificados. Normalizando dados...';
          if (j.progress === 55) msg = 'Dados salvos. Extraindo imagens do PDF...';
          if (j.progress === 70) msg = 'Extraindo imagens (pode levar alguns minutos)...';
          if (j.progress === 80) msg = 'Finalizando extração de imagens...';
          return { ...j, progress: j.progress + 1, progressMsg: msg };
        }));
      }, 2000); // Avança 1% a cada 2 segundos

      // Pipeline V2: aceita File diretamente (Excel, CSV ou PDF).
      // columnMappings = colunas que o CLIENTE configurou pra este fornecedor
      // na tela de Regras; vencem a detecção automática (só afeta planilhas).
      const result = await processarArquivoV2(
        file,
        supplierId,
        supplier.nome,
        supplier.columnMappings,
        supplier.regrasExtracao
      );
      clearInterval(imgProgressInterval);

      atualizarJob(job.id, { progress: 92, progressMsg: `${result.produtos.length} produtos processados! Salvando...` });
      setDetectedHeaders(result.metadata.camposDetectados);

      console.log(`[Pipeline] ${result.produtos.length} produtos. Parser: ${result.metadata.parserUsado}`);

      // Salva no contexto e no Supabase
      await addProdutosNormalizados(result.produtos);
      atualizarJob(job.id, { progress: 95, progressMsg: 'Salvando no histórico...' });

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
        arquivo: file.name,
        fornecedor: supplier.nome,
        produtos: produtosParaSalvar,
        imagens: imagensParaSalvar,
        headers: result.metadata.camposDetectados,
        totalProdutos: result.produtos.length,
        status: 'concluído',
        zipUrl: result.imageResults?.zipUrl // Salvar URL do ZIP do backend
      });

      // Tempo total da conversão (preciso, via timestamp de início) — fixado
      // ANTES do histórico para registrar o tempo no log (monitoramento de
      // tempos/erros conforme o cliente usa a ferramenta).
      const totalSec = Math.max(1, Math.round((Date.now() - job.startedAt) / 1000));

      // Registra histórico no banco. Tudo embutido no tipoConversao (sem
      // migração de schema), no formato:
      //   "Importação (pdf-ai-first · IA) · 4:54 · proprio"
      // Os 3 dados servem pra diagnosticar um problema relatado pelo cliente
      // SEM precisar pedir print (14/08/2026): se usou IA ou só o parser
      // Python, quanto demorou, e em QUAL servidor rodou (pra correlacionar
      // com quedas do servidor próprio vs fallback no Render).
      const usouIA = /ai-first|gemini/i.test(result.metadata.parserUsado || '');
      const servidor = backendLabel(await getBackendUrl());
      await registrarHistorico({
        arquivo: file.name,
        fornecedor: supplier.nome,
        usuario: 'Admin',
        data: new Date().toISOString().replace('T', ' ').substring(0, 16),
        tipoConversao:
          `Importação (${result.metadata.parserUsado} · ${usouIA ? 'IA' : 'sem IA'})` +
          ` · ${fmtTempo(totalSec)} · ${servidor}`,
        qtdItens: result.produtos.length,
        status: 'concluído',
      });

      atualizarJob(job.id, {
        progress: 100,
        status: 'done',
        finalElapsedSec: totalSec,
        importMeta: result.metadata,
        imageResult: result.imageResults || null,
        resultData: {
          total: result.stats.total,
          ok: result.stats.validados,
          pendentes: result.stats.pendentes,
          erros: result.stats.erros,
          duplicados: result.stats.duplicados,
          fileName: file.name,
          fornNome: result.metadata.fornecedorDetectado || result.metadata.fornecedorConfirmado || supplier.nome,
        },
      });
      toast.success(`Sucesso! ${result.stats.total} itens em ${fmtTempo(totalSec)} (${file.name}).`);

      // Extração de imagens pode falhar silenciosamente (ex: servidor reiniciou
      // por OOM em catálogo grande) sem que o pipeline de texto/preço seja afetado.
      // Antes disso não havia feedback visual — parecia "sucesso" mesmo sem imagens.
      // Ver: reunião 22/07/2026 (Josef) — "não teve feedback visual, servidor derrubou".
      const imgErros = result.imageResults?.errors;
      if (imgErros && imgErros.length > 0) {
        const info = classifyImageError(imgErros[0]);
        // Detalhe técnico só no console (pra suporte), com o mesmo código:
        console.error(`[${info.code}] Falha na extração de imagens:`, info.technical);
        toast.warning(`${info.friendly} (código ${info.code}) — ${file.name}`, { duration: 10000 });
      }
    } catch (error: any) {
      console.error(error);
      atualizarJob(job.id, { status: 'error', errorMsg: error.message || "Erro ao processar arquivo" });
      toast.error(`${error.message || "Erro ao processar arquivo"} (${file.name})`);
    } finally {
      const handle = jobTimersRef.current[job.id];
      if (handle) { clearInterval(handle); delete jobTimersRef.current[job.id]; }
    }
  };

  /** Adiciona o catálogo configurado no formulário à fila e limpa o
   *  formulário — o cliente já pode configurar o PRÓXIMO enquanto este roda.
   *  Não faz `await` do processamento: só dispara. */
  const handleProcessar = () => {
    if (!fornecedor) { toast.error("Selecione um fornecedor"); return; }
    if (!selectedFile) { toast.error("Selecione um arquivo para processar"); return; }
    if (fornecedor === 'novo' && !novoFornecedor.trim()) { toast.error("Digite o nome do novo fornecedor"); return; }

    const fornecedorExistente = fornecedores.find(f => f.id === fornecedor);
    const job: CatalogJob = {
      id: crypto.randomUUID(),
      file: selectedFile,
      fornecedorSelecionado: fornecedor,
      novoFornecedorNome: novoFornecedor,
      regrasNovoFornecedor,
      mappingsNovoFornecedor,
      fornecedorNome: fornecedor === 'novo' ? novoFornecedor.trim() : (fornecedorExistente?.nome || ''),
      tipoArquivo,
      status: 'processing',
      progress: 5,
      progressMsg: 'Preparando arquivo...',
      startedAt: Date.now(),
      elapsedSec: 0,
      finalElapsedSec: null,
      errorMsg: null,
      resultData: null,
      importMeta: null,
      imageResult: null,
      isZipping: false,
    };
    setJobs(prev => [job, ...prev]);
    void processarCatalogo(job);

    // Limpa o formulário pro próximo catálogo — cada job já levou consigo
    // tudo que precisava (file, fornecedor, regras, mappings).
    setSelectedFile(null);
    setFornecedor("");
    setNovoFornecedor("");
    setTipoArquivo("");
    setRegrasNovoFornecedor("");
    setMappingsNovoFornecedor({});
    setRegrasExistente("");
  };

  const atualizarJobZipping = (id: string, zipping: boolean) => atualizarJob(id, { isZipping: zipping });

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
                    setTipoArquivo(detectFileType(file.name) === 'pdf' ? 'pdf' : 'excel');
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
                    {/* Dropdown compacto e SEMPRE pra baixo (side=bottom, sem flip):
                        em 100% de zoom a lista inteira não cabia e estourava pra
                        cima; agora mostra ~4-5 itens com rolagem, ancorado abaixo. */}
                    <SelectContent position="popper" side="bottom" sideOffset={4} className="max-h-[200px]">
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

              {/* Conferência das colunas ANTES de converter (só planilha —
                  catálogo PDF não tem coluna). Nasceu do caso VAESO: a
                  quantidade saiu 1 em todos os itens e só foi percebido
                  depois de importar no Mercos. */}
              {selectedFile && tipoArquivo === 'excel' && fornecedor && fornecedor !== 'novo' && (
                <ConferenciaColunas
                  file={selectedFile}
                  supplierId={fornecedor}
                  supplierName={fornecedores.find(f => f.id === fornecedor)?.nome}
                  mappings={fornecedores.find(f => f.id === fornecedor)?.columnMappings}
                  onSalvar={(campo, coluna) => {
                    const forn = fornecedores.find(f => f.id === fornecedor);
                    if (!forn) return;
                    salvarMapeamentoColuna(forn.nome, campo, coluna);
                  }}
                />
              )}

              {/* Mesma conferência para fornecedor NOVO (26/08/2026) — ele
                  ainda não existe no banco, então guarda em memória e só
                  grava junto com o insert em handleProcessar. */}
              {selectedFile && tipoArquivo === 'excel' && fornecedor === 'novo' && novoFornecedor.trim() && (
                <ConferenciaColunas
                  file={selectedFile}
                  supplierName={novoFornecedor.trim()}
                  mappings={mappingsNovoFornecedor}
                  onSalvar={(campo, coluna) => {
                    setMappingsNovoFornecedor(prev => {
                      const atualizado = { ...prev };
                      if (coluna) atualizado[campo] = coluna; else delete atualizado[campo];
                      return atualizado;
                    });
                  }}
                />
              )}

              {/* Particularidades do catálogo PDF direto na hora do upload
                  (26/08/2026) — antes só dava pra escrever depois, voltando
                  em Fornecedores. Fornecedor novo: guarda em memória e entra
                  junto no insert. Fornecedor existente: salva na hora, igual
                  ao ajuste de coluna acima faz pra planilha. */}
              {tipoArquivo === 'pdf' && fornecedor === 'novo' && novoFornecedor.trim() && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Particularidades do catálogo (PDF)</label>
                  <Textarea
                    value={regrasNovoFornecedor}
                    onChange={e => setRegrasNovoFornecedor(e.target.value)}
                    placeholder='Ex.: "o preço aparece uma vez só no topo e vale pra todas as cores da página"'
                    className="text-sm min-h-[70px]"
                  />
                </div>
              )}
              {tipoArquivo === 'pdf' && fornecedor && fornecedor !== 'novo' && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Particularidades do catálogo (PDF)</label>
                  <Textarea
                    value={regrasExistente}
                    onChange={e => setRegrasExistente(e.target.value)}
                    placeholder='Ex.: "o preço aparece uma vez só no topo e vale pra todas as cores da página"'
                    className="text-sm min-h-[70px]"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={salvandoRegrasExistente}
                    onClick={salvarRegrasExistente}
                  >
                    {salvandoRegrasExistente ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                    Salvar particularidades
                  </Button>
                </div>
              )}

              <Button
                className="w-full gradient-primary text-primary-foreground font-semibold h-9 shadow-sm"
                onClick={handleProcessar}
              >
                Processar Arquivo
              </Button>
              {jobs.some(j => j.status === 'processing') && (
                <p className="text-[10px] text-muted-foreground text-center pt-1">
                  {jobs.filter(j => j.status === 'processing').length} catálogo(s) em andamento — pode configurar e
                  adicionar outro agora mesmo. O servidor processa até 3 ao mesmo tempo (1 no modo de reserva).
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Coluna da Direita: fila de conversões (um painel por catálogo) + Histórico */}
        <div className="xl:col-span-5 space-y-3">
          {jobs.map(job => (
            <Card
              key={job.id}
              className={`shadow-card overflow-hidden border-l-4 ${
                job.status === 'error' ? 'border-l-destructive' : job.status === 'done' ? 'border-l-success' : 'border-l-primary'
              }`}
            >
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-semibold flex items-center gap-2">
                  {job.tipoArquivo === 'pdf' ? <FileText className="h-3.5 w-3.5 text-destructive shrink-0" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-success shrink-0" />}
                  <span className="truncate" title={job.file.name}>{job.file.name}</span>
                  <span className="ml-auto shrink-0">
                    {job.status === 'processing' && <Badge variant="outline" className="text-[10px] gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin" /> {fmtTempo(job.elapsedSec)}</Badge>}
                    {job.status === 'done' && <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20">concluído</Badge>}
                    {job.status === 'error' && <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20">erro</Badge>}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-2">
                <p className="text-[11px] text-muted-foreground">{job.fornecedorNome || 'fornecedor novo'}</p>

                {job.status === 'processing' && (
                  <>
                    {/* Barra INDETERMINADA (sweep) — mostra atividade sem fingir % real do
                        backend (ver comentário em processarCatalogo sobre a fila). */}
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-1/3 rounded-full bg-primary animate-[indeterminate_1.4s_ease-in-out_infinite]" />
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-foreground font-medium rounded p-2 bg-muted/50">
                      <FileIcon className="h-3 w-3 text-primary shrink-0" />
                      <span>{job.progressMsg || 'Preparando...'}</span>
                    </div>
                  </>
                )}

                {job.status === 'error' && (
                  <p className="text-xs text-destructive">{job.errorMsg}</p>
                )}

                {job.status === 'done' && job.resultData && (
                  <>
                    <div className="text-center py-1">
                      <div className="text-3xl font-extrabold text-success mb-0.5">{job.resultData.total}</div>
                      <div className="flex items-center justify-center gap-1 text-xs">
                        <CheckCircle className="h-3.5 w-3.5 text-success" />
                        <span className="text-success font-medium">{job.resultData.ok} importados com sucesso</span>
                      </div>
                      {job.finalElapsedSec != null && (
                        <div className="flex items-center justify-center gap-1 text-xs mt-1 text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>Convertido em <span className="font-semibold text-foreground tabular-nums">{fmtTempo(job.finalElapsedSec)}</span></span>
                        </div>
                      )}
                      {(job.resultData.pendentes > 0 || job.resultData.erros > 0 || job.resultData.duplicados > 0) && (
                        <div className="flex flex-wrap justify-center gap-2 mt-2 pt-2 border-t border-dashed">
                          {job.resultData.pendentes > 0 && (
                            <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/20">{job.resultData.pendentes} pendentes</Badge>
                          )}
                          {job.resultData.erros > 0 && (
                            <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20">{job.resultData.erros} erros</Badge>
                          )}
                          {job.resultData.duplicados > 0 && (
                            <Badge variant="outline" className="text-[10px] bg-muted">{job.resultData.duplicados} duplicados</Badge>
                          )}
                        </div>
                      )}
                    </div>

                    {job.importMeta && (
                      <div className="text-[11px] text-muted-foreground flex items-center justify-between border-t border-dashed pt-1.5">
                        <span>Parser:</span>
                        <Badge variant="outline" className="text-[10px] h-4 px-1">{job.importMeta.parserUsado}</Badge>
                      </div>
                    )}

                    {/* Imagens extraídas (se houver) */}
                    {job.imageResult && (job.imageResult.zipUrl || job.imageResult.totalImagesFound > 0 || (job.imageResult.errors && job.imageResult.errors.length > 0)) && (
                      <div className={`text-xs rounded-lg border p-2 space-y-1 ${job.imageResult.errors?.length ? 'border-destructive/30 bg-destructive/5' : 'border-primary/20 bg-primary/5'}`}>
                        {job.imageResult.errors && job.imageResult.errors.length > 0 ? (
                          (() => {
                            const info = classifyImageError(job.imageResult!.errors![0]);
                            return (
                              <div className="space-y-1">
                                <div className="text-foreground">{info.friendly}</div>
                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                  <span>Código de suporte:</span>
                                  <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px] font-semibold text-foreground">{info.code}</code>
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Imagens:</span>
                            <span className="font-medium">
                              {job.imageResult.zipUrl ? 'ZIP pronto' : `${job.imageResult.totalImagesFound} extraídas`}
                              {(job.imageResult.totalImagesMatched || 0) > 0 && ` · ${job.imageResult.totalImagesMatched} associadas`}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Botões de Ação */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Button size="sm" className="h-8 gradient-success text-primary-foreground font-semibold shadow-sm" onClick={() => navigate('/exportacoes')}>
                        <ArrowRight className="h-3.5 w-3.5 mr-1" /> Exportar
                      </Button>
                      {job.imageResult?.zipUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-primary/30 bg-primary/5 hover:bg-primary/10"
                          onClick={() => {
                            window.open(job.imageResult!.zipUrl, '_blank');
                            toast.success("Download do ZIP iniciado!");
                          }}
                        >
                          <Download className="h-3.5 w-3.5 mr-1" /> Baixar ZIP
                        </Button>
                      )}
                      {job.imageResult?.unmatchedSkusDetails && job.imageResult.unmatchedSkusDetails.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-warning/50 bg-warning/10 text-warning hover:bg-warning/20 hover:text-warning"
                          onClick={() => {
                            const linhas = ["RELATÓRIO DE SKUS SEM IMAGEM\n============================"];
                            job.imageResult!.unmatchedSkusDetails!.forEach(det => {
                              linhas.push(`SKU: ${det.sku} | Página: ${det.page} | Motivo: ${det.reason}`);
                            });
                            const blob = new Blob([linhas.join('\n')], { type: "text/plain;charset=utf-8" });
                            saveAs(blob, `relatorio_falhas_match_${job.file.name}.txt`);
                            toast.success("Relatório de falhas baixado!");
                          }}
                        >
                          <Download className="h-3.5 w-3.5 mr-1" /> Falhas ({job.imageResult.unmatchedSkusDetails.length})
                        </Button>
                      )}
                      {!job.imageResult?.zipUrl && job.imageResult?.images && job.imageResult.images.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-primary/30 bg-primary/5 hover:bg-primary/10"
                          onClick={async () => {
                            atualizarJobZipping(job.id, true);
                            try {
                              const zip = new JSZip();
                              let adicionadas = 0;
                              for (const img of job.imageResult!.images) {
                                if (img.imageDataUrl && img.sku) {
                                  const base64Data = img.imageDataUrl.split(',')[1];
                                  if (base64Data) { zip.file(`${img.sku}.jpg`, base64Data, { base64: true }); adicionadas++; }
                                }
                              }
                              if (adicionadas === 0) { toast.error("Nenhuma imagem para download"); return; }
                              const zipBlob = await zip.generateAsync({ type: 'blob' });
                              const baseName = job.file.name.replace(/\.(xlsx|xls|csv)$/i, '');
                              saveAs(zipBlob, `${baseName}_imagens.zip`);
                              toast.success(`${adicionadas} imagens baixadas!`);
                            } catch (error) {
                              toast.error("Erro ao gerar ZIP: " + (error instanceof Error ? error.message : 'Erro'));
                            } finally {
                              atualizarJobZipping(job.id, false);
                            }
                          }}
                          disabled={job.isZipping}
                        >
                          <Download className="h-3.5 w-3.5 mr-1" />
                          {job.isZipping ? 'Gerando...' : `Baixar ${job.imageResult.totalImagesMatched} Imagens`}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}

        {/* Histórico */}
        {ultimasConversoes.length > 0 && (
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
                            disabled={isZippingHistorico}
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
