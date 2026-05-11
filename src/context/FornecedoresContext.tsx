import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";
import { supabase } from "../integrations/supabase/client";
import { toast } from "sonner";
import { Fornecedor, RegraMapeamento } from "./types";

interface FornecedoresContextType {
  fornecedores: Fornecedor[];
  regrasMapeamento: RegraMapeamento[];
  isLoading: boolean;
  refreshFornecedores: () => Promise<void>;
  updateFornecedor: (id: string, updates: Partial<Fornecedor>) => Promise<void>;
  removeFornecedor: (id: string, deleteData?: boolean) => Promise<void>;
  addRegra: (regra: Omit<RegraMapeamento, 'id'>) => void;
  updateRegra: (id: string, regra: Omit<RegraMapeamento, 'id'>) => void;
  removeRegra: (id: string) => void;
  getFornecedorByName: (nome: string) => Fornecedor | undefined;
  seedSuppliers: () => Promise<void>;
}

const FornecedoresContext = createContext<FornecedoresContextType | null>(null);

export function useFornecedores() {
  const ctx = useContext(FornecedoresContext);
  if (!ctx) throw new Error("useFornecedores must be used within FornecedoresProvider");
  return ctx;
}

let nextId = 1;
const genId = () => String(Date.now() + nextId++);

export function FornecedoresProvider({ children }: { children: ReactNode }) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [regrasMapeamento, setRegrasMapeamento] = useState<RegraMapeamento[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshFornecedores = useCallback(async () => {
    try {
      const { data: fornData, error } = await (supabase.from('suppliers') as any).select('*');
      if (error) throw error;
      if (fornData) {
        setFornecedores(fornData.map((f: any) => ({
          id: f.id, nome: f.name, tipoArquivo: f.file_type || 'Excel', frequencia: f.frequency || 'Semanal',
          descontoPadrao: f.default_discount || 0, ipiPadrao: f.default_ipi || 0,
          ultimoProcessamento: f.last_processed || '', totalProdutos: f.total_products || 0, status: f.status as any
        })));
      }
    } catch (e) {
      console.warn("Erro ao buscar fornecedores", e);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setIsLoading(true);
      await refreshFornecedores();
      
      setRegrasMapeamento([
        { id: '1', fornecedor: 'Tramontina', colunaOrigem: 'Cod For', colunaDestino: 'Código do Produto', tipo: 'direto' },
        { id: '2', fornecedor: 'Tramontina', colunaOrigem: 'Descr Compl', colunaDestino: 'Nome do Produto', tipo: 'direto' },
        { id: '3', fornecedor: 'Tramontina', colunaOrigem: 'P.Venda', colunaDestino: 'Preço Base', tipo: 'direto' },
        { id: '4', fornecedor: 'Vonder', colunaOrigem: 'CODIGO', colunaDestino: 'Código do Produto', tipo: 'direto' },
        { id: '5', fornecedor: 'Vonder', colunaOrigem: 'DESCRICAO + MEDIDA', colunaDestino: 'Nome do Produto', tipo: 'formula' },
        { id: '6', fornecedor: 'Bosch', colunaOrigem: 'EAN', colunaDestino: 'Código do Produto', tipo: 'direto' },
        { id: '7', fornecedor: 'Bosch', colunaOrigem: 'IPI fixo 10%', colunaDestino: 'IPI', tipo: 'fixo', valor: '10' },
      ]);
      setIsLoading(false);
    }
    init();
  }, [refreshFornecedores]);

  const updateFornecedor = useCallback(async (id: string, updates: Partial<Fornecedor>) => {
    try {
      const { error } = await (supabase.from('suppliers') as any).update({
        name: updates.nome, file_type: updates.tipoArquivo, frequency: updates.frequencia,
        default_discount: updates.descontoPadrao, default_ipi: updates.ipiPadrao, status: updates.status
      }).eq('id', id);
      if (error) throw error;
      setFornecedores(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
    } catch (error) {
      toast.error("Erro ao salvar fornecedor.");
    }
  }, []);

  const removeFornecedor = useCallback(async (id: string, deleteData: boolean = false) => {
    try {
      const f = fornecedores.find(x => x.id === id);
      if (!f) return;
      if (deleteData) {
        await (supabase.from('standardized_products') as any).delete().or(`supplier_id.eq.${id},supplier_name.eq.${f.nome}`);
        setRegrasMapeamento(prev => prev.filter(r => r.fornecedor !== f.nome));
        // O ProdutosContext deve ser limpo via reload ou evento
      }
      const { error } = await (supabase.from('suppliers') as any).delete().eq('id', id);
      if (error) throw error;
      setFornecedores(prev => prev.filter(x => x.id !== id));
      toast.success(`Fornecedor ${f.nome} removido.`);
    } catch (error) {
      toast.error("Erro ao excluir fornecedor do banco.");
    }
  }, [fornecedores]);

  const addRegra = useCallback((regra: Omit<RegraMapeamento, 'id'>) => {
    setRegrasMapeamento(prev => [...prev, { ...regra, id: genId() }]);
  }, []);

  const updateRegra = useCallback((id: string, updates: Partial<RegraMapeamento>) => {
    setRegrasMapeamento(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  }, []);

  const removeRegra = useCallback((id: string) => {
    setRegrasMapeamento(prev => prev.filter(r => r.id !== id));
  }, []);

  const getFornecedorByName = useCallback((nome: string) => {
    return fornecedores.find(f => f.nome === nome);
  }, [fornecedores]);

  const seedSuppliers = useCallback(async () => {
    // Basic implementation copied from AppContext
    try {
      setIsLoading(true);
      const defaultSuppliers = [
        { name: 'Tramontina', file_type: 'Excel', frequency: 'Mensal', default_discount: 15, default_ipi: 5, status: 'ativo' },
        { name: 'Vonder', file_type: 'Excel', frequency: 'Quinzenal', default_discount: 10, default_ipi: 10, status: 'ativo' },
      ];
      const { data: existing } = await (supabase.from('suppliers') as any).select('name');
      const existingNames = existing?.map((s: any) => s.name) || [];
      const toInsert = defaultSuppliers.filter(s => !existingNames.includes(s.name));
      if (toInsert.length > 0) await (supabase.from('suppliers') as any).insert(toInsert);
      await refreshFornecedores();
      toast.success("Fornecedores padrão adicionados.");
    } catch (error) {
      toast.warning("Modo offline para fornecedores.");
    } finally {
      setIsLoading(false);
    }
  }, [refreshFornecedores]);

  return (
    <FornecedoresContext.Provider value={{
      fornecedores, regrasMapeamento, isLoading, refreshFornecedores,
      updateFornecedor, removeFornecedor, addRegra, updateRegra, removeRegra,
      getFornecedorByName, seedSuppliers
    }}>
      {children}
    </FornecedoresContext.Provider>
  );
}
