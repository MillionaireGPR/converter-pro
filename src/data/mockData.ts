export const fornecedores = [
  { id: '1', nome: 'Tramontina', tipoArquivo: 'Excel', frequencia: 'Semanal', descontoPadrao: 15, ipiPadrao: 5, ultimoProcessamento: '2026-03-15', totalProdutos: 342, status: 'ativo' as const },
  { id: '2', nome: 'Vonder', tipoArquivo: 'PDF Tabela', frequencia: 'Mensal', descontoPadrao: 10, ipiPadrao: 8, ultimoProcessamento: '2026-03-12', totalProdutos: 189, status: 'ativo' as const },
  { id: '3', nome: 'Starrett', tipoArquivo: 'Excel', frequencia: 'Quinzenal', descontoPadrao: 12, ipiPadrao: 5, ultimoProcessamento: '2026-03-10', totalProdutos: 95, status: 'ativo' as const },
  { id: '4', nome: 'Bosch', tipoArquivo: 'PDF Catálogo', frequencia: 'Mensal', descontoPadrao: 18, ipiPadrao: 10, ultimoProcessamento: '2026-03-08', totalProdutos: 278, status: 'ativo' as const },
  { id: '5', nome: 'Irwin', tipoArquivo: 'Excel', frequencia: 'Semanal', descontoPadrao: 8, ipiPadrao: 5, ultimoProcessamento: '2026-02-28', totalProdutos: 156, status: 'inativo' as const },
];

export type StatusProduto = 'validado' | 'pendente' | 'erro' | 'incompleto';

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

export const produtos: Produto[] = [
  { id: '1', fornecedor: 'Tramontina', codigoOriginal: 'TRM-001', codigoFinal: 'NR-TRM-001', nome: 'Jogo de Chaves Combinadas 6-22mm', descricao: 'Jogo com 12 peças em aço cromo vanádio', precoBase: 189.90, desconto: 15, precoFinal: 161.42, ipi: 5, unidade: 'JG', qtdCaixa: 6, categoria: 'Ferramentas Manuais', embalagem: 'Caixa', status: 'validado' },
  { id: '2', fornecedor: 'Tramontina', codigoOriginal: 'TRM-002', codigoFinal: 'NR-TRM-002', nome: 'Alicate Universal 8"', descricao: 'Alicate universal com cabo isolado 1000V', precoBase: 54.90, desconto: 15, precoFinal: 46.67, ipi: 5, unidade: 'UN', qtdCaixa: 12, categoria: 'Ferramentas Manuais', embalagem: 'Blister', status: 'validado' },
  { id: '3', fornecedor: 'Vonder', codigoOriginal: 'VND-100', codigoFinal: 'NR-VND-100', nome: 'Furadeira de Impacto 750W', descricao: 'Furadeira com mandril 13mm e maleta', precoBase: 329.00, desconto: 10, precoFinal: 296.10, ipi: 8, unidade: 'UN', qtdCaixa: 1, categoria: 'Ferramentas Elétricas', embalagem: 'Maleta', status: 'pendente' },
  { id: '4', fornecedor: 'Vonder', codigoOriginal: 'VND-101', codigoFinal: 'NR-VND-101', nome: 'Serra Circular 7.1/4" 1400W', descricao: 'Serra circular com guia laser', precoBase: 589.00, desconto: 10, precoFinal: 530.10, ipi: 8, unidade: 'UN', qtdCaixa: 1, categoria: 'Ferramentas Elétricas', embalagem: 'Caixa', status: 'validado' },
  { id: '5', fornecedor: 'Starrett', codigoOriginal: 'STR-050', codigoFinal: 'NR-STR-050', nome: 'Lâmina de Serra 24D', descricao: 'Lâmina bimetal flexível 12"', precoBase: 18.50, desconto: 12, precoFinal: 16.28, ipi: 5, unidade: 'UN', qtdCaixa: 50, categoria: 'Acessórios', embalagem: 'Pacote', status: 'validado' },
  { id: '6', fornecedor: 'Bosch', codigoOriginal: 'BSH-200', codigoFinal: 'NR-BSH-200', nome: 'Parafusadeira a Bateria 12V', descricao: 'Parafusadeira com 2 baterias e carregador', precoBase: 459.00, desconto: 18, precoFinal: 376.38, ipi: 10, unidade: 'UN', qtdCaixa: 1, categoria: 'Ferramentas Elétricas', embalagem: 'Maleta', status: 'erro' },
  { id: '7', fornecedor: 'Bosch', codigoOriginal: 'BSH-201', codigoFinal: '', nome: 'Disco de Corte 4.1/2"', descricao: 'Disco abrasivo para metal', precoBase: 4.90, desconto: 18, precoFinal: 4.02, ipi: 10, unidade: 'UN', qtdCaixa: 100, categoria: 'Acessórios', embalagem: 'Caixa', status: 'incompleto' },
  { id: '8', fornecedor: 'Irwin', codigoOriginal: 'IRW-300', codigoFinal: 'NR-IRW-300', nome: 'Broca Aço Rápido 6mm', descricao: 'Broca HSS para metal', precoBase: 12.90, desconto: 8, precoFinal: 11.87, ipi: 5, unidade: 'UN', qtdCaixa: 10, categoria: 'Brocas', embalagem: 'Blister', status: 'pendente' },
  { id: '9', fornecedor: 'Tramontina', codigoOriginal: 'TRM-003', codigoFinal: 'NR-TRM-003', nome: 'Trena 5m com Trava', descricao: 'Trena emborrachada com trava automática', precoBase: 29.90, desconto: 15, precoFinal: 25.42, ipi: 5, unidade: 'UN', qtdCaixa: 24, categoria: 'Medição', embalagem: 'Blister', status: 'validado' },
  { id: '10', fornecedor: 'Vonder', codigoOriginal: 'VND-102', codigoFinal: 'NR-VND-102', nome: 'Nível a Laser 15m', descricao: 'Nível laser com suporte magnético', precoBase: 149.00, desconto: 10, precoFinal: 134.10, ipi: 8, unidade: 'UN', qtdCaixa: 1, categoria: 'Medição', embalagem: 'Caixa', status: 'validado' },
];

