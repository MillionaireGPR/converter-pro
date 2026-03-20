import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";

// ===== TYPES =====

export type StatusProduto = 'validado' | 'pendente' | 'erro' | 'incompleto';

export interface Fornecedor {
  id: string;
  nome: string;
  tipoArquivo: string;
  frequencia: string;
  descontoPadrao: number;
  ipiPadrao: number;
  ultimoProcessamento: string;
  totalProdutos: number;
  status: 'ativo' | 'inativo';
}

export interface ArquivoProcessado {
  id: string;
  nome: string;
  fornecedor: string;
  tipo: string;
  data: string;
  qtdProdutos: number;
  status: 'concluído' | 'erro';
}

export interface Produto {
  id: string;
  fornecedor: string;
  codigoOriginal: string;
  codigoFinal: string;
  nome: string;
  descricao: string;
  precoBase: number;
  desconto: number;
  precoFinal: number;
  ipi: number;
  unidade: string;
  qtdCaixa: number;
  categoria: string;
  embalagem: string;
  status: StatusProduto;
}

export interface RegraMapeamento {
  id: string;
  fornecedor: string;
  colunaOrigem: string;
  colunaDestino: string;
  tipo: 'direto' | 'formula' | 'fixo';
  valor?: string;
}

export interface DescontoSalvo {
  id: string;
  fornecedor: string;
  campanha: string;
  percentual: number;
  produtosAfetados: number;
  data: string;
}

export interface OperacaoHistorico {
  id: string;
  arquivo: string;
  fornecedor: string;
  usuario: string;
  data: string;
  tipoConversao: string;
  qtdItens: number;
  status: 'concluído' | 'erro' | 'processando';
}

export interface ExportacaoMercos {
  id: string;
  data: string;
  produtos: Produto[];
  status: 'gerada' | 'pendente';
}

export interface CatalogoGerado {
  id: string;
  nome: string;
  fornecedor: string;
  desconto: number;
  data: string;
  qtdProdutos: number;
}

export interface PedidoConvertido {
  id: string;
  numero: string;
  destino: string;
  data: string;
  itens: PedidoItem[];
  total: number;
}

export interface PedidoItem {
  codigo: string;
  descricao: string;
  qtd: number;
  preco: number;
  total: number;
}

export interface DashboardData {
  arquivosProcessados: number;
  produtosConvertidos: number;
  exportacoesMercosCount: number;
  catalogosGeradosCount: number;
  fornecedoresAtivos: number;
  pedidosConvertidosCount: number;
  taxaAproveitamento: number;
  alertasPendentes: number;
}

// ===== INITIAL DATA =====

const initialFornecedores: Fornecedor[] = [
  { id: '1', nome: 'Tramontina', tipoArquivo: 'Excel', frequencia: 'Semanal', descontoPadrao: 15, ipiPadrao: 5, ultimoProcessamento: '2026-03-15', totalProdutos: 0, status: 'ativo' },
  { id: '2', nome: 'Vonder', tipoArquivo: 'PDF Tabela', frequencia: 'Mensal', descontoPadrao: 10, ipiPadrao: 8, ultimoProcessamento: '2026-03-12', totalProdutos: 0, status: 'ativo' },
  { id: '3', nome: 'Starrett', tipoArquivo: 'Excel', frequencia: 'Quinzenal', descontoPadrao: 12, ipiPadrao: 5, ultimoProcessamento: '2026-03-10', totalProdutos: 0, status: 'ativo' },
  { id: '4', nome: 'Bosch', tipoArquivo: 'PDF Catálogo', frequencia: 'Mensal', descontoPadrao: 18, ipiPadrao: 10, ultimoProcessamento: '2026-03-08', totalProdutos: 0, status: 'ativo' },
  { id: '5', nome: 'Irwin', tipoArquivo: 'Excel', frequencia: 'Semanal', descontoPadrao: 8, ipiPadrao: 5, ultimoProcessamento: '2026-02-28', totalProdutos: 0, status: 'inativo' },
];

