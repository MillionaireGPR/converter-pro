import React, { createContext, useContext, useState, useCallback, useRef, ReactNode, useEffect } from "react";
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
  salvarMapeamentoColuna: (nomeFornecedor: string, campo: string, coluna: string) => Promise<void>;
  getFornecedorByName: (nome: string) => Fornecedor | undefined;
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
  // Estado "ao vivo" do columnMappings por fornecedor, atualizado de forma
  // SÍNCRONA em salvarMapeamentoColuna (ver comentário lá). Existe porque
  // `fornecedores` só reflete uma gravação depois do round-trip do Supabase
  // — se a gente mesclasse em cima dele, a 2ª de duas colunas escolhidas em
  // sequência rápida (caso VAESO: 3 tabelas de preço extra, uma por vez)
  // apagaria a 1ª (reunião 16/09/2026, "tabela secundária não sai mesmo
  // escolhendo no sistema").
  const columnMappingsAoVivo = useRef<Record<string, Record<string, string>>>({});
  // Serializa as gravações no Supabase por fornecedor: sem isso, duas
  // respostas de rede fora de ordem fariam a mais lenta sobrescrever a mais
  // rápida com um mapeamento mais velho.
  const gravacoesPendentes = useRef<Record<string, Promise<void>>>({});

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
          opcoesCatalogo: f.opcoes_catalogo || undefined,
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
        ...(updates.opcoesCatalogo !== undefined ? { opcoes_catalogo: updates.opcoesCatalogo } : {}),
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
   *
   * VAESO (16/09/2026): configurar as 3 "tabelas de preço extra" dispara 3
   * chamadas independentes em sequência rápida. Mesclar em cima de
   * `forn.columnMappings` (só atualizado DEPOIS do round-trip da rede) fazia
   * a 2ª e 3ª chamada mesclarem sobre um snapshot sem a mudança anterior — a
   * gravação que resolvesse por último no Supabase vencia e apagava as
   * outras. Corrigido com (1) merge síncrono em `columnMappingsAoVivo`, que
   * já inclui qualquer chamada anterior ainda em voo, e (2) fila de escrita
   * por fornecedor, pra duas respostas de rede fora de ordem não se
   * sobrescreverem com dado velho.
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
    const base = columnMappingsAoVivo.current[forn.id] ?? forn.columnMappings ?? {};
    const mappings = { ...base };
    if (coluna) mappings[campo] = coluna;
    else delete mappings[campo];
    columnMappingsAoVivo.current[forn.id] = mappings;

    const anterior = gravacoesPendentes.current[forn.id] || Promise.resolve();
    const atual = anterior.then(async () => {
      // Lido de novo aqui (não `mappings` capturado acima): se outra
      // chamada mesclou por cima enquanto esperávamos a fila, é o valor
      // mais recente que tem que ir pro banco.
      const payload = columnMappingsAoVivo.current[forn.id];
      const { error } = await (supabase.from('suppliers') as any)
        .update({ column_mappings: payload })
        .eq('id', forn.id);
      if (error) throw error;

      setFornecedores(prev => prev.map(f =>
        f.id === forn.id ? { ...f, columnMappings: payload } : f
      ));
    });
    gravacoesPendentes.current[forn.id] = atual;

    try {
      await atual;
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

  return (
    <FornecedoresContext.Provider value={{
      fornecedores, regrasMapeamento, isLoading, refreshFornecedores,
      updateFornecedor, removeFornecedor, addRegra, updateRegra, removeRegra,
      salvarMapeamentoColuna,
      getFornecedorByName,
    }}>
      {children}
    </FornecedoresContext.Provider>
  );
}