export interface AtividadeRecente {
  id: string;
  arquivo: string;
  fornecedor: string;
  tipoEntrada: string;
  data: string;
  status: 'processado' | 'erro' | 'processando' | 'pendente';
  qtdProdutos: number;
}

export const atividadesRecentes: AtividadeRecente[] = [
  { id: '1', arquivo: 'tabela_tramontina_marco2026.xlsx', fornecedor: 'Tramontina', tipoEntrada: 'Excel', data: '2026-03-15', status: 'processado', qtdProdutos: 342 },
  { id: '2', arquivo: 'catalogo_bosch_2026.pdf', fornecedor: 'Bosch', tipoEntrada: 'PDF Catálogo', data: '2026-03-14', status: 'erro', qtdProdutos: 0 },
  { id: '3', arquivo: 'precos_vonder_q1.xlsx', fornecedor: 'Vonder', tipoEntrada: 'Excel', data: '2026-03-12', status: 'processado', qtdProdutos: 189 },
  { id: '4', arquivo: 'starrett_lista_2026.pdf', fornecedor: 'Starrett', tipoEntrada: 'PDF Tabela', data: '2026-03-10', status: 'processado', qtdProdutos: 95 },
  { id: '5', arquivo: 'irwin_novos_produtos.xlsx', fornecedor: 'Irwin', tipoEntrada: 'Excel', data: '2026-03-08', status: 'processando', qtdProdutos: 67 },
  { id: '6', arquivo: 'bosch_acessorios.pdf', fornecedor: 'Bosch', tipoEntrada: 'PDF Tabela', data: '2026-03-05', status: 'processado', qtdProdutos: 278 },
];

export const historicoOperacoes = [
  { id: '1', arquivo: 'tabela_tramontina_marco2026.xlsx', fornecedor: 'Tramontina', usuario: 'Admin', data: '2026-03-15 14:32', tipoConversao: 'Importação de Produtos', qtdItens: 342, status: 'concluído' as const },
  { id: '2', arquivo: 'catalogo_bosch_2026.pdf', fornecedor: 'Bosch', usuario: 'Admin', data: '2026-03-14 09:15', tipoConversao: 'Importação de Produtos', qtdItens: 0, status: 'erro' as const },
  { id: '3', arquivo: 'export_mercos_tramontina.xlsx', fornecedor: 'Tramontina', usuario: 'Admin', data: '2026-03-15 16:00', tipoConversao: 'Exportação Mercos', qtdItens: 320, status: 'concluído' as const },
  { id: '4', arquivo: 'catalogo_campanha_verao.pdf', fornecedor: 'Vonder', usuario: 'Admin', data: '2026-03-13 11:45', tipoConversao: 'Catálogo Gerado', qtdItens: 45, status: 'concluído' as const },
  { id: '5', arquivo: 'pedido_mercos_1542.xlsx', fornecedor: 'Tramontina', usuario: 'Admin', data: '2026-03-12 08:20', tipoConversao: 'Conversão de Pedido', qtdItens: 12, status: 'concluído' as const },
];

export const regrasMapeamento = [
  { id: '1', fornecedor: 'Tramontina', colunaOrigem: 'Cod For', colunaDestino: 'Código do Produto', tipo: 'direto' as const },
  { id: '2', fornecedor: 'Tramontina', colunaOrigem: 'Descr Compl', colunaDestino: 'Nome do Produto', tipo: 'direto' as const },
  { id: '3', fornecedor: 'Tramontina', colunaOrigem: 'P.Venda', colunaDestino: 'Preço Base', tipo: 'direto' as const },
  { id: '4', fornecedor: 'Vonder', colunaOrigem: 'CODIGO', colunaDestino: 'Código do Produto', tipo: 'direto' as const },
  { id: '5', fornecedor: 'Vonder', colunaOrigem: 'DESCRICAO + MEDIDA', colunaDestino: 'Nome do Produto', tipo: 'formula' as const },
  { id: '6', fornecedor: 'Bosch', colunaOrigem: 'EAN', colunaDestino: 'Código do Produto', tipo: 'direto' as const },
  { id: '7', fornecedor: 'Bosch', colunaOrigem: 'IPI fixo 10%', colunaDestino: 'IPI', tipo: 'fixo' as const },
];
