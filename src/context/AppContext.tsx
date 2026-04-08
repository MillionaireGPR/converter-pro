import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode, useEffect } from "react";
import { ProdutoNormalizado } from "../core/types";
import { validarProduto as motorValidar } from "../core/validators";
import { supabase } from "../integrations/supabase/client";
import { toast } from "sonner";

// ===== CONSTANTS =====
const LOCAL_STORAGE_KEY = 'converter-pro-ultima-conversao';
const LAST_CONVERSION_KEY = 'converter-pro-last-conversion-timestamp';

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
  fornecedorId?: string;
  codigoOriginal: string;
  codigoFinal: string;
  nome: string;
  descricao: string;
  precoBase: number;
  descontoPercentual: number;
  descontoString?: string;
  precoFinal: number;
  ipi: number;
  unidade: string;
  // Campos visuais (família CLINK/FLASH/MOMENT)
  visualCategory?: 'promocional' | 'preco-fixo' | 'novidade-reposicao' | 'padrao';
  isPromotional?: boolean;
  isFixedPrice?: boolean;
  additionalInfo?: string;
  qtdCaixa: number;
  categoria: string;
  embalagem: string;
  status: StatusProduto;
  erros: string[];
  imagemUrl?: string;
  temImagem?: boolean;
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
    return { id: genId(), fornecedor: 'Tramontina', codigoOriginal: i.cod, codigoFinal: `NR-${i.cod}`, nome: i.nome, descricao: i.desc, precoBase: i.preco, descontoPercentual: desconto, precoFinal: pf, ipi, unidade: i.un, qtdCaixa: i.qtd, categoria: i.cat, embalagem: i.emb, status: 'validado' as StatusProduto, erros: [] };
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
    return { id: genId(), fornecedor: 'Vonder', codigoOriginal: i.cod, codigoFinal: `NR-${i.cod}`, nome: i.nome, descricao: i.desc, precoBase: i.preco, descontoPercentual: desconto, precoFinal: pf, ipi, unidade: i.un, qtdCaixa: i.qtd, categoria: i.cat, embalagem: i.emb, status: 'pendente' as StatusProduto, erros: [] };
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
    return { id: genId(), fornecedor: 'Bosch', codigoOriginal: i.cod, codigoFinal: i.codFinal, nome: i.nome, descricao: i.desc, precoBase: i.preco, descontoPercentual: desconto, precoFinal: pf, ipi, unidade: i.un, qtdCaixa: i.qtd, categoria: i.cat, embalagem: i.emb, status: i.status, erros: [] };
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
    return { id: genId(), fornecedor: 'Starrett', codigoOriginal: i.cod, codigoFinal: `NR-${i.cod}`, nome: i.nome, descricao: i.desc, precoBase: i.preco, descontoPercentual: desconto, precoFinal: pf, ipi, unidade: i.un, qtdCaixa: i.qtd, categoria: i.cat, embalagem: i.emb, status: 'validado' as StatusProduto, erros: [] };
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
    return { id: genId(), fornecedor: 'Irwin', codigoOriginal: i.cod, codigoFinal: `NR-${i.cod}`, nome: i.nome, descricao: i.desc, precoBase: i.preco, descontoPercentual: desconto, precoFinal: pf, ipi, unidade: i.un, qtdCaixa: i.qtd, categoria: i.cat, embalagem: i.emb, status: 'pendente' as StatusProduto, erros: [] };
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
  isLoading: boolean;

  // Actions
  processarArquivo: (fornecedorId: string, tipoArquivo: string) => { produtos: Produto[]; fornecedorNome: string; fileName: string };
  addProdutos: (prods: Produto[]) => Promise<void>;
  addProdutosNormalizados: (prods: ProdutoNormalizado[]) => Promise<void>;
  updateProduto: (id: string, updates: Partial<Produto>) => Promise<void>;
  validarProdutos: (ids: string[]) => Promise<void>;
  aplicarDesconto: (ids: string[], percentual: number, campanha?: string, fornecedor?: string, descontoString?: string) => Promise<void>;
  aplicarIpi: (ids: string[], ipi: number, fornecedor?: string, updatesIndividuais?: { id: string; ipi: number }[]) => Promise<void>;
  exportarMercos: (prods: Produto[]) => Promise<void>;
  gerarCatalogo: (cat: Omit<CatalogoGerado, 'id'>) => void;
  converterPedido: (destino: string, itens: PedidoItem[]) => void;
  registrarHistorico: (op: Omit<OperacaoHistorico, 'id'>) => Promise<void>;
  updateFornecedor: (id: string, updates: Partial<Fornecedor>) => Promise<void>;
  removeFornecedor: (id: string, deleteData?: boolean) => Promise<void>;
  addRegra: (regra: Omit<RegraMapeamento, 'id'>) => void;
  updateRegra: (id: string, regra: Omit<RegraMapeamento, 'id'>) => void;
  removeRegra: (id: string) => void;
  detectedHeaders: string[];
  setDetectedHeaders: (headers: string[]) => void;
  getFornecedorByName: (nome: string) => Fornecedor | undefined;
  seedSuppliers: () => Promise<void>;
  limparBase: (fornecedorNome?: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

// ===== PROVIDER =====

export function AppProvider({ children }: { children: ReactNode }) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [arquivos, setArquivos] = useState<ArquivoProcessado[]>([]);
  const [produtosPadronizados, setProdutosPadronizados] = useState<Produto[]>([]);
  const [regrasMapeamento, setRegrasMapeamento] = useState<RegraMapeamento[]>(initialRegras);
  const [descontos, setDescontos] = useState<DescontoSalvo[]>([]);
  const [exportacoesMercos, setExportacoesMercos] = useState<ExportacaoMercos[]>([]);
  const [catalogosGerados, setCatalogosGerados] = useState<CatalogoGerado[]>([]);
  const [pedidosConvertidos, setPedidosConvertidos] = useState<PedidoConvertido[]>([]);
  const [historico, setHistorico] = useState<OperacaoHistorico[]>([]);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // === Carregar dados do Supabase ao iniciar ===
  useEffect(() => {
    async function loadInitialData() {
      try {
        setIsLoading(true);
        
        // 1. Fornecedores
        const { data: fornData, error: fornError } = await supabase.from('suppliers').select('*');
        if (fornError) throw fornError;
        if (fornData) {
          setFornecedores(fornData.map(f => ({
            id: f.id,
            nome: f.name,
            tipoArquivo: f.file_type || 'Excel',
            frequencia: f.frequency || 'Semanal',
            descontoPadrao: f.default_discount || 0,
            ipiPadrao: f.default_ipi || 0,
            ultimoProcessamento: f.last_processed || '',
            totalProdutos: f.total_products || 0,
            status: f.status as any
          })));
        }

        // 2. Produtos
        const { data: prodData, error: prodError } = await supabase.from('standardized_products').select('*');
        if (prodError) throw prodError;
        if (prodData) {
          setProdutosPadronizados(prodData.map(p => {
            let fornNome = p.supplier_name;
            const refFornecedor = fornData?.find(f => f.id === p.supplier_id || f.name === p.supplier_name);
            if (refFornecedor) fornNome = refFornecedor.name;

            return {
              id: p.id,
              fornecedor: fornNome,
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
              erros: (p.errors as any) || [],
              imagemUrl: p.image_url || '',
              temImagem: p.has_image || false,
              // Campos visuais reidratados do banco
              visualCategory: (p as any).visual_category || undefined,
              isPromotional: (p as any).is_promotional || false,
              isFixedPrice: (p as any).is_fixed_price || false,
              additionalInfo: (p as any).additional_info || '',
            };
          }));
        }

        // 3. Histórico
        const { data: histData, error: histError } = await supabase.from('export_history').select('*').order('date', { ascending: false });
        if (histError) throw histError;
        if (histData) {
          setHistorico(histData.map(h => {
            let fornNomeHist = h.supplier_name || '-';
            const refFornecedorHist = fornData?.find(f => f.id === h.supplier_name);
            if (refFornecedorHist) fornNomeHist = refFornecedorHist.name;

            return {
              id: h.id,
              arquivo: h.filename,
              fornecedor: fornNomeHist,
              usuario: h.user_name || 'Admin',
              data: h.date,
              tipoConversao: h.conversion_type || '',
              qtdItens: h.item_count || 0,
              status: h.status as any
            };
          }));
        }

      } catch (error) {
        console.error("[Flow MVP] Erro ao carregar dados do Supabase:", error);
        toast.error("Erro de conexão. Ativando modo offline com dados base.");
        
        // --- OFFLINE FALLBACK ---
        setFornecedores([
          { id: "00000000-0000-4000-a000-000000000001", nome: "NUNES", tipoArquivo: "Excel", frequencia: "Mensal", descontoPadrao: 0, ipiPadrao: 0, ultimoProcessamento: "", totalProdutos: 0, status: "ativo" },
          { id: "00000000-0000-4000-a000-000000000002", nome: "CLINK", tipoArquivo: "Excel", frequencia: "Semanal", descontoPadrao: 15, ipiPadrao: 5, ultimoProcessamento: "", totalProdutos: 0, status: "ativo" },
          { id: "00000000-0000-4000-a000-000000000003", nome: "Tramontina", tipoArquivo: "Excel", frequencia: "Semanal", descontoPadrao: 0, ipiPadrao: 0, ultimoProcessamento: "", totalProdutos: 0, status: "ativo" }
        ]);
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialData();
  }, []);

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

  // === registrarHistorico ===
  const registrarHistorico = useCallback(async (op: Omit<OperacaoHistorico, 'id'>) => {
    try {
      const { data, error } = await supabase.from('export_history').insert({
        filename: op.arquivo,
        supplier_name: op.fornecedor,
        user_name: op.usuario,
        conversion_type: op.tipoConversao,
        item_count: op.qtdItens,
        status: op.status
      }).select().single();

      if (error) throw error;

      if (data) {
        setHistorico(prev => [{
          id: data.id,
          arquivo: data.filename,
          fornecedor: data.supplier_name || '-',
          usuario: data.user_name || 'Admin',
          data: data.date || now(),
          tipoConversao: data.conversion_type || '',
          qtdItens: data.item_count || 0,
          status: data.status as any
        }, ...prev]);
      }
    } catch (error) {
      console.error("Erro ao registrar histórico:", error);
      toast.error("Erro ao salvar histórico.");
    }
  }, []);

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

  // === seedSuppliers ===
  const seedSuppliers = useCallback(async () => {
    try {
      setIsLoading(true);
      const defaultSuppliers = [
        { name: 'Tramontina', file_type: 'Excel', frequency: 'Mensal', default_discount: 15, default_ipi: 5, status: 'ativo' },
        { name: 'Vonder', file_type: 'Excel', frequency: 'Quinzenal', default_discount: 10, default_ipi: 10, status: 'ativo' },
        { name: 'Bosch', file_type: 'PDF', frequency: 'Mensal', default_discount: 20, default_ipi: 5, status: 'ativo' },
        { name: 'Starrett', file_type: 'Excel', frequency: 'Semanal', default_discount: 5, default_ipi: 15, status: 'ativo' },
        { name: 'Irwin', file_type: 'Excel', frequency: 'Mensal', default_discount: 12, default_ipi: 8, status: 'ativo' },
      ];

      const { data: existing } = await supabase.from('suppliers').select('name');
      const existingNames = existing?.map(s => s.name) || [];
      const toInsert = defaultSuppliers.filter(s => !existingNames.includes(s.name));
      
      if (toInsert.length > 0) {
        const { error } = await supabase.from('suppliers').insert(toInsert);
        if (error) throw error;
      }

      const { data: updatedForns } = await supabase.from('suppliers').select('*');
      if (updatedForns) {
        setFornecedores(updatedForns.map(f => ({
          id: f.id, nome: f.name, tipoArquivo: f.file_type || 'Excel', frequencia: f.frequency || 'Semanal',
          descontoPadrao: f.default_discount || 0, ipiPadrao: f.default_ipi || 0,
          ultimoProcessamento: f.last_processed || '', totalProdutos: f.total_products || 0, status: f.status as any
        })));
      }
      toast.success("Fornecedores padrão adicionados com sucesso!");
    } catch (error) {
      console.error("[Flow MVP] Erro ao semear fornecedores:", error);
      toast.warning("Modo offline: Fornecedores padrão adicionados apenas localmente.");
      setFornecedores([
        { id: genId(), nome: 'Tramontina', tipoArquivo: 'Excel', frequencia: 'Mensal', descontoPadrao: 15, ipiPadrao: 5, ultimoProcessamento: "", totalProdutos: 0, status: 'ativo' },
        { id: genId(), nome: 'Vonder', tipoArquivo: 'Excel', frequencia: 'Quinzenal', descontoPadrao: 10, ipiPadrao: 10, ultimoProcessamento: "", totalProdutos: 0, status: 'ativo' },
        { id: genId(), nome: 'Bosch', tipoArquivo: 'PDF', frequencia: 'Mensal', descontoPadrao: 20, ipiPadrao: 5, ultimoProcessamento: "", totalProdutos: 0, status: 'ativo' },
        { id: genId(), nome: 'Starrett', tipoArquivo: 'Excel', frequencia: 'Semanal', descontoPadrao: 5, ipiPadrao: 15, ultimoProcessamento: "", totalProdutos: 0, status: 'ativo' },
        { id: genId(), nome: 'Irwin', tipoArquivo: 'Excel', frequencia: 'Mensal', descontoPadrao: 12, ipiPadrao: 8, ultimoProcessamento: "", totalProdutos: 0, status: 'ativo' },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // === addProdutos ===
  const addProdutos = useCallback(async (prods: Produto[]) => {
    try {
      if (prods.length === 0) return;

      // 1. Encontra fornecedores únicos envolvidos
      const fornecedoresEnvolvidos = Array.from(new Set(prods.map(p => p.fornecedor)));
      console.log(`[Flow MVP] Limpando produtos antigos do fornecedor:`, fornecedoresEnvolvidos);

      // 2. Limpa o banco de dados e o estado
      const { error: delError } = await supabase
        .from('standardized_products')
        .delete()
        .in('supplier_name', fornecedoresEnvolvidos);
        
      if (delError) console.error(`[Flow MVP] Falha ao limpar banco.`, delError);
      
      setProdutosPadronizados(prev => prev.filter(p => !fornecedoresEnvolvidos.includes(p.fornecedor)));

      const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

      const inserts = prods.map(p => {
        const sId = (p.fornecedorId && isUUID(p.fornecedorId)) ? p.fornecedorId : null;
        if (p.fornecedorId && !sId) {
          console.warn(`[Flow MVP] supplier_id "${p.fornecedorId}" não é um UUID válido. Enviando NULL para evitar erro de banco.`);
        }
        
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
          // Campos visuais
          visual_category: p.visualCategory || null,
          is_promotional: p.isPromotional || false,
          is_fixed_price: p.isFixedPrice || false,
          additional_info: p.additionalInfo || null,
        };
      });

      console.log(`[Flow MVP] Tentando salvar ${inserts.length} produtos no Supabase...`);
      const { data, error } = await (supabase.from('standardized_products') as any).insert(inserts).select();
      
      if (error) {
        console.error(`[Flow MVP] Falha no Supabase. Usando Fallback Local para ${prods.length} itens.`, error);
        toast.warning("Modo Offline: Dados salvos apenas localmente");
        const localProds = prods.map(p => ({ ...p, id: genId() }));
        setProdutosPadronizados(prev => [...prev, ...localProds]);
      } else if (data) {
        console.log(`[Flow MVP] Sucesso no Supabase. ${data.length} itens salvos.`);
        const newProds: Produto[] = data.map(p => ({
          id: p.id,
          fornecedor: p.supplier_name,
          fornecedorId: p.supplier_id || undefined,
          codigoOriginal: p.original_code,
          codigoFinal: p.final_code || '',
          visualCategory: (p as any).visual_category || undefined,
          isPromotional: (p as any).is_promotional || false,
          isFixedPrice: (p as any).is_fixed_price || false,
          additionalInfo: (p as any).additional_info || '',
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
          erros: (p.errors as any) || [],
          imagemUrl: (p as any).image_url || '',
          temImagem: (p as any).has_image || false
        }));
        setProdutosPadronizados(prev => [...prev, ...newProds]);
      }

      // Atualiza contagem nos fornecedores
      const fornMap = new Map<string, number>();
      prods.forEach(p => fornMap.set(p.fornecedor, (fornMap.get(p.fornecedor) || 0) + 1));
      
      for (const [name, count] of fornMap.entries()) {
        const f = fornecedores.find(x => x.nome === name);
        if (f && isUUID(f.id)) {
          await supabase.from('suppliers').update({ 
            total_products: f.totalProdutos + count,
            last_processed: new Date().toISOString()
          }).eq('id', f.id);
        }
      }

      // Recarrega fornecedores para garantir sincronia
      const { data: updatedForns } = await supabase.from('suppliers').select('*');
      if (updatedForns) {
        setFornecedores(updatedForns.map(f => ({
          id: f.id, nome: f.name, tipoArquivo: f.file_type || 'Excel', frequencia: f.frequency || 'Semanal',
          descontoPadrao: f.default_discount || 0, ipiPadrao: f.default_ipi || 0,
          ultimoProcessamento: f.last_processed || '', totalProdutos: f.total_products || 0, status: f.status as any
        })));
      }

    } catch (error) {
      console.error("Erro ao adicionar produtos:", error);
      toast.error("Erro ao salvar produtos no banco.");
    }
  }, [fornecedores]);

  // === addProdutosNormalizados ===
  const addProdutosNormalizados = useCallback(async (prods: ProdutoNormalizado[]) => {
    console.log(`[Flow MVP] Recebidos ${prods.length} produtos do motor para normalização visual.`);
    const mappedProds: Produto[] = prods.map(p => {
      // Extrair campos visuais do produto (gerados pela família CLINK)
      const anyProd = p as any;
      return {
      id: genId(),
      fornecedor: p.fornecedor,
      fornecedorId: p.fornecedorId,
      codigoOriginal: p.codigoOriginal,
      codigoFinal: p.codigo,
      nome: p.nome,  // Já contém ***PROMOCAO*** ou ***PRECO FIXO*** se aplicável
      descricao: p.descricaoComplementar || '',
      precoBase: p.precoBase,
      descontoPercentual: p.descontoPercentual || 0,
      descontoString: p.descontoString,
      precoFinal: p.precoFinal,
      ipi: p.ipi || 0,
      unidade: p.unidade,
      qtdCaixa: p.quantidadeCaixa,
      categoria: p.categoria || '',
      embalagem: p.embalagem || '',
      status: p.status as StatusProduto,
      erros: p.erros || [],
      // Campos visuais mapeados do pipeline CLINK
      visualCategory: anyProd.visualCategory || anyProd.visual_category || undefined,
      isPromotional: anyProd.isPromotional || false,
      isFixedPrice: anyProd.isFixedPrice || false,
      additionalInfo: anyProd.informacoesAdicionais || anyProd.additionalInfo || '',
      imagemUrl: p.imagemUrl || '',
      temImagem: p.temImagem || false,
      };
    });

    await addProdutos(mappedProds);
    
    // Salvar no cache local para persistir entre navegações
    try {
      const cacheData = {
        produtos: mappedProds,
        timestamp: new Date().toISOString(),
        totalProdutos: mappedProds.length
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cacheData));
      localStorage.setItem(LAST_CONVERSION_KEY, new Date().toISOString());
      console.log(`[Flow MVP] Última conversão salva no cache local: ${mappedProds.length} produtos`);
    } catch (error) {
      console.warn('[Flow MVP] Erro ao salvar cache local:', error);
    }
  }, [addProdutos]);

  // === updateProduto ===
  const updateProduto = useCallback(async (id: string, updates: Partial<Produto>) => {
    try {
      const p = produtosPadronizados.find(x => x.id === id);
      if (!p) return;

      const updated = { ...p, ...updates };
      if (updates.precoBase !== undefined || updates.descontoPercentual !== undefined) {
        updated.precoFinal = +(updated.precoBase * (1 - updated.descontoPercentual / 100)).toFixed(2);
      }

      console.log(`[Flow MVP] Atualizando produto ${id}:`, updates);
      const { error } = await (supabase.from('standardized_products') as any).update({
        final_code: updated.codigoFinal,
        name: updated.nome,
        description: updated.descricao,
        base_price: updated.precoBase,
        discount_percent: updated.descontoPercentual,
        final_price: updated.precoFinal,
        ipi: updated.ipi,
        unit: updated.unidade,
        box_qty: updated.qtdCaixa,
        categoria: updated.categoria,
        embalagem: updated.embalagem,
        status: updated.status,
        errors: updated.erros,
        image_url: updated.imagemUrl || null,
        has_image: updated.temImagem || false,
        visual_category: updated.visualCategory || null,
        is_promotional: updated.isPromotional || false,
        is_fixed_price: updated.isFixedPrice || false,
        additional_info: updated.additionalInfo || null,
      }).eq('id', id);

      if (error) {
        console.warn(`[Flow MVP] Supabase falhou, usando fallback local para item ${id}`);
        toast.warning("Modo Offline: Alteração salva localmente");
      }

      setProdutosPadronizados(prev => prev.map(prod => prod.id === id ? updated : prod));
    } catch (error) {
      console.error("Erro ao atualizar produto:", error);
      toast.error("Erro ao processar alteração local.");
    }
  }, [produtosPadronizados]);

  // === validarProdutos ===
  const validarProdutos = useCallback(async (ids: string[]) => {
    try {
      const results = await Promise.all(ids.map(async (id) => {
        const p = produtosPadronizados.find(x => x.id === id);
        if (!p) return null;
        
        const pNormalizado: ProdutoNormalizado = {
          fornecedor: p.fornecedor,
          codigoOriginal: p.codigoOriginal,
          codigo: p.codigoFinal || p.codigoOriginal,
          nome: p.nome,
          precoBase: p.precoBase,
          precoFinal: p.precoFinal,
          ipi: p.ipi,
          unidade: p.unidade,
          quantidadeCaixa: p.qtdCaixa,
          categoria: p.categoria,
          status: p.status as any,
          erros: p.erros,
        };

        const result = motorValidar(pNormalizado);
        const finalStatus = result.status as StatusProduto;
        const finalCode = result.status === 'validado' ? (p.codigoFinal || p.codigoOriginal) : p.codigoFinal;

        const { error } = await (supabase.from('standardized_products') as any).update({
          status: finalStatus,
          errors: result.erros,
          final_code: finalCode
        }).eq('id', id);

        if (error) console.warn(`[Flow MVP] Fallback local para validação do item ${id}`);

        return { ...p, status: finalStatus, erros: result.erros, codigoFinal: finalCode };
      }));
      
      console.log(`[Flow MVP] Validação aplicada a ${ids.length} produtos.`);

      const updatedProds = results.filter(Boolean) as Produto[];
      setProdutosPadronizados(prev => prev.map(p => {
        const upd = updatedProds.find(u => u.id === p.id);
        return upd || p;
      }));

      await registrarHistorico({ arquivo: '-', fornecedor: 'Diversos', usuario: 'Admin', data: now(), tipoConversao: 'Validação de Produtos', qtdItens: ids.length, status: 'concluído' });
    } catch (error) {
      console.error("Erro ao validar produtos:", error);
      toast.error("Erro ao salvar validação.");
    }
  }, [produtosPadronizados, registrarHistorico]);

  // === aplicarDesconto ===
  const aplicarDesconto = useCallback(async (ids: string[], percentual: number, campanha?: string, fornecedor?: string, descontoString?: string) => {
    try {
      console.log(`[Flow MVP] Aplicando desconto de ${percentual}% (${descontoString || 'Simples'}) em ${ids.length} itens.`);
      const results = await Promise.all(ids.map(async (id) => {
        const p = produtosPadronizados.find(x => x.id === id);
        if (!p) return null;
        const precoFinal = +(p.precoBase * (1 - percentual / 100)).toFixed(2);
        
        const { error } = await supabase.from('standardized_products').update({
          discount_percent: percentual,
          final_price: precoFinal
        }).eq('id', id);

        if (error) console.warn(`[Flow MVP] Supabase falhou no desconto do item ${id}, usando fallback local.`);

        return { ...p, descontoPercentual: percentual, descontoString, precoFinal };
      }));

      const updatedProds = results.filter(Boolean) as Produto[];

      setProdutosPadronizados(prev => prev.map(p => {
        const upd = updatedProds.find(u => u.id === p.id);
        return upd || p;
      }));

      setDescontos(prev => [...prev, {
        id: genId(), fornecedor: fornecedor || 'Diversos', campanha: campanha || `Desconto ${percentual}%`, percentual, produtosAfetados: ids.length, data: now()
      }]);

      await registrarHistorico({ 
        arquivo: '-', fornecedor: fornecedor || 'Diversos', usuario: 'Admin', data: now(), 
        tipoConversao: 'Aplicação de Desconto', qtdItens: ids.length, status: 'concluído' 
      });
    } catch (error) {
      console.error("Erro ao aplicar desconto:", error);
      toast.error("Erro ao salvar descontos.");
    }
  }, [produtosPadronizados, registrarHistorico]);

  // === aplicarIpi ===
  const aplicarIpi = useCallback(async (ids: string[], novoIpi: number, fornecedor?: string, updatesIndividuais?: { id: string; ipi: number }[]) => {
    try {
      // Se tiver updates individuais, usa eles; senão aplica o mesmo valor para todos
      const updates = updatesIndividuais || ids.map(id => ({ id, ipi: novoIpi }));
      
      console.log(`[Flow MVP] Aplicando IPI em ${updates.length} itens.`, updatesIndividuais ? 'Com valores individuais' : `Valor único: ${novoIpi}%`);
      
      const results = await Promise.all(updates.map(async (update) => {
        const p = produtosPadronizados.find(x => x.id === update.id);
        if (!p) return null;

        const { error } = await supabase.from('standardized_products').update({
          ipi: update.ipi
        }).eq('id', update.id);

        if (error) console.warn(`[Flow MVP] Supabase falhou no IPI do item ${update.id}, usando fallback local.`);

        return { ...p, ipi: update.ipi };
      }));

      const updatedProds = results.filter(Boolean) as Produto[];

      setProdutosPadronizados(prev => prev.map(p => {
        const upd = updatedProds.find(u => u.id === p.id);
        return upd || p;
      }));

      await registrarHistorico({
        arquivo: '-', fornecedor: fornecedor || 'Diversos', usuario: 'Admin', data: now(),
        tipoConversao: updatesIndividuais ? 'Desconto no IPI em Massa' : 'Alteração de IPI em Massa', 
        qtdItens: updates.length, 
        status: 'concluído'
      });
    } catch (error) {
      console.error("Erro ao aplicar IPI:", error);
      toast.error("Erro ao salvar IPI.");
    }
  }, [produtosPadronizados, registrarHistorico]);

  // === exportarMercos ===
  const exportarMercos = useCallback(async (prods: Produto[]) => {
    const validProds = prods.filter(p => p.status !== 'erro' && p.codigoFinal);
    console.log(`[Flow MVP] Preparando exportação Mercos com ${validProds.length} itens válidos de um total de ${prods.length} recebidos.`);
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

  // === gerarCatalogo ===
  const gerarCatalogo = useCallback((cat: Omit<CatalogoGerado, 'id'>) => {
    setCatalogosGerados(prev => [...prev, { ...cat, id: genId() }]);
  }, []);

  // === converterPedido ===
  const converterPedido = useCallback((destino: string, itens: PedidoItem[]) => {
    const total = itens.reduce((s, i) => s + i.total, 0);
    const pedido: PedidoConvertido = { id: genId(), numero: `PED-${Date.now().toString().slice(-6)}`, destino, data: now(), itens, total };
    setPedidosConvertidos(prev => [...prev, pedido]);
    registrarHistorico({ arquivo: `pedido_${pedido.numero}.xlsx`, fornecedor: '-', usuario: 'Admin', data: now(), tipoConversao: 'Conversão de Pedido', qtdItens: itens.length, status: 'concluído' });
  }, [registrarHistorico]);

  // === limparBase ===
  const limparBase = useCallback(async (fornecedorNome?: string) => {
    try {
      setIsLoading(true);
      if (fornecedorNome) {
        console.log(`[Flow MVP] Limpando base apenas para o fornecedor: ${fornecedorNome}`);
        const { error } = await supabase.from('standardized_products').delete().eq('supplier_name', fornecedorNome);
        if (error) throw error;
        setProdutosPadronizados(prev => prev.filter(p => p.fornecedor !== fornecedorNome));
      } else {
        console.log(`[Flow MVP] Limpando toda a base de produtos.`);
        const { error } = await supabase.from('standardized_products').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
        setProdutosPadronizados([]);
      }
      toast.success(fornecedorNome ? `Produtos da ${fornecedorNome} removidos.` : "Toda a base foi limpa com sucesso!");
    } catch (error) {
      console.error("[Flow MVP] Erro ao limpar base:", error);
      toast.error("Erro ao limpar a base de dados.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // === Fornecedor/Regra CRUD ===
  const updateFornecedor = useCallback(async (id: string, updates: Partial<Fornecedor>) => {
    try {
      const { error } = await supabase.from('suppliers').update({
        name: updates.nome,
        file_type: updates.tipoArquivo,
        frequency: updates.frequencia,
        default_discount: updates.descontoPadrao,
        default_ipi: updates.ipiPadrao,
        status: updates.status
      }).eq('id', id);

      if (error) throw error;
      setFornecedores(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
    } catch (error) {
      console.error("Erro ao atualizar fornecedor:", error);
      toast.error("Erro ao salvar fornecedor.");
    }
  }, []);

  const addRegra = useCallback((regra: Omit<RegraMapeamento, 'id'>) => {
    setRegrasMapeamento(prev => [...prev, { ...regra, id: genId() }]);
  }, []);

  const updateRegra = useCallback((id: string, updates: Partial<RegraMapeamento>) => {
    setRegrasMapeamento(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  }, []);

  const removeFornecedor = useCallback(async (id: string, deleteData: boolean = false) => {
    try {
      const f = fornecedores.find(x => x.id === id);
      if (!f) return;

      console.log(`[Flow MVP] Removendo fornecedor ${f.nome} (ID: ${id}). Dados vinculados: ${deleteData}`);

      if (deleteData) {
        // 1. Remove produtos (por ID ou Nome para segurança)
        await supabase.from('standardized_products').delete().or(`supplier_id.eq.${id},supplier_name.eq.${f.nome}`);
        setProdutosPadronizados(prev => prev.filter(p => p.fornecedorId !== id && p.fornecedor !== f.nome));
        
        // 2. Remove regras
        setRegrasMapeamento(prev => prev.filter(r => r.fornecedor !== f.nome));
      }

      // 3. Remove fornecedor
      const { error } = await supabase.from('suppliers').delete().eq('id', id);
      if (error) throw error;

      setFornecedores(prev => prev.filter(x => x.id !== id));
      toast.success(`Fornecedor ${f.nome} removido.`);
    } catch (error) {
      console.error("Erro ao remover fornecedor:", error);
      toast.error("Erro ao excluir fornecedor do banco.");
    }
  }, [fornecedores]);

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
      dashboard, detectedHeaders, isLoading,
      processarArquivo, addProdutos, addProdutosNormalizados, updateProduto, validarProdutos, aplicarDesconto, aplicarIpi,
      exportarMercos, gerarCatalogo, converterPedido, registrarHistorico,
      updateFornecedor, removeFornecedor, addRegra, updateRegra, removeRegra, getFornecedorByName, seedSuppliers, limparBase,
      setDetectedHeaders
    }}>
      {children}
    </AppContext.Provider>
  );
}
