import { SupplierAdapter } from './types';

/**
 * Adapter específico para LEVIVAN
 *
 * Estrutura real da planilha (validada em 27/03/2026):
 *   - 3 sheets: "Itens faturamento imediato" (46), "Itens promocionais"
 *     (vazia), "Pré-venda" (7) → 53 produtos no total
 *   - Headers: Imagem | Referência | Descrição | Qtd Emb (Físico) | Emb |
 *     Valor Venda
 *
 * Mapeamento:
 *   - Referência → código (formato LV\d{4})
 *   - Descrição → nome/descricao
 *   - Valor Venda → preco (float nativo do Excel)
 *   - Emb (ex: "CX/08", "CX/24") → embalagem (string descritiva)
 *   - Qtd Emb (Físico) → ESTOQUE físico (não é quantidade por caixa!)
 *     ↑ não mapeado como quantidadeCaixa — colocar isso lá gera "967 unid/cx"
 *     que é absurdo. A quantidade por caixa de fato está embutida em "Emb"
 *     no formato "CX/NN".
 */
export const levivanAdapter: SupplierAdapter = {
  id: 'levivan',
  nome: 'Levivan',
  aliases: ['levivan', 'levivan vidros', 'levivan casa'],

  // codigoPattern garante validação tardia: rejeita ruído tipo "Referência" header.
  codigoPattern: /^LV\d{3,5}$/i,

  // Padrões de detecção
  detectionPatterns: [
    /levivan/i,
    /^LV\d{3,5}\b/m,    // Assinatura forte: prefixo LV
    /valor\s*venda/i,
    /qtd\s*emb\s*\(?\s*fisico/i,
  ],

  // Mapeamento de colunas (acentos cobertos por normalize)
  fieldAliases: {
    codigo: ['referencia', 'ref', 'codigo', 'cod'],
    descricao: ['descricao', 'desc', 'produto', 'nome'],
    preco: ['valor venda', 'valorvenda', 'preco venda', 'vlr venda', 'venda'],
    precoPromocional: ['valor promocional', 'preco promocional'],
    // CORRIGIDO: removidos 'emb' e 'cx' (eram a coluna Emb, não qtdCaixa).
    // "Qtd Emb (Físico)" é ESTOQUE — não mapeamos no quantidadeCaixa pra não
    // corromper o cadastro Mercos com valores tipo 967.
    quantidadeCaixa: ['quantidade embalagem', 'qtd por caixa', 'pcscx'],
    // Emb (CX/08, CX/24, CX/72) — string descritiva da embalagem
    embalagem: ['embalagem', 'tipo emb', 'emb'],
    categoria: ['categoria', 'familia', 'setor'],
  },

  // Regras de exclusão (ignora cabeçalhos e linhas vazias)
  exclusionRules: [
    { pattern: /^(imagem|foto|pic)$/i, descricao: 'Ignora coluna imagem' },
    { pattern: /^\s*$/, descricao: 'Ignora linhas vazias' },
    { pattern: /total|subtotal|soma/i, descricao: 'Ignora linhas de totais' },
    // Header repetido em outras sheets do multi-sheet workbook
    { pattern: /^refer[eê]ncia$/i, descricao: 'Header repetido em multi-sheet' },
  ],
};