const initialRegras: RegraMapeamento[] = [
  { id: '1', fornecedor: 'Tramontina', colunaOrigem: 'Cod For', colunaDestino: 'Código do Produto', tipo: 'direto' },
  { id: '2', fornecedor: 'Tramontina', colunaOrigem: 'Descr Compl', colunaDestino: 'Nome do Produto', tipo: 'direto' },
  { id: '3', fornecedor: 'Tramontina', colunaOrigem: 'P.Venda', colunaDestino: 'Preço Base', tipo: 'direto' },
  { id: '4', fornecedor: 'Vonder', colunaOrigem: 'CODIGO', colunaDestino: 'Código do Produto', tipo: 'direto' },
  { id: '5', fornecedor: 'Vonder', colunaOrigem: 'DESCRICAO + MEDIDA', colunaDestino: 'Nome do Produto', tipo: 'formula' },
  { id: '6', fornecedor: 'Bosch', colunaOrigem: 'EAN', colunaDestino: 'Código do Produto', tipo: 'direto' },
  { id: '7', fornecedor: 'Bosch', colunaOrigem: 'IPI fixo 10%', colunaDestino: 'IPI', tipo: 'fixo', valor: '10' },
];

// ===== PRODUCT GENERATORS =====

let nextId = 1;
const genId = () => String(nextId++);

function generateTramontinaProducts(desconto: number, ipi: number): Produto[] {
  const items = [
    { cod: 'TRM-001', nome: 'Jogo de Chaves Combinadas 6-22mm', desc: 'Jogo com 12 peças em aço cromo vanádio', preco: 189.90, cat: 'Ferramentas Manuais', un: 'JG', qtd: 6, emb: 'Caixa' },
    { cod: 'TRM-002', nome: 'Alicate Universal 8"', desc: 'Alicate universal com cabo isolado 1000V', preco: 54.90, cat: 'Ferramentas Manuais', un: 'UN', qtd: 12, emb: 'Blister' },
    { cod: 'TRM-003', nome: 'Trena 5m com Trava', desc: 'Trena emborrachada com trava automática', preco: 29.90, cat: 'Medição', un: 'UN', qtd: 24, emb: 'Blister' },
    { cod: 'TRM-004', nome: 'Chave de Fenda Phillips 1/4x6"', desc: 'Chave Phillips com cabo ergonômico', preco: 18.50, cat: 'Ferramentas Manuais', un: 'UN', qtd: 12, emb: 'Blister' },
    { cod: 'TRM-005', nome: 'Martelo Unha 27mm', desc: 'Martelo com cabo de fibra de vidro', preco: 79.90, cat: 'Ferramentas Manuais', un: 'UN', qtd: 6, emb: 'Caixa' },
    { cod: 'TRM-006', nome: 'Serrote Profissional 18"', desc: 'Serrote com dentes travados', preco: 45.00, cat: 'Ferramentas Manuais', un: 'UN', qtd: 6, emb: 'Caixa' },
  ];
  return items.map(i => {
    const pf = +(i.preco * (1 - desconto / 100)).toFixed(2);
    return { id: genId(), fornecedor: 'Tramontina', codigoOriginal: i.cod, codigoFinal: `NR-${i.cod}`, nome: i.nome, descricao: i.desc, precoBase: i.preco, desconto, precoFinal: pf, ipi, unidade: i.un, qtdCaixa: i.qtd, categoria: i.cat, embalagem: i.emb, status: 'validado' as StatusProduto };
  });
}

