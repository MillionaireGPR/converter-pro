import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";
import { supabase } from "../integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "./AuthContext";
import { OperacaoHistorico, ConversaoSalva, ArquivoProcessado } from "./types"; // I'll create a types.ts

const CONVERSOES_STORAGE_KEY = 'converter-pro-conversoes-salvas';
const LIMPEZA_HISTORICO_KEY = 'converter-pro-limpeza-historico-em';
const RETENCAO_DIAS = 14;

interface HistoricoContextType {
  historico: OperacaoHistorico[];
  conversoesSalvas: ConversaoSalva[];
  arquivos: ArquivoProcessado[];
  setArquivos: React.Dispatch<React.SetStateAction<ArquivoProcessado[]>>;
  registrarHistorico: (op: Omit<OperacaoHistorico, 'id'>) => Promise<void>;
  salvarConversao: (dados: Omit<ConversaoSalva, 'id' | 'data'>) => Promise<string>;
  reabrirConversao: (id: string) => Promise<ConversaoSalva | null>;
  excluirConversao: (id: string) => Promise<void>;
  exportarImagensConversao: (id: string) => Promise<{ sucesso: boolean; zipBlob?: Blob; zipUrl?: string; mensagem: string }>;
}

const HistoricoContext = createContext<HistoricoContextType | null>(null);

export function useHistorico() {
  const ctx = useContext(HistoricoContext);
  if (!ctx) throw new Error("useHistorico must be used within HistoricoProvider");
  return ctx;
}

