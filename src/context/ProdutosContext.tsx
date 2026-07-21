import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";
import { supabase } from "../integrations/supabase/client";
import { toast } from "sonner";
import { Produto, StatusProduto, ProdutoNormalizado } from "./types";
import { useFornecedores } from "./FornecedoresContext";
import { useHistorico } from "./HistoricoContext";
import { validarProduto as motorValidar } from "../core/validators";

interface ProdutosContextType {
  produtosPadronizados: Produto[];
  setProdutosPadronizados: React.Dispatch<React.SetStateAction<Produto[]>>;
  addProdutos: (prods: Produto[]) => Promise<void>;
  addProdutosNormalizados: (prods: ProdutoNormalizado[]) => Promise<void>;
  updateProduto: (id: string, updates: Partial<Produto>) => Promise<void>;
  validarProdutos: (ids: string[]) => Promise<void>;
  aplicarDesconto: (ids: string[], percentual: number, campanha?: string, fornecedor?: string, descontoString?: string) => Promise<void>;
  aplicarIpi: (ids: string[], ipi: number, fornecedor?: string, updatesIndividuais?: { id: string; ipi: number }[]) => Promise<void>;
  aplicarMultiplicadorPreco: (ids: string[], fator: number, fornecedor?: string) => Promise<void>;
  limparBase: (fornecedorNome?: string) => Promise<void>;
  descontos: import('./types').DescontoSalvo[];
}

const ProdutosContext = createContext<ProdutosContextType | null>(null);

export function useProdutos() {
  const ctx = useContext(ProdutosContext);
  if (!ctx) throw new Error("useProdutos must be used within ProdutosProvider");
  return ctx;
}

