import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { useFornecedores } from "@/context/FornecedoresContext";
import { Building2, Edit, Package, Calendar, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function Fornecedores() {
  const { fornecedores, updateFornecedor, removeFornecedor, seedSuppliers, isLoading } = useFornecedores();
  const navigate = useNavigate();
  const [editId, setEditId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [editDesconto, setEditDesconto] = useState("");
  const [editIpi, setEditIpi] = useState("");
  const [isSeeding, setIsSeeding] = useState(false);

  const openEdit = (f: typeof fornecedores[0]) => {
    setEditId(f.id);
    setEditDesconto(String(f.descontoPadrao));
    setEditIpi(String(f.ipiPadrao));
  };

  const saveEdit = async () => {
    if (!editId) return;
    try {
      await updateFornecedor(editId, { descontoPadrao: parseFloat(editDesconto) || 0, ipiPadrao: parseFloat(editIpi) || 0 });
      toast.success("Fornecedor atualizado!");
      setEditId(null);
    } catch (err) {
      toast.error("Erro ao atualizar fornecedor.");
    }
  };

  const handleSeed = async () => {
    try {
      setIsSeeding(true);
      await seedSuppliers();
      toast.success("Fornecedores base importados com sucesso!");
    } catch (err) {
      toast.error("Erro ao importar fornecedores base.");
    } finally {
      setIsSeeding(false);
    }
  };

  const confirmDelete = async () => {
    if (!removeId) return;
    try {
      await removeFornecedor(removeId, deleteData);
      setRemoveId(null);
      setDeleteData(false);
    } catch (err) {
      toast.error("Erro ao remover fornecedor.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fornecedores</h1>
          <p className="text-sm text-muted-foreground">{fornecedores.length} fornecedores cadastrados</p>
        </div>
        <Button 
          variant="outline" 
          onClick={handleSeed} 
          disabled={isSeeding || isLoading}
          className="border-dashed"
        >
          {isSeeding ? "Importando..." : "Seed Dados Base"}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fornecedores.map(f => (
          <Card key={f.id} className="shadow-card hover:shadow-card-hover transition-shadow">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{f.nome}</h3>
                    <p className="text-xs text-muted-foreground">{f.tipoArquivo} • {f.frequencia}</p>
                  </div>
                </div>
                <StatusBadge status={f.status} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-1.5 text-muted-foreground"><Package className="h-3.5 w-3.5" /> {f.totalProdutos} produtos</div>
                <div className="flex items-center gap-1.5 text-muted-foreground"><Calendar className="h-3.5 w-3.5" /> {f.ultimoProcessamento}</div>
                <div className="text-muted-foreground">Desc: <span className="text-foreground font-medium">{f.descontoPadrao}%</span></div>
                <div className="text-muted-foreground">IPI: <span className="text-foreground font-medium">{f.ipiPadrao}%</span></div>
              </div>
              <div className="flex gap-2 mt-auto pt-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(f)}>
                  <Edit className="h-3.5 w-3.5 mr-1" /> Editar
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate(`/regras?fornecedor=${f.nome}`)}>
                  Regras
                </Button>
                <Button variant="outline" size="sm" className="w-10 text-destructive hover:bg-destructive/10 border-destructive/20" onClick={() => setRemoveId(f.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!removeId} onOpenChange={() => setRemoveId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-destructive flex items-center gap-2"><Trash2 className="h-5 w-5" /> Excluir Fornecedor</DialogTitle></DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm">Você está prestes a excluir este fornecedor. Esta ação não pode ser desfeita.</p>
            <div className="flex items-center space-x-2 bg-muted/50 p-4 rounded-lg">
              <input 
                type="checkbox" 
                id="deleteData" 
                checked={deleteData} 
                onChange={e => setDeleteData(e.target.checked)} 
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer" 
              />
              <label htmlFor="deleteData" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                Excluir também todos os produtos e regras deste fornecedor
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmDelete}>Confirmar Exclusão</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editId} onOpenChange={() => setEditId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Fornecedor</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Desconto Padrão (%)</label>
              <Input type="number" value={editDesconto} onChange={e => setEditDesconto(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">IPI Padrão (%)</label>
              <Input type="number" value={editIpi} onChange={e => setEditIpi(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditId(null)}>Cancelar</Button>
            <Button className="gradient-primary text-primary-foreground" onClick={saveEdit}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