function generateVonderProducts(desconto: number, ipi: number): Produto[] {
  const items = [
    { cod: 'VND-100', nome: 'Furadeira de Impacto 750W', desc: 'Furadeira com mandril 13mm e maleta', preco: 329.00, cat: 'Ferramentas Elétricas', un: 'UN', qtd: 1, emb: 'Maleta' },
    { cod: 'VND-101', nome: 'Serra Circular 7.1/4" 1400W', desc: 'Serra circular com guia laser', preco: 589.00, cat: 'Ferramentas Elétricas', un: 'UN', qtd: 1, emb: 'Caixa' },
    { cod: 'VND-102', nome: 'Nível a Laser 15m', desc: 'Nível laser com suporte magnético', preco: 149.00, cat: 'Medição', un: 'UN', qtd: 1, emb: 'Caixa' },
    { cod: 'VND-103', nome: 'Esmerilhadeira Angular 4.1/2"', desc: 'Esmerilhadeira 820W com disco', preco: 259.00, cat: 'Ferramentas Elétricas', un: 'UN', qtd: 1, emb: 'Caixa' },
    { cod: 'VND-104', nome: 'Soprador Térmico 1500W', desc: 'Soprador com 2 temperaturas', preco: 179.00, cat: 'Ferramentas Elétricas', un: 'UN', qtd: 1, emb: 'Caixa' },
  ];
  return items.map(i => {
    const pf = +(i.preco * (1 - desconto / 100)).toFixed(2);
    return { id: genId(), fornecedor: 'Vonder', codigoOriginal: i.cod, codigoFinal: `NR-${i.cod}`, nome: i.nome, descricao: i.desc, precoBase: i.preco, desconto, precoFinal: pf, ipi, unidade: i.un, qtdCaixa: i.qtd, categoria: i.cat, embalagem: i.emb, status: 'pendente' as StatusProduto };
  });
}

function generateBoschProducts(desconto: number, ipi: number): Produto[] {
  const items = [
    { cod: 'BSH-200', nome: 'Parafusadeira a Bateria 12V', desc: 'Parafusadeira com 2 baterias e carregador', preco: 459.00, cat: 'Ferramentas Elétricas', un: 'UN', qtd: 1, emb: 'Maleta', status: 'erro' as StatusProduto, codFinal: '' },
    { cod: 'BSH-201', nome: 'Disco de Corte 4.1/2"', desc: 'Disco abrasivo para metal', preco: 4.90, cat: 'Acessórios', un: 'UN', qtd: 100, emb: 'Caixa', status: 'incompleto' as StatusProduto, codFinal: '' },
    { cod: 'BSH-202', nome: 'Jogo de Brocas HSS 1-10mm', desc: 'Kit com 10 brocas para metal', preco: 89.90, cat: 'Acessórios', un: 'JG', qtd: 6, emb: 'Estojo', status: 'validado' as StatusProduto, codFinal: 'NR-BSH-202' },
    { cod: 'BSH-203', nome: 'Martelete Perfurador 800W', desc: 'Martelete SDS Plus com maleta', preco: 699.00, cat: 'Ferramentas Elétricas', un: 'UN', qtd: 1, emb: 'Maleta', status: 'erro' as StatusProduto, codFinal: '' },
  ];
  return items.map(i => {
    const pf = +(i.preco * (1 - desconto / 100)).toFixed(2);
    return { id: genId(), fornecedor: 'Bosch', codigoOriginal: i.cod, codigoFinal: i.codFinal, nome: i.nome, descricao: i.desc, precoBase: i.preco, desconto, precoFinal: pf, ipi, unidade: i.un, qtdCaixa: i.qtd, categoria: i.cat, embalagem: i.emb, status: i.status };
  });
}

