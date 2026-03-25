import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";

export default function RegrasMapeamento() {
  const { regrasMapeamento, fornecedores, addRegra, updateRegra, removeRegra, detectedHeaders } = useApp();
  const [searchParams] = useSearchParams();
  const [filtro, setFiltro] = useState(searchParams.get('fornecedor') || "todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ fornecedor: '', colunaOrigem: '', colunaDestino: '', tipo: 'direto' as 'direto' | 'formula' | 'fixo', valor: '' });

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

  const sugerirRegras = () => {
    if (!detectedHeaders.length) { toast.error("Nenhum header detectado. Processe um arquivo primeiro."); return; }
    if (filtro === 'todos') { toast.error("Selecione um fornecedor específico para sugerir regras."); return; }

    const targets = [
      { key: 'codigoOriginal', words: ['código', 'referência', 'cod', 'ref', 'modelo', 'part'] },
      { key: 'nome', words: ['descrição', 'nome', 'produto', 'item', 'desc'] },
      { key: 'precoBase', words: ['preço', 'valor', 'venda', 'vlr', 'tabela'] },
      { key: 'quantidadeCaixa', words: ['caixa', 'unidade', 'emb', 'qtd', 'quantidade', 'cx'] }
    ];

    let sugeridas = 0;
    targets.forEach(t => {
      // Verifica se já existe regra para esse destino
      const existe = regrasMapeamento.find(r => r.fornecedor === filtro && r.colunaDestino === t.key);
      if (existe) return;

      // Busca por similaridade nos headers detectados
      const bestMatch = detectedHeaders.find(h => {
        const lowerH = h.toLowerCase();
        return t.words.some(w => lowerH.includes(w));
      });

      if (bestMatch) {
        addRegra({
          fornecedor: filtro,
          colunaOrigem: bestMatch,
          colunaDestino: t.key,
          tipo: 'direto',
          valor: ''
        });
        sugeridas++;
      }
    });

    if (sugeridas > 0) toast.success(`${sugeridas} regras sugeridas e adicionadas!`);
    else toast.info("Nenhuma correspondência óbvia encontrada nos headers.");
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
          <Button variant="outline" className="text-primary border-primary/20" onClick={sugerirRegras} title="Sugerir regras baseadas nos headers do último arquivo importado">Sugerir Regras</Button>
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