let nextId = 1;
const genId = () => String(Date.now() + nextId++);
const now = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function HistoricoProvider({ children }: { children: ReactNode }) {
  const [historico, setHistorico] = useState<OperacaoHistorico[]>([]);
  const [conversoesSalvas, setConversoesSalvas] = useState<ConversaoSalva[]>([]);
  const [arquivos, setArquivos] = useState<ArquivoProcessado[]>([]);
  // Usuário logado (AuthProvider envolve o AppProvider — ver App.tsx).
  // Fonte ÚNICA de verdade do autor da operação: as ~12 telas que chamam
  // registrarHistorico passavam usuario:'Admin' hardcoded, então o histórico
  // no banco não permitia auditar QUEM fez cada conversão (11/08/2026).
  // Resolver aqui (e não em cada tela) garante que nenhuma chamada nova
  // volte a gravar autor errado por esquecimento.
  const { usuario: usuarioLogado } = useAuth();

  useEffect(() => {
    async function load() {
      // Limpeza de retenção (14 dias) ANTES de ler — oportunista, no máximo
      // 1x/dia por navegador (fallback do pg_cron da migration 20260827,
      // que só roda se a extensão estiver habilitada no projeto Supabase).
      // O histórico é painel de diagnóstico recente, não arquivo morto: os
      // fornecedores atualizam catálogo toda semana, então 14 dias já cobre
      // "essa semana vs a passada" sem acumular indefinidamente.
      try {
        const ultimaLimpeza = Number(localStorage.getItem(LIMPEZA_HISTORICO_KEY) || 0);
        if (Date.now() - ultimaLimpeza > 24 * 60 * 60 * 1000) {
          const corte = new Date(Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000).toISOString();
          await (supabase.from('export_history') as any).delete().lt('created_at', corte);
          localStorage.setItem(LIMPEZA_HISTORICO_KEY, String(Date.now()));
        }
      } catch (e) {
        console.warn('Erro na limpeza de retenção do histórico', e);
      }

      try {
        const { data: histData } = await (supabase.from('export_history') as any).select('*').order('date', { ascending: false });
        if (histData) {
          setHistorico(histData.map((h: any) => ({
            id: h.id,
            arquivo: h.filename,
            fornecedor: h.supplier_name || '-',
            // Sem inventar 'Admin' na leitura: registros antigos (anteriores ao
            // fix de autoria de 11/08/2026) podem não ter autor confiável.
            usuario: h.user_name || '-',
            data: h.date,
            tipoConversao: h.conversion_type || '',
            qtdItens: h.item_count || 0,
            status: h.status as any,
            servidor: h.server_used || undefined,
            duracaoSeg: h.duration_sec ?? undefined,
            parserUsado: h.parser_used || undefined,
            usouIA: h.used_ai ?? undefined,
            imagensEncontradas: h.images_found ?? undefined,
            imagensAssociadas: h.images_matched ?? undefined,
            imagensFalhas: h.images_failed ?? undefined,
            relatorioFalhas: h.failure_report || undefined,
          })));
        }
      } catch (e) {
        console.warn('Erro ao carregar histórico', e);
      }

      try {
        const salvos = localStorage.getItem(CONVERSOES_STORAGE_KEY);
        if (salvos) setConversoesSalvas(JSON.parse(salvos));
      } catch (e) {
        console.warn('Erro localstorage conversões', e);
      }
    }
    load();
  }, []);

  const registrarHistorico = useCallback(async (op: Omit<OperacaoHistorico, 'id'>) => {
    // O autor SEMPRE vem da sessão logada. O op.usuario das telas é ignorado
    // de propósito (era 'Admin' fixo em todas elas) — só serve de fallback
    // se por algum motivo não houver sessão.
    const autor = usuarioLogado || op.usuario || 'Desconhecido';
    const base = {
      filename: op.arquivo,
      supplier_name: op.fornecedor,
      user_name: autor,
      conversion_type: op.tipoConversao,
      item_count: op.qtdItens,
      status: op.status,
    };
    const colunasEstruturadas = {
      server_used: op.servidor ?? null,
      duration_sec: op.duracaoSeg ?? null,
      parser_used: op.parserUsado ?? null,
      used_ai: op.usouIA ?? null,
      images_found: op.imagensEncontradas ?? null,
      images_matched: op.imagensAssociadas ?? null,
      images_failed: op.imagensFalhas ?? null,
      failure_report: op.relatorioFalhas ?? null,
    };

    let { data, error } = await (supabase.from('export_history') as any)
      .insert({ ...base, ...colunasEstruturadas })
      .select()
      .single();

    // Fallback: se a migration 20260827 (colunas estruturadas) ainda não
    // rodou nesse projeto Supabase, o insert acima falha com "column does
    // not exist" — tenta de novo só com as colunas antigas pra não quebrar
    // o registro de histórico enquanto a SQL não é aplicada manualmente.
    if (error) {
      console.warn('Insert com colunas estruturadas falhou, tentando sem elas:', error.message);
      ({ data, error } = await (supabase.from('export_history') as any).insert(base).select().single());
    }

    if (error) {
      console.error(error);
      toast.error("Erro ao salvar histórico.");
      return;
    }
    if (data) {
      setHistorico(prev => [{
        id: data.id, arquivo: data.filename, fornecedor: data.supplier_name || '-',
        usuario: data.user_name || autor, data: data.date || now(),
        tipoConversao: data.conversion_type || '', qtdItens: data.item_count || 0, status: data.status as any,
        servidor: data.server_used || undefined,
        duracaoSeg: data.duration_sec ?? undefined,
        parserUsado: data.parser_used || undefined,
        usouIA: data.used_ai ?? undefined,
        imagensEncontradas: data.images_found ?? undefined,
        imagensAssociadas: data.images_matched ?? undefined,
        imagensFalhas: data.images_failed ?? undefined,
        relatorioFalhas: data.failure_report || undefined,
      }, ...prev]);
    }
  }, [usuarioLogado]);

  const salvarConversao = useCallback(async (dados: Omit<ConversaoSalva, 'id' | 'data'>) => {
    try {
      const id = genId();
      const nova: ConversaoSalva = { ...dados, id, data: now() };
      setConversoesSalvas(prev => {
        const atualizado = [nova, ...prev].slice(0, 10);
        try {
          const leve = atualizado.map(c => ({
            ...c,
            imagens: c.imagens?.map(img => ({ id: img.id, nome: img.nome, temporaryId: img.temporaryId })) || []
          }));
          localStorage.setItem(CONVERSOES_STORAGE_KEY, JSON.stringify(leve));
        } catch (e) {
          localStorage.removeItem(CONVERSOES_STORAGE_KEY);
        }
        return atualizado;
      });
      toast.success(`Conversão salva: ${dados.arquivo}`);
      return id;
    } catch (e) {
      toast.error("Erro ao salvar conversão");
      throw e;
    }
  }, []);

  const reabrirConversao = useCallback(async (id: string) => {
    const conversao = conversoesSalvas.find(c => c.id === id);
    if (!conversao) {
      toast.error("Conversão não encontrada");
      return null;
    }
    // NOTA: O chamador (ConversaoProdutos) será responsável por setar os produtos no ProdutosContext
    toast.success(`Conversão reaberta: ${conversao.arquivo}`);
    return conversao;
  }, [conversoesSalvas]);

  const excluirConversao = useCallback(async (id: string) => {
    setConversoesSalvas(prev => {
      const atualizado = prev.filter(c => c.id !== id);
      try { localStorage.setItem(CONVERSOES_STORAGE_KEY, JSON.stringify(atualizado)); } catch (e) {}
      return atualizado;
    });
    toast.success("Conversão removida");
  }, []);

  const exportarImagensConversao = useCallback(async (id: string) => {
    const conversao = conversoesSalvas.find(c => c.id === id);
    if (!conversao) return { sucesso: false, mensagem: "Não encontrada" };
    if (conversao.zipUrl) return { sucesso: true, zipUrl: conversao.zipUrl, mensagem: "ZIP disponível" };
    if (!conversao.imagens || conversao.imagens.length === 0) return { sucesso: false, mensagem: "Sem imagens" };

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const pasta = zip.folder('imagens');
      let sucessos = 0, falhas = 0;

      for (const img of conversao.imagens) {
        try {
          if (img.url?.startsWith('data:')) {
            pasta?.file(img.nome, img.url.split(',')[1], { base64: true });
            sucessos++;
          } else if (img.url?.startsWith('blob:')) {
            const res = await fetch(img.url);
            pasta?.file(img.nome, await res.blob());
            sucessos++;
          }
        } catch (e) { falhas++; }
      }
      if (sucessos === 0) return { sucesso: false, mensagem: "Nenhuma exportada" };
      return { sucesso: true, zipBlob: await zip.generateAsync({ type: 'blob' }), mensagem: `${sucessos} imagens exportadas` };
    } catch (e) {
      return { sucesso: false, mensagem: "Erro ao criar ZIP" };
    }
  }, [conversoesSalvas]);

  return (
    <HistoricoContext.Provider value={{
      historico, conversoesSalvas, arquivos, setArquivos,
      registrarHistorico, salvarConversao, reabrirConversao, excluirConversao, exportarImagensConversao
    }}>
      {children}
    </HistoricoContext.Provider>
  );
}