function generateStarrettProducts(desconto: number, ipi: number): Produto[] {
  const items = [
    { cod: 'STR-050', nome: 'Lâmina de Serra 24D', desc: 'Lâmina bimetal flexível 12"', preco: 18.50, cat: 'Acessórios', un: 'UN', qtd: 50, emb: 'Pacote' },
    { cod: 'STR-051', nome: 'Serra Copo Bimetal 32mm', desc: 'Serra copo para metal e madeira', preco: 42.00, cat: 'Acessórios', un: 'UN', qtd: 10, emb: 'Blister' },
    { cod: 'STR-052', nome: 'Paquímetro Universal 150mm', desc: 'Paquímetro em aço inox', preco: 189.00, cat: 'Medição', un: 'UN', qtd: 1, emb: 'Estojo' },
    { cod: 'STR-053', nome: 'Micrômetro Externo 0-25mm', desc: 'Micrômetro com catraca', preco: 320.00, cat: 'Medição', un: 'UN', qtd: 1, emb: 'Estojo' },
  ];
  return items.map(i => {
    const pf = +(i.preco * (1 - desconto / 100)).toFixed(2);
    return { id: genId(), fornecedor: 'Starrett', codigoOriginal: i.cod, codigoFinal: `NR-${i.cod}`, nome: i.nome, descricao: i.desc, precoBase: i.preco, desconto, precoFinal: pf, ipi, unidade: i.un, qtdCaixa: i.qtd, categoria: i.cat, embalagem: i.emb, status: 'validado' as StatusProduto };
  });
}

function generateIrwinProducts(desconto: number, ipi: number): Produto[] {
  const items = [
    { cod: 'IRW-300', nome: 'Broca Aço Rápido 6mm', desc: 'Broca HSS para metal', preco: 12.90, cat: 'Brocas', un: 'UN', qtd: 10, emb: 'Blister' },
    { cod: 'IRW-301', nome: 'Jogo de Bits Phillips/Fenda', desc: 'Kit com 20 bits variados', preco: 34.90, cat: 'Acessórios', un: 'JG', qtd: 6, emb: 'Estojo' },
    { cod: 'IRW-302', nome: 'Broca SDS Plus 8mm', desc: 'Broca para concreto', preco: 22.50, cat: 'Brocas', un: 'UN', qtd: 10, emb: 'Blister' },
  ];
  return items.map(i => {
    const pf = +(i.preco * (1 - desconto / 100)).toFixed(2);
    return { id: genId(), fornecedor: 'Irwin', codigoOriginal: i.cod, codigoFinal: `NR-${i.cod}`, nome: i.nome, descricao: i.desc, precoBase: i.preco, desconto, precoFinal: pf, ipi, unidade: i.un, qtdCaixa: i.qtd, categoria: i.cat, embalagem: i.emb, status: 'pendente' as StatusProduto };
  });
}

const supplierGenerators: Record<string, (d: number, i: number) => Produto[]> = {
  'Tramontina': generateTramontinaProducts,
  'Vonder': generateVonderProducts,
  'Bosch': generateBoschProducts,
  'Starrett': generateStarrettProducts,
  'Irwin': generateIrwinProducts,
};

// ===== CONTEXT TYPE =====

interface AppContextType {
  // Entities
  fornecedores: Fornecedor[];
  arquivos: ArquivoProcessado[];
  produtosPadronizados: Produto[];
  regrasMapeamento: RegraMapeamento[];
  descontos: DescontoSalvo[];
  exportacoesMercos: ExportacaoMercos[];
  catalogosGerados: CatalogoGerado[];
  pedidosConvertidos: PedidoConvertido[];
  historico: OperacaoHistorico[];

  // Computed
  dashboard: DashboardData;

  // Actions
  processarArquivo: (fornecedorId: string, tipoArquivo: string) => { produtos: Produto[]; fornecedorNome: string; fileName: string };
  addProdutos: (prods: Produto[]) => void;
  updateProduto: (id: string, updates: Partial<Produto>) => void;
  validarProdutos: (ids: string[]) => void;
  aplicarDesconto: (ids: string[], percentual: number, campanha?: string, fornecedor?: string) => void;
  exportarMercos: (prods: Produto[]) => void;
  gerarCatalogo: (cat: Omit<CatalogoGerado, 'id'>) => void;
  converterPedido: (destino: string, itens: PedidoItem[]) => void;
  registrarHistorico: (op: Omit<OperacaoHistorico, 'id'>) => void;
  updateFornecedor: (id: string, updates: Partial<Fornecedor>) => void;
  addRegra: (regra: Omit<RegraMapeamento, 'id'>) => void;
  updateRegra: (id: string, updates: Partial<RegraMapeamento>) => void;
  removeRegra: (id: string) => void;
  getFornecedorByName: (nome: string) => Fornecedor | undefined;
}

