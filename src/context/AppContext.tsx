import React, { createContext, useContext, useState, useMemo, ReactNode, useCallback } from "react";
import { ExportacaoMercos, CatalogoGerado, PedidoConvertido, PedidoItem, DashboardData } from "./types";
import { HistoricoProvider, useHistorico } from "./HistoricoContext";
import { FornecedoresProvider, useFornecedores } from "./FornecedoresContext";
import { ProdutosProvider, useProdutos } from "./ProdutosContext";

// Re-export todos os tipos para não quebrar imports existentes
export * from "./types";

interface AppContextType {
  exportacoesMercos: ExportacaoMercos[];
  catalogosGerados: CatalogoGerado[];
  pedidosConvertidos: PedidoConvertido[];
  dashboard: DashboardData;
  detectedHeaders: string[];
  setDetectedHeaders: React.Dispatch<React.SetStateAction<string[]>>;
  
  processarArquivo: (fornecedorId: string, tipoArquivo: string) => { produtos: any[]; fornecedorNome: string; fileName: string };
  exportarMercos: (prods: any[]) => Promise<void>;
  gerarCatalogo: (cat: Omit<CatalogoGerado, 'id'>) => void;
  converterPedido: (destino: string, itens: PedidoItem[]) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

let nextId = 1;
const genId = () => String(Date.now() + nextId++);
const now = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function AppCoreProvider({ children }: { children: ReactNode }) {
  const [exportacoesMercos, setExportacoesMercos] = useState<ExportacaoMercos[]>([]);
  const [catalogosGerados, setCatalogosGerados] = useState<CatalogoGerado[]>([]);
  const [pedidosConvertidos, setPedidosConvertidos] = useState<PedidoConvertido[]>([]);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);

  // Consumir os outros contextos para gerar o Dashboard
  const { arquivos, historico } = useHistorico();
  const { produtosPadronizados } = useProdutos();
  const { fornecedores } = useFornecedores();
  const { registrarHistorico } = useHistorico();

  const dashboard = useMemo<DashboardData>(() => {
    const arquivosProcessados = arquivos.filter(a => a.status === 'concluído').length;
    const produtosConvertidos = produtosPadronizados.length;
    const exportacoesMercosCount = exportacoesMercos.length;
    const catalogosGeradosCount = catalogosGerados.length;
    const fornecedoresAtivos = fornecedores.filter(f => f.status === 'ativo' && f.totalProdutos > 0).length;
    const pedidosConvertidosCount = pedidosConvertidos.length;
    const alertasPendentes = produtosPadronizados.filter(p => p.status === 'erro' || p.status === 'incompleto').length;
    const taxaAproveitamento = produtosConvertidos > 0
      ? Math.round((produtosPadronizados.filter(p => p.status === 'validado').length / produtosConvertidos) * 100)
      : 0;
    return { arquivosProcessados, produtosConvertidos, exportacoesMercosCount, catalogosGeradosCount, fornecedoresAtivos, pedidosConvertidosCount, taxaAproveitamento, alertasPendentes };
  }, [arquivos, produtosPadronizados, exportacoesMercos, catalogosGerados, fornecedores, pedidosConvertidos]);

  const processarArquivo = useCallback((fornecedorId: string, tipoArquivo: string) => {
    const forn = fornecedores.find(f => f.id === fornecedorId);
    if (!forn) throw new Error("Fornecedor não encontrado");
    return { produtos: [], fornecedorNome: forn.nome, fileName: `arquivo_${forn.nome.toLowerCase()}.xlsx` };
  }, [fornecedores]);

  const exportarMercos = useCallback(async (prods: any[]) => {
    const validProds = prods.filter(p => p.status !== 'erro' && p.codigoFinal);
    setExportacoesMercos(prev => [...prev, { id: genId(), data: now(), produtos: validProds, status: 'gerada' }]);
    await registrarHistorico({ 
      arquivo: `export_mercos_${Date.now()}.xlsx`, 
      fornecedor: validProds[0]?.fornecedor || '-', 
      usuario: 'Admin', data: now(), 
      tipoConversao: 'Exportação Mercos', 
      qtdItens: validProds.length, 
      status: 'concluído' 
    });
  }, [registrarHistorico]);

  const gerarCatalogo = useCallback((cat: Omit<CatalogoGerado, 'id'>) => {
    setCatalogosGerados(prev => [...prev, { ...cat, id: genId() }]);
  }, []);

  const converterPedido = useCallback((destino: string, itens: PedidoItem[]) => {
    const total = itens.reduce((s, i) => s + i.total, 0);
    const pedido: PedidoConvertido = { id: genId(), numero: `PED-${Date.now().toString().slice(-6)}`, destino, data: now(), itens, total };
    setPedidosConvertidos(prev => [...prev, pedido]);
    registrarHistorico({ arquivo: `pedido_${pedido.numero}.xlsx`, fornecedor: '-', usuario: 'Admin', data: now(), tipoConversao: 'Conversão de Pedido', qtdItens: itens.length, status: 'concluído' });
  }, [registrarHistorico]);

  return (
    <AppContext.Provider value={{
      exportacoesMercos, catalogosGerados, pedidosConvertidos,
      dashboard, detectedHeaders, setDetectedHeaders,
      processarArquivo, exportarMercos, gerarCatalogo, converterPedido
    }}>
      {children}
    </AppContext.Provider>
  );
}

// O AppProvider mestre que injeta toda a hierarquia de contextos para a aplicação
export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <HistoricoProvider>
      <FornecedoresProvider>
        <ProdutosProvider>
          <AppCoreProvider>
            {children}
          </AppCoreProvider>
        </ProdutosProvider>
      </FornecedoresProvider>
    </HistoricoProvider>
  );
}
