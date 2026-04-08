import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { ArrowRight, Plus, Trash2, Upload, FileSpreadsheet, Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import * as XLSX from 'xlsx';

export default function RegrasMapeamento() {
  const { regrasMapeamento, fornecedores, addRegra, updateRegra, removeRegra, detectedHeaders, setDetectedHeaders, conversoesSalvas } = useApp();
  const [searchParams] = useSearchParams();
  const [filtro, setFiltro] = useState(searchParams.get('fornecedor') || "todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ fornecedor: '', colunaOrigem: '', colunaDestino: '', tipo: 'direto' as 'direto' | 'formula' | 'fixo', valor: '' });
  
  // Novos estados para análise de arquivo
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [analiseEmAndamento, setAnaliseEmAndamento] = useState(false);
  const [headersDetectadosDoArquivo, setHeadersDetectadosDoArquivo] = useState<string[]>([]);
  const [sugestoesPreview, setSugestoesPreview] = useState<{colunaOrigem: string; colunaDestino: string; confianca: number}[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const f = searchParams.get('fornecedor');
    if (f) setFiltro(f);
  }, [searchParams]);

  const regrasFiltradas = filtro === "todos" ? regrasMapeamento : regrasMapeamento.filter(r => r.fornecedor === filtro);

  const openNew = () => {
    setEditId(null);
    setForm({ fornecedor: filtro !== 'todos' ? filtro : '', colunaOrigem: '', colunaDestino: '', tipo: 'direto', valor: '' });
    setDialogOpen(true);
  };

  const openEdit = (r: typeof regrasMapeamento[0]) => {
    setEditId(r.id);
    setForm({ fornecedor: r.fornecedor, colunaOrigem: r.colunaOrigem, colunaDestino: r.colunaDestino, tipo: r.tipo, valor: r.valor || '' });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.fornecedor || !form.colunaOrigem || !form.colunaDestino) { toast.error("Preencha todos os campos"); return; }
    if (editId) {
      updateRegra(editId, form);
      toast.success("Regra atualizada!");
    } else {
      addRegra(form);
      toast.success("Regra criada!");
    }
    setDialogOpen(false);
  };

  const handleRemove = (id: string) => {
    removeRegra(id);
    toast.success("Regra removida!");
  };

  // Função para analisar arquivo real e extrair headers
  const analisarArquivo = async (file: File): Promise<string[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          if (!data) {
            reject(new Error("Não foi possível ler o arquivo"));
            return;
          }
          
          const workbook = XLSX.read(data, { type: 'binary' });
          const primeiraAba = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[primeiraAba];
          
          // Extrair headers (primeira linha)
          const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
          const headers: string[] = [];
          
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: C });
            const cell = worksheet[cellAddress];
            if (cell && cell.v) {
              headers.push(String(cell.v).trim());
            }
          }
          
          resolve(headers);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
      reader.readAsBinaryString(file);
    });
  };

  // Função inteligente para sugerir regras baseada em análise de similaridade
  const gerarSugestoesInteligentes = (headers: string[]) => {
    const targets = [
      { 
        key: 'codigoOriginal', 
        words: ['código', 'referência', 'cod', 'ref', 'modelo', 'part', 'sku', 'item', 'produto', 'codigo', 'cod'],
        pesos: { exato: 1.0, inicio: 0.8, contem: 0.5 }
      },
      { 
        key: 'nome', 
        words: ['descrição', 'nome', 'produto', 'item', 'desc', 'descriçao', 'descr', 'denominacao', 'denominação'],
        pesos: { exato: 1.0, inicio: 0.8, contem: 0.5 }
      },
      { 
        key: 'precoBase', 
        words: ['preço', 'preco', 'valor', 'venda', 'vlr', 'tabela', 'pvp', 'pvpr', 'price', 'unitario', 'unitário'],
        pesos: { exato: 1.0, inicio: 0.8, contem: 0.5 }
      },
      { 
        key: 'quantidadeCaixa', 
        words: ['caixa', 'unidade', 'emb', 'qtd', 'quantidade', 'cx', 'embalagem', 'multiplo', 'múltiplo', 'pack'],
        pesos: { exato: 1.0, inicio: 0.8, contem: 0.5 }
      },
      { 
        key: 'ipi', 
        words: ['ipi', 'imposto', 'tax'],
        pesos: { exato: 1.0, inicio: 0.9, contem: 0.6 }
      },
      { 
        key: 'categoria', 
        words: ['categoria', 'grupo', 'familia', 'família', 'setor', 'tipo', 'class', 'classificacao'],
        pesos: { exato: 1.0, inicio: 0.8, contem: 0.5 }
      }
    ];

    const sugestoes: {colunaOrigem: string; colunaDestino: string; confianca: number}[] = [];
    
    targets.forEach(target => {
      // Verifica se já existe regra para esse destino
      const existe = regrasMapeamento.find(r => r.fornecedor === filtro && r.colunaDestino === target.key);
      if (existe) return;

      let melhorMatch: {header: string; score: number} | null = null;

      headers.forEach(header => {
        const headerLower = header.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        let score = 0;

        target.words.forEach(word => {
          const wordLower = word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          
          if (headerLower === wordLower) {
            score = Math.max(score, target.pesos.exato);
          } else if (headerLower.startsWith(wordLower)) {
            score = Math.max(score, target.pesos.inicio * 0.9);
          } else if (headerLower.includes(wordLower)) {
            score = Math.max(score, target.pesos.contem);
          }
        });

        if (score > 0 && (!melhorMatch || score > melhorMatch.score)) {
          melhorMatch = { header, score };
        }
      });

      if (melhorMatch && melhorMatch.score >= 0.4) {
        sugestoes.push({
          colunaOrigem: melhorMatch.header,
          colunaDestino: target.key,
          confianca: melhorMatch.score
        });
      }
    });

    return sugestoes.sort((a, b) => b.confianca - a.confianca);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.error("Apenas arquivos Excel (.xlsx, .xls) ou CSV são suportados");
      return;
    }

    setAnaliseEmAndamento(true);
    
    try {
      const headers = await analisarArquivo(file);
      setHeadersDetectadosDoArquivo(headers);
      setDetectedHeaders(headers); // Atualizar contexto global também
      
      const sugestoes = gerarSugestoesInteligentes(headers);
      setSugestoesPreview(sugestoes);
      
      if (sugestoes.length > 0) {
        toast.success(`Análise concluída! ${sugestoes.length} sugestões encontradas`);
      } else {
        toast.info("Nenhuma correspondência encontrada. Você pode criar regras manualmente.");
      }
    } catch (error) {
      console.error("Erro ao analisar arquivo:", error);
      toast.error("Erro ao analisar arquivo. Verifique se é um Excel válido.");
    } finally {
      setAnaliseEmAndamento(false);
    }
  };

  const aplicarSugestoes = () => {
    if (filtro === 'todos') {
      toast.error("Selecione um fornecedor específico primeiro");
      return;
    }

    let aplicadas = 0;
    sugestoesPreview.forEach(s => {
      // Verifica se já existe regra para esse destino
      const existe = regrasMapeamento.find(r => r.fornecedor === filtro && r.colunaDestino === s.colunaDestino);
      if (!existe) {
        addRegra({
          fornecedor: filtro,
          colunaOrigem: s.colunaOrigem,
          colunaDestino: s.colunaDestino,
          tipo: 'direto',
          valor: ''
        });
        aplicadas++;
      }
    });

    if (aplicadas > 0) {
      toast.success(`${aplicadas} regras aplicadas com sucesso!`);
      setUploadDialogOpen(false);
      setSugestoesPreview([]);
      setHeadersDetectadosDoArquivo([]);
    } else {
      toast.info("Todas as sugestões já existem como regras");
    }
  };

  // Fallback: sugerir baseado nos headers do último arquivo processado
  const sugerirRegrasFallback = () => {
    if (!detectedHeaders.length) { 
      // Abrir diálogo de upload se não houver headers
      setUploadDialogOpen(true);
      return;
    }
    if (filtro === 'todos') { toast.error("Selecione um fornecedor específico para sugerir regras."); return; }

    const sugestoes = gerarSugestoesInteligentes(detectedHeaders);
    setSugestoesPreview(sugestoes);
    setUploadDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Regras de Mapeamento</h1>
          <p className="text-sm text-muted-foreground">Configure como cada fornecedor mapeia suas colunas</p>
        </div>
        <div className="flex gap-2">
          <Select value={filtro} onValueChange={setFiltro}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {fornecedores.map(f => <SelectItem key={f.id} value={f.nome}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            className="text-primary border-primary/20 gap-2" 
            onClick={sugerirRegrasFallback}
            title="Analisar arquivo real e sugerir regras de mapeamento"
          >
            <Sparkles className="h-4 w-4" />
            Sugerir Regras
          </Button>
          <Button className="gradient-primary text-primary-foreground" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Nova Regra</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {regrasFiltradas.map(r => (
          <Card key={r.id} className="shadow-card hover:shadow-card-hover transition-shadow">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{r.fornecedor}</span>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px]">
                    {r.tipo === 'direto' ? 'Direto' : r.tipo === 'formula' ? 'Fórmula' : 'Fixo'}
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemove(r.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => openEdit(r)}>
                <div className="flex-1 bg-accent rounded-lg px-3 py-2 text-sm font-medium text-accent-foreground truncate">{r.colunaOrigem}</div>
                <ArrowRight className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 bg-primary/10 rounded-lg px-3 py-2 text-sm font-medium text-primary truncate">{r.colunaDestino}</div>
              </div>
              {r.valor && <p className="text-xs text-muted-foreground">Valor: {r.valor}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Diálogo de Upload e Análise de Arquivo */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Sugerir Regras de Mapeamento
            </DialogTitle>
            <DialogDescription>
              Faça upload de um arquivo Excel do fornecedor para analisar as colunas e sugerir mapeamentos automaticamente.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Área de Upload */}
            {headersDetectadosDoArquivo.length === 0 && (
              <div 
                className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-all"
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                />
                {analiseEmAndamento ? (
                  <div className="space-y-3">
                    <Loader2 className="h-10 w-10 mx-auto text-primary animate-spin" />
                    <p className="text-sm font-medium">Analisando arquivo...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 mx-auto flex items-center justify-center">
                      <Upload className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Clique para selecionar um arquivo Excel</p>
                      <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls, .csv</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Headers Detectados */}
            {headersDetectadosDoArquivo.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>{headersDetectadosDoArquivo.length} colunas detectadas</span>
                </div>
                <div className="bg-muted rounded-lg p-3 max-h-32 overflow-y-auto">
                  <div className="flex flex-wrap gap-2">
                    {headersDetectadosDoArquivo.map((h, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{h}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Sugestões Preview */}
            {sugestoesPreview.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium">Sugestões encontradas:</p>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {sugestoesPreview.map((s, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-accent/50">
                      <div className="flex-1 flex items-center gap-2">
                        <Badge variant="outline" className="text-xs truncate max-w-[140px]">{s.colunaOrigem}</Badge>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <Badge className="text-xs bg-primary/10 text-primary border-0">
                          {s.colunaDestino === 'codigoOriginal' && 'Código Original'}
                          {s.colunaDestino === 'nome' && 'Nome/Produto'}
                          {s.colunaDestino === 'precoBase' && 'Preço de Tabela'}
                          {s.colunaDestino === 'quantidadeCaixa' && 'Quantidade Caixa'}
                          {s.colunaDestino === 'ipi' && 'IPI (%)'}
                          {s.colunaDestino === 'categoria' && 'Categoria'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <div 
                          className={`h-2 w-2 rounded-full ${
                            s.confianca >= 0.8 ? 'bg-success' : 
                            s.confianca >= 0.6 ? 'bg-warning' : 'bg-muted-foreground'
                          }`}
                          title={`Confiança: ${Math.round(s.confianca * 100)}%`}
                        />
                        <span className="text-xs text-muted-foreground">{Math.round(s.confianca * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Estado Vazio */}
            {headersDetectadosDoArquivo.length > 0 && sugestoesPreview.length === 0 && (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm">Nenhuma correspondência automática encontrada.</p>
                <p className="text-xs mt-1">Você pode criar regras manualmente clicando em "Nova Regra"</p>
              </div>
            )}
          </div>
          
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => {
              setUploadDialogOpen(false);
              setHeadersDetectadosDoArquivo([]);
              setSugestoesPreview([]);
            }}>
              Cancelar
            </Button>
            {headersDetectadosDoArquivo.length > 0 && (
              <Button 
                variant="outline" 
                onClick={() => {
                  setHeadersDetectadosDoArquivo([]);
                  setSugestoesPreview([]);
                  fileInputRef.current?.click();
                }}
              >
                <Upload className="h-4 w-4 mr-1" />
                Outro arquivo
              </Button>
            )}
            {sugestoesPreview.length > 0 && (
              <Button 
                className="gradient-primary"
                onClick={aplicarSugestoes}
                disabled={filtro === 'todos'}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Aplicar {sugestoesPreview.length} Regras
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Editar Regra' : 'Nova Regra'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Fornecedor</label>
              <Select value={form.fornecedor} onValueChange={v => setForm(f => ({ ...f, fornecedor: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>{fornecedores.map(f => <SelectItem key={f.id} value={f.nome}>{f.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Campo Origem</label>
              <div className="flex gap-2">
                <Input value={form.colunaOrigem} onChange={e => setForm(f => ({ ...f, colunaOrigem: e.target.value }))} className="flex-1" placeholder="Nome exato da coluna" />
                {detectedHeaders.length > 0 && (
                  <Select onValueChange={v => setForm(f => ({ ...f, colunaOrigem: v }))}>
                    <SelectTrigger className="w-12 px-0 flex justify-center"><SelectValue placeholder="" /></SelectTrigger>
                    <SelectContent>
                      {detectedHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {detectedHeaders.length > 0 && <p className="text-[10px] text-muted-foreground italic">Use a setinha ao lado para escolher entre os headers detectados</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Campo Destino (Sistema)</label>
              <Select value={form.colunaDestino} onValueChange={v => setForm(f => ({ ...f, colunaDestino: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecionar destino" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="codigoOriginal">Código Original</SelectItem>
                  <SelectItem value="nome">Nome/Produto</SelectItem>
                  <SelectItem value="descricaoComplementar">Descrição Completa</SelectItem>
                  <SelectItem value="precoBase">Preço de Tabela</SelectItem>
                  <SelectItem value="quantidadeCaixa">Quantidade Caixa</SelectItem>
                  <SelectItem value="ipi">IPI (%)</SelectItem>
                  <SelectItem value="categoria">Categoria</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tipo</label>
              <Select value={form.tipo} onValueChange={v => setForm(f => ({ ...f, tipo: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="direto">Direto</SelectItem>
                  <SelectItem value="formula">Fórmula</SelectItem>
                  <SelectItem value="fixo">Fixo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.tipo === 'fixo' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Valor</label>
                <Input value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button className="gradient-primary text-primary-foreground" onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