const AppContext = createContext<AppContextType | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

// ===== PROVIDER =====

export function AppProvider({ children }: { children: ReactNode }) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>(initialFornecedores);
  const [arquivos, setArquivos] = useState<ArquivoProcessado[]>([]);
  const [produtosPadronizados, setProdutosPadronizados] = useState<Produto[]>([]);
  const [regrasMapeamento, setRegrasMapeamento] = useState<RegraMapeamento[]>(initialRegras);
  const [descontos, setDescontos] = useState<DescontoSalvo[]>([]);
  const [exportacoesMercos, setExportacoesMercos] = useState<ExportacaoMercos[]>([]);
  const [catalogosGerados, setCatalogosGerados] = useState<CatalogoGerado[]>([]);
  const [pedidosConvertidos, setPedidosConvertidos] = useState<PedidoConvertido[]>([]);
  const [historico, setHistorico] = useState<OperacaoHistorico[]>([]);

  const now = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // === recalcularDashboard (computed) ===
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

  // === processarArquivo ===
  const processarArquivo = useCallback((fornecedorId: string, tipoArquivo: string) => {
    const forn = fornecedores.find(f => f.id === fornecedorId);
    if (!forn) throw new Error("Fornecedor não encontrado");
    const generator = supplierGenerators[forn.nome];
    if (!generator) throw new Error("Gerador não encontrado para " + forn.nome);

    const novosProdutos = generator(forn.descontoPadrao, forn.ipiPadrao);
    const fileNames: Record<string, string> = {
      'Tramontina': 'tabela_tramontina_marco2026.xlsx',
      'Vonder': 'precos_vonder_q1.xlsx',
      'Bosch': 'catalogo_bosch_2026.pdf',
      'Starrett': 'starrett_lista_2026.pdf',
      'Irwin': 'irwin_novos_produtos.xlsx',
    };
    const fileName = fileNames[forn.nome] || `arquivo_${forn.nome.toLowerCase()}.xlsx`;

    // Register file
    setArquivos(prev => [...prev, {
      id: genId(), nome: fileName, fornecedor: forn.nome, tipo: tipoArquivo, data: now(), qtdProdutos: novosProdutos.length, status: 'concluído'
    }]);

    return { produtos: novosProdutos, fornecedorNome: forn.nome, fileName };
  }, [fornecedores]);

  // === addProdutos ===
  const addProdutos = useCallback((prods: Produto[]) => {
    setProdutosPadronizados(prev => [...prev, ...prods]);
    const fornMap = new Map<string, number>();
    prods.forEach(p => fornMap.set(p.fornecedor, (fornMap.get(p.fornecedor) || 0) + 1));
    setFornecedores(prev => prev.map(f => {
      const add = fornMap.get(f.nome);
      return add ? { ...f, totalProdutos: f.totalProdutos + add, ultimoProcessamento: new Date().toISOString().split('T')[0] } : f;
    }));
  }, []);

  // === updateProduto ===
  const updateProduto = useCallback((id: string, updates: Partial<Produto>) => {
    setProdutosPadronizados(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, ...updates };
      if (updates.precoBase !== undefined || updates.desconto !== undefined) {
        updated.precoFinal = +(updated.precoBase * (1 - updated.desconto / 100)).toFixed(2);
      }
      return updated;
    }));
  }, []);

  // === validarProdutos ===
  const validarProdutos = useCallback((ids: string[]) => {
    setProdutosPadronizados(prev => prev.map(p => ids.includes(p.id) ? { ...p, status: 'validado' as StatusProduto } : p));
    setHistorico(prev => [{ id: genId(), arquivo: '-', fornecedor: 'Diversos', usuario: 'Admin', data: now(), tipoConversao: 'Validação de Produtos', qtdItens: ids.length, status: 'concluído' as const }, ...prev]);
  }, []);

  // === aplicarDesconto ===
  const aplicarDesconto = useCallback((ids: string[], percentual: number, campanha?: string, fornecedor?: string) => {
    setProdutosPadronizados(prev => prev.map(p => {
      if (!ids.includes(p.id)) return p;
      const precoFinal = +(p.precoBase * (1 - percentual / 100)).toFixed(2);
      return { ...p, desconto: percentual, precoFinal };
    }));
    // Track saved discount
    setDescontos(prev => [...prev, {
      id: genId(), fornecedor: fornecedor || 'Diversos', campanha: campanha || `Desconto ${percentual}%`, percentual, produtosAfetados: ids.length, data: now()
    }]);
    setHistorico(prev => [{ id: genId(), arquivo: '-', fornecedor: fornecedor || 'Diversos', usuario: 'Admin', data: now(), tipoConversao: 'Aplicação de Desconto', qtdItens: ids.length, status: 'concluído' as const }, ...prev]);
  }, []);

  // === exportarMercos ===
  const exportarMercos = useCallback((prods: Produto[]) => {
    const validProds = prods.filter(p => p.status !== 'erro' && p.codigoFinal);
    setExportacoesMercos(prev => [...prev, { id: genId(), data: now(), produtos: validProds, status: 'gerada' }]);
    setHistorico(prev => [{ id: genId(), arquivo: `export_mercos_${Date.now()}.xlsx`, fornecedor: validProds[0]?.fornecedor || '-', usuario: 'Admin', data: now(), tipoConversao: 'Exportação Mercos', qtdItens: validProds.length, status: 'concluído' as const }, ...prev]);
  }, []);

  // === gerarCatalogo ===
  const gerarCatalogo = useCallback((cat: Omit<CatalogoGerado, 'id'>) => {
    setCatalogosGerados(prev => [...prev, { ...cat, id: genId() }]);
  }, []);

  // === registrarHistorico ===
  const registrarHistorico = useCallback((op: Omit<OperacaoHistorico, 'id'>) => {
    setHistorico(prev => [{ ...op, id: genId() }, ...prev]);
  }, []);

  // === converterPedido ===
  const converterPedido = useCallback((destino: string, itens: PedidoItem[]) => {
    const total = itens.reduce((s, i) => s + i.total, 0);
    const pedido: PedidoConvertido = { id: genId(), numero: `PED-${Date.now().toString().slice(-6)}`, destino, data: now(), itens, total };
    setPedidosConvertidos(prev => [...prev, pedido]);
    setHistorico(prev => [{ id: genId(), arquivo: `pedido_${pedido.numero}.xlsx`, fornecedor: '-', usuario: 'Admin', data: now(), tipoConversao: 'Conversão de Pedido', qtdItens: itens.length, status: 'concluído' as const }, ...prev]);
  }, []);

  // === Fornecedor/Regra CRUD ===
  const updateFornecedor = useCallback((id: string, updates: Partial<Fornecedor>) => {
    setFornecedores(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }, []);

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

  return (
    <AppContext.Provider value={{
      fornecedores, arquivos, produtosPadronizados, regrasMapeamento, descontos,
      exportacoesMercos, catalogosGerados, pedidosConvertidos, historico,
      dashboard,
      processarArquivo, addProdutos, updateProduto, validarProdutos, aplicarDesconto,
      exportarMercos, gerarCatalogo, converterPedido, registrarHistorico,
      updateFornecedor, addRegra, updateRegra, removeRegra, getFornecedorByName,
    }}>
      {children}
    </AppContext.Provider>
  );
}
