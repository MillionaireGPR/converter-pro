import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";
import { supabase } from "../integrations/supabase/client";
import { toast } from "sonner";
import { Fornecedor, RegraMapeamento } from "./types";
import { getAllAdapters } from "../core/supplierRules/registry";

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
  salvarMapeamentoColuna: (nomeFornecedor: string, campo: string, coluna: string) => Promise<void>;
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
          ultimoProcessamento: f.last_processed || '', totalProdutos: f.total_products || 0, status: f.status as any,
          columnMappings: f.column_mappings || undefined,
          regrasExtracao: f.extraction_rules || undefined,
        })));

        // Reconstrói as regras de mapeamento a partir do banco. Antes elas
        // viviam SÓ em memória (sumiam no reload e nunca chegavam ao
        // conversor) — a tela existia mas não tinha efeito nenhum.
        const regras: RegraMapeamento[] = [];
        for (const f of fornData) {
          const mapp = (f.column_mappings || {}) as Record<string, string>;
          for (const [campo, coluna] of Object.entries(mapp)) {
            if (!coluna) continue;
            regras.push({
              id: `${f.id}:${campo}`,
              fornecedor: f.name,
              colunaOrigem: coluna,
              colunaDestino: campo,
              tipo: 'direto',
            });
          }
        }
        setRegrasMapeamento(regras);
      }
    } catch (e) {
      console.warn("Erro ao buscar fornecedores", e);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setIsLoading(true);
      // refreshFornecedores já reconstrói as regras a partir de
      // suppliers.column_mappings. Antes havia um setRegrasMapeamento([])
      // logo aqui (de quando as regras eram mocadas), que APAGAVA o que
      // acabara de vir do banco — a tela abria sempre vazia.
      await refreshFornecedores();
      setIsLoading(false);
    }
    init();
  }, [refreshFornecedores]);

  const updateFornecedor = useCallback(async (id: string, updates: Partial<Fornecedor>) => {
    try {
      const { error } = await (supabase.from('suppliers') as any).update({
        name: updates.nome, file_type: updates.tipoArquivo, frequency: updates.frequencia,
        default_discount: updates.descontoPadrao, default_ipi: updates.ipiPadrao, status: updates.status,
        // Regras de leitura do catálogo PDF escritas pelo cliente. Enviado
        // só quando veio no update, pra não apagar o que já existe quando a
        // tela salvar apenas desconto/IPI.
        ...(updates.regrasExtracao !== undefined ? { extraction_rules: updates.regrasExtracao } : {}),
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

  /**
   * Persiste as regras de UM fornecedor como suppliers.column_mappings.
   * Fonte da verdade é sempre a lista completa de regras daquele fornecedor
   * (mais simples e sem risco de divergir do que aplicar deltas).
   */
  const persistirMapeamentos = useCallback(async (
    nomeFornecedor: string,
    regrasDoFornecedor: RegraMapeamento[]
  ) => {
    const forn = fornecedores.find(f => f.nome === nomeFornecedor);
    if (!forn) {
      toast.error(`Fornecedor "${nomeFornecedor}" não encontrado — regra não salva.`);
      return;
    }
    const mappings: Record<string, string> = {};
    for (const r of regrasDoFornecedor) {
      if (r.colunaDestino && r.colunaOrigem) mappings[r.colunaDestino] = r.colunaOrigem;
    }
    try {
      const { error } = await (supabase.from('suppliers') as any)
        .update({ column_mappings: mappings })
        .eq('id', forn.id);
      if (error) throw error;
      setFornecedores(prev => prev.map(f =>
        f.id === forn.id ? { ...f, columnMappings: mappings } : f
      ));
    } catch (e) {
      console.error('[Fornecedores] Falha ao salvar mapeamento', e);
      toast.error('Erro ao salvar a regra no banco.');
    }
  }, [fornecedores]);

  /**
   * Salva o mapeamento de UM campo direto do painel de conferência da tela
   * de conversão (19/08/2026). Atalho pra corrigir na hora do upload, sem
   * obrigar o usuário a ir até a tela de Regras de Colunas.
   * coluna vazia = remove o mapeamento (volta pra detecção automática).
   */
  const salvarMapeamentoColuna = useCallback(async (
    nomeFornecedor: string,
    campo: string,
    coluna: string
  ) => {
    const forn = fornecedores.find(f => f.nome === nomeFornecedor);
    if (!forn) {
      toast.error(`Fornecedor "${nomeFornecedor}" não encontrado.`);
      return;
    }
    const mappings = { ...(forn.columnMappings || {}) };
    if (coluna) mappings[campo] = coluna;
    else delete mappings[campo];

    try {
      const { error } = await (supabase.from('suppliers') as any)
        .update({ column_mappings: mappings })
        .eq('id', forn.id);
      if (error) throw error;

      setFornecedores(prev => prev.map(f =>
        f.id === forn.id ? { ...f, columnMappings: mappings } : f
      ));
      // Mantém a tela de Regras de Colunas em sincronia com o que foi
      // ajustado aqui (as duas telas editam a MESMA configuração).
      setRegrasMapeamento(prev => {
        const outros = prev.filter(r => !(r.fornecedor === nomeFornecedor && r.colunaDestino === campo));
        return coluna
          ? [...outros, { id: `${forn.id}:${campo}`, fornecedor: nomeFornecedor, colunaOrigem: coluna, colunaDestino: campo, tipo: 'direto' as const }]
          : outros;
      });
      toast.success(coluna ? `Coluna salva para este fornecedor.` : 'Mapeamento removido.');
    } catch (e) {
      console.error('[Fornecedores] Falha ao salvar coluna', e);
      toast.error('Erro ao salvar a coluna.');
    }
  }, [fornecedores]);

  const addRegra = useCallback((regra: Omit<RegraMapeamento, 'id'>) => {
    setRegrasMapeamento(prev => {
      // Um campo de destino só pode vir de UMA coluna — se já existe regra
      // pra esse destino, ela é substituída (senão o mapeamento ficaria
      // ambíguo e o resultado dependeria da ordem da lista).
      const semDuplicata = prev.filter(
        r => !(r.fornecedor === regra.fornecedor && r.colunaDestino === regra.colunaDestino)
      );
      const atualizado = [...semDuplicata, { ...regra, id: genId() }];
      void persistirMapeamentos(regra.fornecedor, atualizado.filter(r => r.fornecedor === regra.fornecedor));
      return atualizado;
    });
  }, [persistirMapeamentos]);

  const updateRegra = useCallback((id: string, updates: Partial<RegraMapeamento>) => {
    setRegrasMapeamento(prev => {
      const atualizado = prev.map(r => r.id === id ? { ...r, ...updates } : r);
      const alvo = atualizado.find(r => r.id === id);
      if (alvo) void persistirMapeamentos(alvo.fornecedor, atualizado.filter(r => r.fornecedor === alvo.fornecedor));
      return atualizado;
    });
  }, [persistirMapeamentos]);

  const removeRegra = useCallback((id: string) => {
    setRegrasMapeamento(prev => {
      const removida = prev.find(r => r.id === id);
      const atualizado = prev.filter(r => r.id !== id);
      if (removida) void persistirMapeamentos(removida.fornecedor, atualizado.filter(r => r.fornecedor === removida.fornecedor));
      return atualizado;
    });
  }, [persistirMapeamentos]);

  const getFornecedorByName = useCallback((nome: string) => {
    return fornecedores.find(f => f.nome === nome);
  }, [fornecedores]);

  const seedSuppliers = useCallback(async () => {
    // Insere no Supabase os 14 fornecedores REAIS suportados pelo pipeline.
    // Fonte da verdade: src/core/supplierRules/registry.ts (getAllAdapters).
    // Antes inseria Tramontina/Vonder (sem adapter), o que fazia o dropdown
    // listar opções que o engine não conseguia processar.
    try {
      setIsLoading(true);
      const adapters = getAllAdapters();
      const defaultSuppliers = adapters.map(a => ({
        name: a.nome,
        file_type: 'PDF', // Maioria dos adapters suporta PDF; pode ser editado depois
        frequency: 'Mensal',
        default_discount: 0,
        default_ipi: 0,
        status: 'ativo',
      }));
      const { data: existing } = await (supabase.from('suppliers') as any).select('name');
      const existingNames = existing?.map((s: any) => s.name) || [];
      const toInsert = defaultSuppliers.filter(s => !existingNames.includes(s.name));
      if (toInsert.length > 0) await (supabase.from('suppliers') as any).insert(toInsert);
      await refreshFornecedores();
      toast.success(`${toInsert.length} fornecedores adicionados (de ${adapters.length} suportados).`);
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
      salvarMapeamentoColuna,
      getFornecedorByName, seedSuppliers
    }}>
      {children}
    </FornecedoresContext.Provider>
  );
}