let nextId = 1;
const genId = () => String(Date.now() + nextId++);
const now = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function ProdutosProvider({ children }: { children: ReactNode }) {
  const [produtosPadronizados, setProdutosPadronizados] = useState<Produto[]>([]);
  const [descontos, setDescontos] = useState<import('./types').DescontoSalvo[]>([]);
  const { fornecedores, refreshFornecedores } = useFornecedores();
  const { registrarHistorico } = useHistorico();

  useEffect(() => {
    async function load() {
      try {
        const { data: prodData, error } = await (supabase.from('standardized_products') as any).select('*');
        if (error) throw error;
        if (prodData) {
          setProdutosPadronizados(prodData.map((p: any) => ({
            id: p.id,
            fornecedor: p.supplier_name,
            fornecedorId: p.supplier_id || undefined,
            codigoOriginal: p.original_code,
            codigoFinal: p.final_code || '',
            nome: p.name,
            descricao: p.description || '',
            precoBase: p.base_price || 0,
            descontoPercentual: p.discount_percent || 0,
            precoFinal: p.final_price || 0,
            ipi: p.ipi || 0,
            unidade: p.unit || '',
            qtdCaixa: p.box_qty || 1,
            categoria: p.categoria || '',
            embalagem: p.embalagem || '',
            status: p.status as any,
            erros: p.errors || [],
            imagemUrl: p.image_url || '',
            temImagem: p.has_image || false,
            visualCategory: p.visual_category || undefined,
            isPromotional: p.is_promotional || false,
            isFixedPrice: p.is_fixed_price || false,
            bloqueiaDesconto: p.bloqueia_desconto || false,
            additionalInfo: p.additional_info || '',
          })));
        }
      } catch (e) {
        console.warn("Erro ao carregar produtos:", e);
      }
    }
    load();
  }, []);

  const addProdutos = useCallback(async (prods: Produto[]) => {
    try {
      if (prods.length === 0) return;
      const fornecedoresEnvolvidos = Array.from(new Set(prods.map(p => p.fornecedor)));
      
      await (supabase.from('standardized_products') as any).delete().in('supplier_name', fornecedoresEnvolvidos);
      setProdutosPadronizados(prev => prev.filter(p => !fornecedoresEnvolvidos.includes(p.fornecedor)));

      const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

      const inserts = prods.map(p => {
        const sId = (p.fornecedorId && isUUID(p.fornecedorId)) ? p.fornecedorId : null;
        return {
          supplier_id: sId,
          supplier_name: p.fornecedor,
          original_code: p.codigoOriginal,
          final_code: p.codigoFinal,
          name: p.nome,
          description: p.descricao,
          base_price: p.precoBase,
          discount_percent: p.descontoPercentual,
          final_price: p.precoFinal,
          ipi: p.ipi,
          unit: p.unidade,
          box_qty: p.qtdCaixa,
          categoria: p.categoria,
          embalagem: p.embalagem,
          status: p.status,
          errors: p.erros as any,
          image_url: p.imagemUrl || null,
          has_image: p.temImagem || false,
          visual_category: p.visualCategory || null,
          is_promotional: p.isPromotional || false,
          is_fixed_price: p.isFixedPrice || false,
          bloqueia_desconto: p.bloqueiaDesconto || false,
          additional_info: p.additionalInfo || null,
        };
      });

      const { data, error } = await (supabase.from('standardized_products') as any).insert(inserts).select();
      if (error) {
        toast.warning("Modo Offline: Dados salvos localmente");
        setProdutosPadronizados(prev => [...prev, ...prods.map(p => ({ ...p, id: genId() }))]);
      } else if (data) {
        setProdutosPadronizados(prev => [...prev, ...data.map((p: any) => ({
          id: p.id, fornecedor: p.supplier_name, fornecedorId: p.supplier_id || undefined,
          codigoOriginal: p.original_code, codigoFinal: p.final_code || '',
          nome: p.name, descricao: p.description || '', precoBase: p.base_price || 0,
          descontoPercentual: p.discount_percent || 0, precoFinal: p.final_price || 0, ipi: p.ipi || 0,
          unidade: p.unit || '', qtdCaixa: p.box_qty || 1, categoria: p.categoria || '',
          embalagem: p.embalagem || '', status: p.status as any, erros: p.errors || [],
          imagemUrl: p.image_url || '', temImagem: p.has_image || false,
          visualCategory: p.visual_category || undefined,
          visualTags: p.visual_tags || (p.visual_category ? [p.visual_category] : []),
          isPromotional: p.is_promotional || false, isFixedPrice: p.is_fixed_price || false,
          bloqueiaDesconto: p.bloqueia_desconto || false, additionalInfo: p.additional_info || '',
        }))]);
      }

      const fornMap = new Map<string, number>();
      prods.forEach(p => fornMap.set(p.fornecedor, (fornMap.get(p.fornecedor) || 0) + 1));
      
      for (const [name, count] of fornMap.entries()) {
        const f = fornecedores.find(x => x.nome === name);
        if (f && isUUID(f.id)) {
          await (supabase.from('suppliers') as any).update({ 
            total_products: f.totalProdutos + count,
            last_processed: new Date().toISOString()
          }).eq('id', f.id);
        }
      }
      await refreshFornecedores();
    } catch (error) {
      toast.error("Erro ao salvar produtos no banco.");
    }
  }, [fornecedores, refreshFornecedores]);

  const addProdutosNormalizados = useCallback(async (prods: ProdutoNormalizado[]) => {
    const mappedProds: Produto[] = prods.map(p => {
      const anyProd = p as any;
      return {
        id: genId(), fornecedor: p.fornecedor, fornecedorId: p.fornecedorId,
        codigoOriginal: p.codigoOriginal, codigoFinal: p.codigo, nome: p.nome,
        descricao: p.descricaoComplementar || '', precoBase: p.precoBase,
        descontoPercentual: p.descontoPercentual || 0, descontoString: p.descontoString,
        precoFinal: p.precoFinal, ipi: p.ipi || 0, unidade: p.unidade,
        qtdCaixa: p.quantidadeCaixa, categoria: p.categoria || '', embalagem: p.embalagem || '',
        status: p.status as StatusProduto, erros: p.erros || [],
        visualCategory: anyProd.visualCategory || anyProd.visual_category || undefined,
        visualTags: anyProd.visualTags || (anyProd.visualCategory ? [anyProd.visualCategory] : []),
        isPromotional: anyProd.isPromotional || false, isFixedPrice: anyProd.isFixedPrice || false,
        bloqueiaDesconto: anyProd.bloqueiaDesconto || anyProd.bloqueia_desconto || false,
        additionalInfo: anyProd.informacoesAdicionais || anyProd.additionalInfo || '',
        imagemUrl: p.imagemUrl || '', temImagem: p.temImagem || false,
      };
    });
    await addProdutos(mappedProds);
  }, [addProdutos]);

  const updateProduto = useCallback(async (id: string, updates: Partial<Produto>) => {
    try {
      const p = produtosPadronizados.find(x => x.id === id);
      if (!p) return;
      const updated = { ...p, ...updates };
      if (updates.precoBase !== undefined || updates.descontoPercentual !== undefined) {
        updated.precoFinal = +(updated.precoBase * (1 - updated.descontoPercentual / 100)).toFixed(2);
      }
      
      const { error } = await (supabase.from('standardized_products') as any).update({
        final_code: updated.codigoFinal, name: updated.nome, description: updated.descricao,
        base_price: updated.precoBase, discount_percent: updated.descontoPercentual,
        final_price: updated.precoFinal, ipi: updated.ipi, unit: updated.unidade,
        box_qty: updated.qtdCaixa, categoria: updated.categoria, embalagem: updated.embalagem,
        status: updated.status, errors: updated.erros, image_url: updated.imagemUrl || null,
        has_image: updated.temImagem || false, visual_category: updated.visualCategory || null,
        is_promotional: updated.isPromotional || false, is_fixed_price: updated.isFixedPrice || false,
        bloqueia_desconto: updated.bloqueiaDesconto || false, additional_info: updated.additionalInfo || null,
      }).eq('id', id);

      if (error) toast.warning("Modo Offline: Alteração salva localmente");
      setProdutosPadronizados(prev => prev.map(prod => prod.id === id ? updated : prod));
    } catch (e) {
      toast.error("Erro ao processar alteração local.");
    }
  }, [produtosPadronizados]);

  const validarProdutos = useCallback(async (ids: string[]) => {
    try {
      const results = await Promise.all(ids.map(async (id) => {
        const p = produtosPadronizados.find(x => x.id === id);
        if (!p) return null;
        
        const pNormalizado: ProdutoNormalizado = {
          fornecedor: p.fornecedor, codigoOriginal: p.codigoOriginal, codigo: p.codigoFinal || p.codigoOriginal,
          nome: p.nome, precoBase: p.precoBase, precoFinal: p.precoFinal, ipi: p.ipi, unidade: p.unidade,
          quantidadeCaixa: p.qtdCaixa, categoria: p.categoria, status: p.status as any, erros: p.erros,
        };

        const result = motorValidar(pNormalizado);
        const finalStatus = result.status as StatusProduto;
        const finalCode = result.status === 'validado' ? (p.codigoFinal || p.codigoOriginal) : p.codigoFinal;

        await (supabase.from('standardized_products') as any).update({
          status: finalStatus, errors: result.erros, final_code: finalCode
        }).eq('id', id);

        return { ...p, status: finalStatus, erros: result.erros, codigoFinal: finalCode };
      }));

      const updatedProds = results.filter(Boolean) as Produto[];
      setProdutosPadronizados(prev => prev.map(p => updatedProds.find(u => u.id === p.id) || p));
      await registrarHistorico({ arquivo: '-', fornecedor: 'Diversos', usuario: 'Admin', data: now(), tipoConversao: 'Validação de Produtos', qtdItens: ids.length, status: 'concluído' });
    } catch (e) {
      toast.error("Erro ao validar produtos.");
    }
  }, [produtosPadronizados, registrarHistorico]);

  const aplicarDesconto = useCallback(async (ids: string[], percentual: number, campanha?: string, fornecedor?: string, descontoString?: string) => {
    try {
      let bloqueados = 0;
      let aplicados = 0;
      
      const results = await Promise.all(ids.map(async (id) => {
        const p = produtosPadronizados.find(x => x.id === id);
        if (!p) return null;
        if (p.bloqueiaDesconto) {
          bloqueados++;
          return { ...p, descontoPercentual: 0, descontoString: 'BLOQUEADO', precoFinal: p.precoBase };
        }
        aplicados++;
        const precoFinal = +(p.precoBase * (1 - percentual / 100)).toFixed(2);
        
        await (supabase.from('standardized_products') as any).update({
          discount_percent: percentual, final_price: precoFinal
        }).eq('id', id);

        return { ...p, descontoPercentual: percentual, descontoString, precoFinal };
      }));

      const updatedProds = results.filter(Boolean) as Produto[];
      setProdutosPadronizados(prev => prev.map(p => updatedProds.find(u => u.id === p.id) || p));
      
      setDescontos(prev => [...prev, {
        id: genId(), fornecedor: fornecedor || 'Diversos', campanha: campanha || `Desconto ${percentual}%`, percentual, produtosAfetados: aplicados, data: now()
      }]);

      if (bloqueados > 0) toast.info(`${bloqueados} produto(s) com desconto BLOQUEADO. ${aplicados} receberam desconto.`);

      await registrarHistorico({ 
        arquivo: '-', fornecedor: fornecedor || 'Diversos', usuario: 'Admin', data: now(), 
        tipoConversao: 'Aplicação de Desconto', qtdItens: aplicados, status: 'concluído' 
      });
    } catch (e) {
      toast.error("Erro ao aplicar desconto.");
    }
  }, [produtosPadronizados, registrarHistorico]);

  const aplicarIpi = useCallback(async (ids: string[], novoIpi: number, fornecedor?: string, updatesIndividuais?: { id: string; ipi: number }[]) => {
    try {
      const updates = updatesIndividuais || ids.map(id => ({ id, ipi: novoIpi }));
      
      const results = await Promise.all(updates.map(async (update) => {
        const p = produtosPadronizados.find(x => x.id === update.id);
        if (!p) return null;
        await (supabase.from('standardized_products') as any).update({ ipi: update.ipi }).eq('id', update.id);
        return { ...p, ipi: update.ipi };
      }));

      const updatedProds = results.filter(Boolean) as Produto[];
      setProdutosPadronizados(prev => prev.map(p => updatedProds.find(u => u.id === p.id) || p));

      await registrarHistorico({
        arquivo: '-', fornecedor: fornecedor || 'Diversos', usuario: 'Admin', data: now(),
        tipoConversao: updatesIndividuais ? 'Desconto no IPI em Massa' : 'Alteração de IPI em Massa', 
        qtdItens: updates.length, status: 'concluído'
      });
    } catch (e) {
      toast.error("Erro ao aplicar IPI.");
    }
  }, [produtosPadronizados, registrarHistorico]);

  // Multiplica o PREÇO BASE por um fator (reunião 06/07): alguns fornecedores
  // mandam o preço pela metade do valor do cliente (ex: catálogo x2). Recalcula
  // o preço final preservando o desconto já aplicado no produto.
  const aplicarMultiplicadorPreco = useCallback(async (ids: string[], fator: number, fornecedor?: string) => {
    if (!fator || fator <= 0) { toast.error("Informe um fator de multiplicação válido (> 0)."); return; }
    try {
      const results = await Promise.all(ids.map(async (id) => {
        const p = produtosPadronizados.find(x => x.id === id);
        if (!p) return null;
        const novoPrecoBase = +(p.precoBase * fator).toFixed(2);
        const desc = p.descontoPercentual || 0;
        const novoPrecoFinal = p.bloqueiaDesconto
          ? novoPrecoBase
          : +(novoPrecoBase * (1 - desc / 100)).toFixed(2);

        await (supabase.from('standardized_products') as any).update({
          base_price: novoPrecoBase, final_price: novoPrecoFinal
        }).eq('id', id);

        return { ...p, precoBase: novoPrecoBase, precoFinal: novoPrecoFinal };
      }));

      const updatedProds = results.filter(Boolean) as Produto[];
      setProdutosPadronizados(prev => prev.map(p => updatedProds.find(u => u.id === p.id) || p));

      await registrarHistorico({
        arquivo: '-', fornecedor: fornecedor || 'Diversos', usuario: 'Admin', data: now(),
        tipoConversao: `Multiplicador de Preço (x${fator})`, qtdItens: updatedProds.length, status: 'concluído'
      });
    } catch (e) {
      toast.error("Erro ao aplicar multiplicador de preço.");
    }
  }, [produtosPadronizados, registrarHistorico]);

  const limparBase = useCallback(async (fornecedorNome?: string) => {
    try {
      if (fornecedorNome) {
        await (supabase.from('standardized_products') as any).delete().eq('supplier_name', fornecedorNome);
        setProdutosPadronizados(prev => prev.filter(p => p.fornecedor !== fornecedorNome));
      } else {
        await (supabase.from('standardized_products') as any).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        setProdutosPadronizados([]);
      }
      toast.success(fornecedorNome ? `Produtos da ${fornecedorNome} removidos.` : "Toda a base foi limpa!");
    } catch (e) {
      toast.error("Erro ao limpar a base de dados.");
    }
  }, []);

  return (
    <ProdutosContext.Provider value={{
      produtosPadronizados, setProdutosPadronizados, descontos, addProdutos, addProdutosNormalizados,
      updateProduto, validarProdutos, aplicarDesconto, aplicarIpi, aplicarMultiplicadorPreco, limparBase
    }}>
      {children}
    </ProdutosContext.Provider>
  );
}
